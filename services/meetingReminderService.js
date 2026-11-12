const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const EmailLog = require('../models/EmailLog');
const WhatsAppLog = require('../models/WhatsAppLog');
const sendEmail = require('../utils/sendEmail');
const { sendWhatsAppText } = require('../utils/sendWhatsApp');

// The 6 Cadence Stages:
// Stage 1: 3 hours prior (T - 180m)
// Stage 2: 1 hour after Stage 1 -> 2 hours prior (T - 120m)
// Stage 3: 30 minutes after Stage 2 -> 90 mins prior (T - 90m)
// Stage 4: 30 minutes after Stage 3 -> 60 mins prior (T - 60m)
// Stage 5: 30 minutes after Stage 4 -> 30 mins prior (T - 30m)
// Stage 6: 30 minutes after Stage 5 -> Starting now (T - 0m)
const REMINDER_STAGES = [
  {
    stage: '3h',
    minWindow: 120, // when remaining minutes are (120, 180]
    maxWindow: 180,
    label: '3-Hour Prior Reminder',
    leadSubject: (m) => `Reminder: Meeting "${m.title}" starts in 3 hours (${m.time})`,
    callerSubject: (m) => `Upcoming Meeting in 3 Hours: ${m.customerName} (${m.title})`,
    timeRemainingText: 'starts in approximately 3 hours',
    badgeText: 'Starts in 3 Hours',
    badgeColor: '#4f46e5',
    urgencyText: 'This is a friendly reminder that your upcoming consultation meeting is scheduled in 3 hours.',
  },
  {
    stage: '2h',
    minWindow: 90, // when remaining minutes are (90, 120] -> 1 hour after first reminder
    maxWindow: 120,
    label: '2-Hour Prior Reminder',
    leadSubject: (m) => `Reminder: Meeting "${m.title}" starts in 2 hours (${m.time})`,
    callerSubject: (m) => `Upcoming Meeting in 2 Hours: ${m.customerName} (${m.title})`,
    timeRemainingText: 'starts in approximately 2 hours',
    badgeText: 'Starts in 2 Hours',
    badgeColor: '#2563eb',
    urgencyText: 'Your consultation session is scheduled in 2 hours. Everything is set on our end.',
  },
  {
    stage: '90m',
    minWindow: 60, // when remaining minutes are (60, 90] -> 30 mins after 2h reminder
    maxWindow: 90,
    label: '90-Minute Prior Reminder',
    leadSubject: (m) => `Reminder: Meeting "${m.title}" starts in 1 hour 30 mins (${m.time})`,
    callerSubject: (m) => `Upcoming Meeting in 90 Mins: ${m.customerName} (${m.title})`,
    timeRemainingText: 'starts in approximately 1 hour and 30 minutes',
    badgeText: 'Starts in 90 Mins',
    badgeColor: '#0284c7',
    urgencyText: 'We look forward to speaking with you in 1 hour and 30 minutes.',
  },
  {
    stage: '60m',
    minWindow: 30, // when remaining minutes are (30, 60] -> 30 mins after 90m reminder
    maxWindow: 60,
    label: '1-Hour Prior Reminder',
    leadSubject: (m) => `Reminder: Meeting "${m.title}" starts in 1 hour (${m.time})`,
    callerSubject: (m) => `Upcoming Meeting in 1 Hour: ${m.customerName} (${m.title})`,
    timeRemainingText: 'starts in approximately 1 hour',
    badgeText: 'Starts in 1 Hour',
    badgeColor: '#d97706',
    urgencyText: 'Only 1 hour remaining! Your advisor will connect with you soon.',
  },
  {
    stage: '30m',
    minWindow: 5, // when remaining minutes are (5, 30] -> 30 mins after 60m reminder
    maxWindow: 30,
    label: '30-Minute Final Countdown',
    leadSubject: (m) => `Urgent Reminder: Meeting "${m.title}" starts in 30 minutes!`,
    callerSubject: (m) => `Action Required: Meeting with ${m.customerName} starts in 30 minutes!`,
    timeRemainingText: 'starts in 30 minutes',
    badgeText: 'Starts in 30 Mins - Be Ready',
    badgeColor: '#dc2626',
    urgencyText: 'Your meeting starts in half an hour. Please be ready to connect.',
  },
  {
    stage: '0m',
    minWindow: -15, // when remaining minutes are [-15, 5] -> 30 mins after 30m reminder
    maxWindow: 5,
    label: 'Meeting Starting Now',
    leadSubject: (m) => `Meeting Starting Now: "${m.title}" - Join Online`,
    callerSubject: (m) => `Meeting Starting Now: Connect with ${m.customerName}`,
    timeRemainingText: 'is starting right now',
    badgeText: 'Starting Now!',
    badgeColor: '#16a34a',
    urgencyText: 'Your meeting is starting now! Click the join link below or answer your advisor’s incoming call.',
  },
];

