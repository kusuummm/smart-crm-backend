const asyncHandler = require('express-async-handler');
const Meeting = require('../models/Meeting');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const User = require('../models/User');
const EmailLog = require('../models/EmailLog');
const sendEmail = require('../utils/sendEmail');
const { getCustomerReminderHtml, getCallerReminderHtml } = require('../services/meetingReminderService');

// @desc    Schedule a new meeting for a lead/customer
// @route   POST /api/meetings
// @access  Private
const createMeeting = asyncHandler(async (req, res) => {
  const {
    leadId,
    customerId,
    title,
    date,
    time,
    duration = '30 mins',
    meetingLink,
    location = 'Google Meet / Online Conference',
    agenda,
    customerEmail,
  } = req.body;

  if (!customerId || !date || !time) {
    res.status(400);
    throw new Error('Customer ID, date (YYYY-MM-DD), and time (HH:mm) are required');
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  // Telecaller assignment & security
  let telecaller = null;
  if (req.user.role === 'telecaller') {
    telecaller = req.user;
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only schedule meetings for customers assigned to you');
    }
  } else {
    // If admin, use assigned telecaller or the admin user
    if (customer.telecallerId) {
      telecaller = await User.findById(customer.telecallerId);
    }
    if (!telecaller) {
      telecaller = req.user;
    }
  }

  // Parse exact meeting time
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const meetingTime = new Date(year, month - 1, day, hour, minute);

  const effectiveCustomerEmail = (customerEmail || customer.email || '').toLowerCase().trim();
  const effectiveCallerEmail = (telecaller.email || '').toLowerCase().trim();

  // Create meeting record
  const meeting = await Meeting.create({
    leadId: leadId || null,
    customerId: customer._id,
    customerName: customer.name,
    customerEmail: effectiveCustomerEmail,
    customerPhone: customer.mobile || customer.phone || '',
    telecallerId: telecaller._id,
    telecallerName: telecaller.name,
    telecallerEmail: effectiveCallerEmail,
    title: title || 'Client Consultation & Demo',
    date,
    time,
    meetingTime,
    duration,
    meetingLink: meetingLink || '',
    location,
    agenda: agenda || '',
    status: 'scheduled',
    reminderSent: false,
  });

  // If a lead is associated, update lead stage to 'meeting'
  let targetLead = null;
  if (leadId) {
    targetLead = await Lead.findById(leadId);
  } else {
    targetLead = await Lead.findOne({ customerId: customer._id });
  }

  if (targetLead) {
    targetLead.status = 'meeting';
    targetLead.history.push({
      status: 'meeting',
      date: new Date(),
      remark: `Meeting scheduled: "${meeting.title}" on ${date} at ${time}`,
      updatedBy: req.user._id,
    });
    await targetLead.save();
    meeting.leadId = targetLead._id;
    await meeting.save();
  }

  // Send immediate confirmation email to both parties
  try {
    const confirmationSubject = `Meeting Confirmed: ${meeting.title} on ${meeting.date} at ${meeting.time}`;
    
    // 1. Email to Customer
    if (effectiveCustomerEmail && effectiveCustomerEmail.includes('@')) {
      const custConfirmHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b;">
          <h2 style="color: #4f46e5; margin-top: 0;">Meeting Scheduled Successfully</h2>
          <p>Dear <strong>${meeting.customerName}</strong>,</p>
          <p>Your meeting with <strong>${meeting.telecallerName}</strong> has been confirmed.</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Title:</strong> ${meeting.title}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${meeting.date}</p>
            <p style="margin: 4px 0;"><strong>Time:</strong> ${meeting.time} (${meeting.duration})</p>
            ${meeting.meetingLink ? `<p style="margin: 4px 0;"><strong>Link:</strong> <a href="${meeting.meetingLink}">${meeting.meetingLink}</a></p>` : ''}
            ${meeting.agenda ? `<p style="margin: 4px 0;"><strong>Agenda:</strong> ${meeting.agenda}</p>` : ''}
          </div>
          <p style="font-size: 13px; color: #64748b;">You will receive an automated reminder 1 hour prior to the meeting.</p>
        </div>
      `;
      const custRes = await sendEmail({
        to: effectiveCustomerEmail,
        subject: confirmationSubject,
        html: custConfirmHtml,
      });

      await EmailLog.create({
        customerId: customer._id,
        customerName: customer.name,
        email: effectiveCustomerEmail,
        subject: confirmationSubject,
        body: custConfirmHtml,
        type: 'meeting-confirmation',
        status: custRes.success ? 'sent' : 'failed',
        error: custRes.error || '',
        sentBy: req.user._id,
        sentByName: req.user.name,
      });
    }

    // 2. Email to Telecaller
    if (effectiveCallerEmail && effectiveCallerEmail.includes('@')) {
      const callerConfirmHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b;">
          <h2 style="color: #059669; margin-top: 0;">New Meeting Scheduled on Your Calendar</h2>
          <p>Hello <strong>${meeting.telecallerName}</strong>,</p>
          <p>A meeting has been scheduled with customer <strong>${meeting.customerName}</strong>.</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Client:</strong> ${meeting.customerName} (${meeting.customerPhone || 'No phone'})</p>
            <p style="margin: 4px 0;"><strong>Client Email:</strong> ${meeting.customerEmail}</p>
            <p style="margin: 4px 0;"><strong>Title:</strong> ${meeting.title}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${meeting.date}</p>
            <p style="margin: 4px 0;"><strong>Time:</strong> ${meeting.time} (${meeting.duration})</p>
            ${meeting.meetingLink ? `<p style="margin: 4px 0;"><strong>Link:</strong> <a href="${meeting.meetingLink}">${meeting.meetingLink}</a></p>` : ''}
          </div>
          <p style="font-size: 13px; color: #64748b;">An automated reminder will be emailed to both you and the client 1 hour prior to the meeting.</p>
        </div>
      `;
      const callerRes = await sendEmail({
        to: effectiveCallerEmail,
        subject: `New Meeting Booked: ${meeting.customerName} (${meeting.title})`,
        html: callerConfirmHtml,
      });

      await EmailLog.create({
        customerId: customer._id,
        customerName: telecaller.name,
        email: effectiveCallerEmail,
        subject: `New Meeting Booked: ${meeting.customerName} (${meeting.title})`,
        body: callerConfirmHtml,
        type: 'meeting-confirmation',
        status: callerRes.success ? 'sent' : 'failed',
        error: callerRes.error || '',
        sentBy: req.user._id,
        sentByName: req.user.name,
      });
    }

    meeting.confirmationSent = true;
    await meeting.save();
  } catch (emailErr) {
    console.warn('[Meeting Controller] Confirmation email failed:', emailErr.message);
  }

  res.status(201).json({
    success: true,
    message: 'Meeting scheduled successfully! Confirmation emails sent and 1-hour prior reminder armed.',
    meeting,
  });
});

