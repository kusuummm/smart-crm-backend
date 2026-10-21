const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const EmailLog = require('../models/EmailLog');
const sendEmail = require('../utils/sendEmail');

// Generate clean, modern HTML email for customer reminder
const getCustomerReminderHtml = (meeting) => {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b;">
      <div style="background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); padding: 24px; border-radius: 12px; color: #ffffff; margin-bottom: 24px;">
        <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 700; color: #ffffff;">Meeting Reminder</h1>
        <p style="margin: 0; font-size: 15px; opacity: 0.95;">Your meeting starts in approximately 1 hour</p>
      </div>

      <p style="font-size: 15px; margin-bottom: 16px;">Dear <strong>${meeting.customerName}</strong>,</p>
      <p style="font-size: 15px; margin-bottom: 20px;">
        This is a friendly reminder that your upcoming consultation meeting with <strong>${meeting.telecallerName}</strong> is scheduled in 1 hour.
      </p>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
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
            <td style="padding: 6px 0; color: #64748b;"><strong>Time:</strong></td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${meeting.time} (${meeting.duration || '30 mins'})</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;"><strong>Meeting Host:</strong></td>
            <td style="padding: 6px 0; color: #0f172a;">${meeting.telecallerName} (${meeting.telecallerEmail})</td>
          </tr>
          ${meeting.agenda ? `
          <tr>
            <td style="padding: 6px 0; color: #64748b; vertical-align: top;"><strong>Agenda:</strong></td>
            <td style="padding: 6px 0; color: #334155;">${meeting.agenda}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${meeting.meetingLink ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${meeting.meetingLink}" target="_blank" style="display: inline-block; background-color: #4f46e5; color: #ffffff; font-weight: 600; font-size: 15px; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.3);">
          👉 Join Meeting Online
        </a>
        <p style="font-size: 12px; color: #64748b; margin-top: 8px;">Direct link: <a href="${meeting.meetingLink}" style="color: #4f46e5;">${meeting.meetingLink}</a></p>
      </div>
      ` : `
      <p style="font-size: 14px; color: #475569; background: #e0f2fe; padding: 12px; border-radius: 8px;">
        📞 Your meeting host <strong>${meeting.telecallerName}</strong> will connect with you directly at the scheduled time.
      </p>
      `}

      <p style="font-size: 13px; color: #64748b; margin-top: 24px; border-top: 1px solid #e2e8f0; pt: 16px;">
        If you need to reschedule or have any questions, please reply to this email or reach out to your advisor at <a href="mailto:${meeting.telecallerEmail}" style="color: #4f46e5;">${meeting.telecallerEmail}</a>.
      </p>
    </div>
  `;
};

// Generate clean HTML email for telecaller reminder
const getCallerReminderHtml = (meeting) => {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b;">
      <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 24px; border-radius: 12px; color: #ffffff; margin-bottom: 24px;">
        <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 700; color: #ffffff;">Upcoming Lead Meeting</h1>
        <p style="margin: 0; font-size: 15px; opacity: 0.95;">Scheduled with customer in 1 hour</p>
      </div>

      <p style="font-size: 15px; margin-bottom: 16px;">Hello <strong>${meeting.telecallerName}</strong>,</p>
      <p style="font-size: 15px; margin-bottom: 20px;">
        You have a scheduled meeting with client <strong>${meeting.customerName}</strong> starting in approximately 1 hour.
      </p>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b; width: 130px;"><strong>Client Name:</strong></td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${meeting.customerName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;"><strong>Client Contact:</strong></td>
            <td style="padding: 6px 0; color: #0f172a; font-family: monospace;">${meeting.customerPhone || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;"><strong>Client Email:</strong></td>
            <td style="padding: 6px 0; color: #0f172a;"><a href="mailto:${meeting.customerEmail}" style="color: #4f46e5;">${meeting.customerEmail}</a></td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;"><strong>Meeting Title:</strong></td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${meeting.title}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;"><strong>Time:</strong></td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${meeting.date} at ${meeting.time} (${meeting.duration || '30 mins'})</td>
          </tr>
          ${meeting.agenda ? `
          <tr>
            <td style="padding: 6px 0; color: #64748b; vertical-align: top;"><strong>Notes/Agenda:</strong></td>
            <td style="padding: 6px 0; color: #334155;">${meeting.agenda}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${meeting.meetingLink ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${meeting.meetingLink}" target="_blank" style="display: inline-block; background-color: #059669; color: #ffffff; font-weight: 600; font-size: 15px; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(5, 150, 105, 0.3);">
          🚀 Launch Meeting
        </a>
      </div>
      ` : ''}

      <p style="font-size: 13px; color: #64748b; margin-top: 24px; border-top: 1px solid #e2e8f0; pt: 16px;">
        Automated 1-hour prior reminder sent by Smart CRM scheduler.
      </p>
    </div>
  `;
};

// Check for upcoming meetings starting within the next 60 minutes and send reminder emails
const checkAndSendMeetingReminders = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }
    const now = new Date();
    // Look ahead 60 minutes + 5 minute buffer
    const windowStart = new Date(now.getTime() - 15 * 60 * 1000); // 15 mins ago to avoid missing edge cases
    const windowEnd = new Date(now.getTime() + 65 * 60 * 1000); // within next 65 mins

    const upcomingMeetings = await Meeting.find({
      status: 'scheduled',
      reminderSent: false,
      meetingTime: { $gte: windowStart, $lte: windowEnd },
    });

    if (upcomingMeetings.length === 0) {
      return;
    }

    console.log(`[Meeting Scheduler] Found ${upcomingMeetings.length} meeting(s) due within ~1 hour. Dispatching reminder emails...`);

    for (const meeting of upcomingMeetings) {
      const customerSubject = `Reminder: Meeting "${meeting.title}" starts in 1 hour (${meeting.time})`;
      const callerSubject = `Upcoming Meeting in 1 Hour: ${meeting.customerName} (${meeting.title})`;

      const customerHtml = getCustomerReminderHtml(meeting);
      const callerHtml = getCallerReminderHtml(meeting);

      // 1. Send email to Customer / Lead
      let custResult = { success: false };
      if (meeting.customerEmail && meeting.customerEmail.includes('@')) {
        custResult = await sendEmail({
          to: meeting.customerEmail,
          subject: customerSubject,
          html: customerHtml,
        });

        await EmailLog.create({
          customerId: meeting.customerId,
          customerName: meeting.customerName,
          email: meeting.customerEmail,
          subject: customerSubject,
          body: customerHtml,
          type: 'meeting-reminder',
          status: custResult.success ? 'sent' : 'failed',
          error: custResult.error || '',
          sentBy: meeting.telecallerId,
          sentByName: meeting.telecallerName,
        });
      }

      // 2. Send email to Telecaller / Agent
      let callerResult = { success: false };
      if (meeting.telecallerEmail && meeting.telecallerEmail.includes('@')) {
        callerResult = await sendEmail({
          to: meeting.telecallerEmail,
          subject: callerSubject,
          html: callerHtml,
        });

        await EmailLog.create({
          customerId: meeting.customerId,
          customerName: meeting.telecallerName,
          email: meeting.telecallerEmail,
          subject: callerSubject,
          body: callerHtml,
          type: 'meeting-reminder',
          status: callerResult.success ? 'sent' : 'failed',
          error: callerResult.error || '',
          sentBy: meeting.telecallerId,
          sentByName: meeting.telecallerName,
        });
      }

      // Mark meeting as reminded
      meeting.reminderSent = true;
      meeting.reminderSentAt = new Date();
      await meeting.save();

      console.log(`[Meeting Scheduler] Successfully dispatched 1-hour reminders for meeting "${meeting.title}" to ${meeting.customerEmail} and ${meeting.telecallerEmail}.`);
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

  console.log('[Meeting Scheduler] Initialized 1-hour meeting reminder background job (running every 60s)');
  
  // Run once immediately on start
  checkAndSendMeetingReminders();

  // Run on interval
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
  checkAndSendMeetingReminders,
  startMeetingReminderScheduler,
  stopMeetingReminderScheduler,
  getCustomerReminderHtml,
  getCallerReminderHtml,
};