// Clean HTML email template for customer/lead reminder
const getCustomerReminderHtml = (meeting, stageConfig) => {
  const badgeColor = stageConfig?.badgeColor || '#4f46e5';
  const badgeText = stageConfig?.badgeText || 'Meeting Reminder';
  const urgencyText = stageConfig?.urgencyText || `Your meeting starts in approximately 1 hour.`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: ${badgeColor}; padding: 24px; color: #ffffff; text-align: left;">
        <span style="display: inline-block; background: rgba(255, 255, 255, 0.22); color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 4px 10px; border-radius: 6px; margin-bottom: 8px;">
          ${badgeText}
        </span>
        <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">Meeting Reminder</h1>
        <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95;">${meeting.title}</p>
      </div>

      <div style="padding: 24px;">
        <p style="font-size: 15px; margin-top: 0;">Dear <strong>${meeting.customerName}</strong>,</p>
        <p style="font-size: 14px; color: #334155;">
          ${urgencyText}
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 130px;"><strong>Meeting Title:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${meeting.title}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Date:</strong></td>
              <td style="padding: 6px 0; color: #0f172a;">${meeting.date}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Scheduled Time:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 700;">${meeting.time} (${meeting.duration || '30 mins'})</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Assigned Host:</strong></td>
              <td style="padding: 6px 0; color: #0f172a;">${meeting.telecallerName} (${meeting.telecallerEmail || 'CRM Team'})</td>
            </tr>
            ${meeting.agenda ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; vertical-align: top;"><strong>Agenda:</strong></td>
              <td style="padding: 6px 0; color: #334155;">${meeting.agenda}</td>
            </tr>` : ''}
          </table>
        </div>

        ${meeting.meetingLink ? `
        <div style="text-align: center; margin: 28px 0;">
          <a href="${meeting.meetingLink}" target="_blank" style="display: inline-block; background-color: ${badgeColor}; color: #ffffff; font-weight: 700; font-size: 15px; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            👉 Join Meeting Room Online
          </a>
          <p style="font-size: 12px; color: #64748b; margin-top: 8px;">Direct link: <a href="${meeting.meetingLink}" style="color: ${badgeColor};">${meeting.meetingLink}</a></p>
        </div>` : `
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; font-size: 13px; color: #1e40af;">
          📞 Your assigned host <strong>${meeting.telecallerName}</strong> will call your phone directly at the scheduled time.
        </div>`}

        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
          Smart CRM Automated Notification System • If you need to reschedule, please reply to this email or contact <a href="mailto:${meeting.telecallerEmail}" style="color: ${badgeColor};">${meeting.telecallerEmail}</a>.
        </p>
      </div>
    </div>
  `;
};

// Clean HTML email template for telecaller/host reminder
const getCallerReminderHtml = (meeting, stageConfig) => {
  const badgeColor = stageConfig?.badgeColor || '#059669';
  const badgeText = stageConfig?.badgeText || 'Host Reminder';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: ${badgeColor}; padding: 24px; color: #ffffff; text-align: left;">
        <span style="display: inline-block; background: rgba(255, 255, 255, 0.22); color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 4px 10px; border-radius: 6px; margin-bottom: 8px;">
          ${badgeText}
        </span>
        <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">Upcoming Lead Consultation</h1>
        <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95;">With ${meeting.customerName}</p>
      </div>

      <div style="padding: 24px;">
        <p style="font-size: 15px; margin-top: 0;">Hello <strong>${meeting.telecallerName}</strong>,</p>
        <p style="font-size: 14px; color: #334155;">
          You have an upcoming meeting scheduled with client <strong>${meeting.customerName}</strong> starting in <strong>${stageConfig?.timeRemainingText || 'shortly'}</strong>.
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 130px;"><strong>Client Name:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 700;">${meeting.customerName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Client Contact:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-family: monospace;">${meeting.customerPhone || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Client Email:</strong></td>
              <td style="padding: 6px 0; color: #0f172a;"><a href="mailto:${meeting.customerEmail}" style="color: ${badgeColor};">${meeting.customerEmail}</a></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Meeting Title:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${meeting.title}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Time:</strong></td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 700;">${meeting.date} at ${meeting.time} (${meeting.duration || '30 mins'})</td>
            </tr>
            ${meeting.agenda ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; vertical-align: top;"><strong>Agenda:</strong></td>
              <td style="padding: 6px 0; color: #334155;">${meeting.agenda}</td>
            </tr>` : ''}
          </table>
        </div>

        ${meeting.meetingLink ? `
        <div style="text-align: center; margin: 28px 0;">
          <a href="${meeting.meetingLink}" target="_blank" style="display: inline-block; background-color: ${badgeColor}; color: #ffffff; font-weight: 700; font-size: 15px; text-decoration: none; padding: 12px 28px; border-radius: 8px;">
            🚀 Open Host Meeting Room
          </a>
        </div>` : ''}

        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
          Automated multi-stage meeting reminder sent by Smart CRM Scheduler.
        </p>
      </div>
    </div>
  `;
};

// Dispatches a specific reminder stage (Email + WhatsApp message) for a meeting
const dispatchMeetingStageReminder = async (meeting, stageConfig) => {
  const stage = stageConfig.stage;
  console.log(`[Meeting Scheduler] Dispatching Stage "${stage}" (${stageConfig.label}) for meeting "${meeting.title}" to lead "${meeting.customerName}"...`);

  let emailSent = false;
  let whatsappSent = false;
  let errorMsg = '';

  // 1. Send Email to Customer / Lead
  if (meeting.customerEmail && meeting.customerEmail.includes('@')) {
    const custSubject = stageConfig.leadSubject(meeting);
    const custHtml = getCustomerReminderHtml(meeting, stageConfig);
    const emailRes = await sendEmail({
      to: meeting.customerEmail,
      subject: custSubject,
      html: custHtml,
    });

    if (emailRes.success) {
      emailSent = true;
    } else {
      errorMsg = emailRes.error || 'Email dispatch failed';
    }

    await EmailLog.create({
      customerId: meeting.customerId,
      customerName: meeting.customerName,
      email: meeting.customerEmail,
      subject: custSubject,
      body: custHtml,
      type: 'meeting-reminder',
      status: emailRes.success ? 'sent' : 'failed',
      error: emailRes.error || '',
      sentBy: meeting.telecallerId,
      sentByName: meeting.telecallerName,
    }).catch(() => {});
  }

  // 2. Send Email to Telecaller / Host
  if (meeting.telecallerEmail && meeting.telecallerEmail.includes('@')) {
    const callerSubject = stageConfig.callerSubject(meeting);
    const callerHtml = getCallerReminderHtml(meeting, stageConfig);
    await sendEmail({
      to: meeting.telecallerEmail,
      subject: callerSubject,
      html: callerHtml,
    }).catch(() => {});

    await EmailLog.create({
      customerId: meeting.customerId,
      customerName: meeting.telecallerName,
      email: meeting.telecallerEmail,
      subject: callerSubject,
      body: callerHtml,
      type: 'meeting-reminder',
      status: 'sent',
      sentBy: meeting.telecallerId,
      sentByName: meeting.telecallerName,
    }).catch(() => {});
  }

  // 3. Send WhatsApp / SMS Message to Customer
  if (meeting.customerPhone && meeting.customerPhone.trim()) {
    const waText = `🔔 *Meeting Reminder - Smart CRM*
Dear *${meeting.customerName}*,
Your consultation meeting "*${meeting.title}*" with advisor *${meeting.telecallerName}* ${stageConfig.timeRemainingText}.

📅 Date: ${meeting.date}
⏰ Time: ${meeting.time} (${meeting.duration || '30 mins'})
${meeting.meetingLink ? `👉 Join Meeting: ${meeting.meetingLink}` : '📞 Your advisor will call you directly at the scheduled time.'}

If you need to reschedule or have questions, please reply to this message.`;

    const waRes = await sendWhatsAppText({
      to: meeting.customerPhone,
      message: waText,
    });

    if (waRes.success) {
      whatsappSent = true;
    }

    await WhatsAppLog.create({
      customerId: meeting.customerId,
      customerName: meeting.customerName,
      mobile: meeting.customerPhone,
      message: waText,
      type: 'meeting-reminder',
      status: waRes.success ? 'sent' : 'logged',
      error: waRes.error || '',
    }).catch(() => {});
  }

  // Record stage completion on Meeting model
  if (!meeting.reminderStagesSent) {
    meeting.reminderStagesSent = [];
  }

  meeting.reminderStagesSent.push({
    stage,
    label: stageConfig.label,
    sentAt: new Date(),
    emailSent,
    whatsappSent,
    error: errorMsg,
  });

  meeting.lastReminderStage = stage;
  meeting.lastReminderSentAt = new Date();
  meeting.reminderSent = true; // backward compatibility
  meeting.reminderSentAt = new Date();

  await meeting.save();
  console.log(`[Meeting Scheduler] Successfully logged Stage "${stage}" for meeting "${meeting.title}".`);
  return { success: true, stage, emailSent, whatsappSent };
};

// Check for all scheduled meetings and trigger reminders in cadence
const checkAndSendMeetingReminders = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }

    const now = new Date();
    const nowTime = now.getTime();

    // Query all upcoming scheduled meetings within the 3.5 hour window
    const maxLookahead = new Date(nowTime + 200 * 60 * 1000); // 200 mins ahead
    const minLookbehind = new Date(nowTime - 20 * 60 * 1000); // 20 mins ago

    const upcomingMeetings = await Meeting.find({
      status: 'scheduled',
      meetingTime: { $gte: minLookbehind, $lte: maxLookahead },
    });

    if (upcomingMeetings.length === 0) {
      return;
    }

    for (const meeting of upcomingMeetings) {
      const meetingTime = new Date(meeting.meetingTime).getTime();
      const diffMinutes = (meetingTime - nowTime) / (60 * 1000);

      // Find the appropriate stage based on remaining minutes:
      // Pattern: 3h -> (1h later) 2h -> (30m later) 90m -> (30m later) 60m -> (30m later) 30m -> (30m later) 0m
      for (const stageConfig of REMINDER_STAGES) {
        if (diffMinutes <= stageConfig.maxWindow && diffMinutes > stageConfig.minWindow) {
          // Check if this stage has already been sent
          const alreadySent =
            meeting.reminderStagesSent &&
            meeting.reminderStagesSent.some((s) => s.stage === stageConfig.stage);

          if (!alreadySent) {
            await dispatchMeetingStageReminder(meeting, stageConfig);
          }
          break; // Process one stage at a time per check
        }
      }
    }
  } catch (error) {
    console.error('[Meeting Scheduler] Error during reminder check:', error.message);
  }
};

let reminderInterval = null;

const startMeetingReminderScheduler = (intervalMs = 60000) => {
  if (reminderInterval) {
    clearInterval(reminderInterval);
  }

  console.log('[Meeting Scheduler] Initialized multi-stage meeting reminder background job (running every 60s: 3h -> 2h -> 90m -> 60m -> 30m -> 0m)');

  // Run once immediately on start
  checkAndSendMeetingReminders();

  // Run on recurring interval
  reminderInterval = setInterval(checkAndSendMeetingReminders, intervalMs);

  return reminderInterval;
};

const stopMeetingReminderScheduler = () => {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
};

module.exports = {
  REMINDER_STAGES,
  dispatchMeetingStageReminder,
  checkAndSendMeetingReminders,
  startMeetingReminderScheduler,
  stopMeetingReminderScheduler,
  getCustomerReminderHtml,
  getCallerReminderHtml,
};