// @desc    Get all meetings for caller or admin
// @route   GET /api/meetings
// @access  Private
const getMeetings = asyncHandler(async (req, res) => {
  const { date, status, customerId, page = 1, limit = 50 } = req.query;
  const conditions = [];

  if (req.user.role === 'telecaller') {
    conditions.push({ telecallerId: req.user._id });
  }

  if (date) conditions.push({ date });
  if (status) conditions.push({ status });
  if (customerId) conditions.push({ customerId });

  const filter = conditions.length > 0 ? { $and: conditions } : {};
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 50, 1);

  const [meetings, total] = await Promise.all([
    Meeting.find(filter)
      .populate('customerId', 'name mobile email company city')
      .populate('leadId', 'status customerName')
      .sort({ meetingTime: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Meeting.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: meetings.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    meetings,
  });
});

// @desc    Update meeting details or status
// @route   PUT /api/meetings/:id
// @access  Private
const updateMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) {
    res.status(404);
    throw new Error('Meeting not found');
  }

  if (req.user.role === 'telecaller' && String(meeting.telecallerId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('You can only update your own scheduled meetings');
  }

  const { title, date, time, duration, meetingLink, location, agenda, status } = req.body;

  if (title) meeting.title = title;
  if (duration) meeting.duration = duration;
  if (meetingLink !== undefined) meeting.meetingLink = meetingLink;
  if (location) meeting.location = location;
  if (agenda !== undefined) meeting.agenda = agenda;
  if (status) meeting.status = status;

  if (date || time) {
    if (date) meeting.date = date;
    if (time) meeting.time = time;
    const [year, month, day] = meeting.date.split('-').map(Number);
    const [hour, minute] = meeting.time.split(':').map(Number);
    meeting.meetingTime = new Date(year, month - 1, day, hour, minute);
    // Reset reminder so reminder sends 1-hour before new time
    meeting.reminderSent = false;
    meeting.reminderSentAt = null;
  }

  await meeting.save();
  res.json({ success: true, meeting });
});

// @desc    Trigger 1-hour reminder immediately (for testing or manual dispatch)
// @route   POST /api/meetings/:id/send-reminder
// @access  Private
const sendMeetingReminderNow = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) {
    res.status(404);
    throw new Error('Meeting not found');
  }

  const customerSubject = `Reminder: Meeting "${meeting.title}" starts in 1 hour (${meeting.time})`;
  const callerSubject = `Upcoming Meeting in 1 Hour: ${meeting.customerName} (${meeting.title})`;

  const customerHtml = getCustomerReminderHtml(meeting);
  const callerHtml = getCallerReminderHtml(meeting);

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
      sentBy: req.user._id,
      sentByName: req.user.name,
    });
  }

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
      sentBy: req.user._id,
      sentByName: req.user.name,
    });
  }

  meeting.reminderSent = true;
  meeting.reminderSentAt = new Date();
  await meeting.save();

  res.json({
    success: true,
    message: `1-hour meeting reminder dispatched to both ${meeting.customerEmail} and ${meeting.telecallerEmail}`,
    customerResult: custResult,
    callerResult,
  });
});

// @desc    Delete / Cancel meeting
// @route   DELETE /api/meetings/:id
// @access  Private
const deleteMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) {
    res.status(404);
    throw new Error('Meeting not found');
  }

  if (req.user.role === 'telecaller' && String(meeting.telecallerId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('You can only cancel your own scheduled meetings');
  }

  meeting.status = 'cancelled';
  await meeting.save();
  res.json({ success: true, message: 'Meeting cancelled successfully' });
});

module.exports = {
  createMeeting,
  getMeetings,
  updateMeeting,
  sendMeetingReminderNow,
  deleteMeeting,
};
