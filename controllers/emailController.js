const isAdminOrOwner = (user) => {
  const r = (user?.role || '').toLowerCase();
  return r === 'admin' || r === 'owner';
};

const asyncHandler = require('express-async-handler');
const EmailLog = require('../models/EmailLog');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const sendEmail = require('../utils/sendEmail');
const { escapeHtml, sanitizeEmailHtml } = require('../utils/sanitizeHtml');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// Built-in templates for email dispatches to customers/leads
const TEMPLATES = {
  welcome: (customer) => ({
    subject: 'Welcome to SmartCRM Solutions!',
    body: `Dear ${customer.name},\n\nThank you for choosing SmartCRM. We're excited to have you on board and look forward to helping your business grow.\n\nBest regards,\nSmartCRM Team`,
  }),
  'follow-up': (customer) => ({
    subject: `Following up on your inquiry, ${customer.name}`,
    body: `Hi ${customer.name},\n\nJust checking in regarding our recent conversation. Please let us know if you have any questions or would like additional information.\n\nBest regards,\nSmartCRM Team`,
  }),
  offer: (customer) => ({
    subject: `Exclusive Proposal & Special Update for ${customer.name}`,
    body: `Dear ${customer.name},\n\nWe have prepared an exclusive proposal for your business requirements. Reach out to review terms and special discounts available this week!\n\nBest regards,\nSmartCRM Team`,
  }),
  quote: (customer) => ({
    subject: `Quotation & Pricing Overview - SmartCRM for ${customer.name}`,
    body: `Dear ${customer.name},\n\nThank you for your interest in our products and services. Attached or summarized below is your customized pricing structure.\n\nPlease let us know if you have questions or wish to proceed.\n\nBest regards,\nSmartCRM Team`,
  }),
  meeting: (customer) => ({
    subject: `Meeting Invitation & Consultation - ${customer.name}`,
    body: `Hi ${customer.name},\n\nWe would love to schedule a quick 15-minute consultation to walk you through how our platform can accelerate your sales pipeline.\n\nPlease reply with a suitable time that works for you.\n\nBest regards,\nSmartCRM Team`,
  }),
  status_update: (customer) => ({
    subject: `Update Regarding Your Account Status - SmartCRM`,
    body: `Dear ${customer.name},\n\nThis is an update regarding the progress on your account and recent activities. Our team is actively working on your requests.\n\nBest regards,\nSmartCRM Team`,
  }),
};

// @desc    Send an email to a customer / lead and log it
// @route   POST /api/emails/send
// @access  Private
const sendCustomerEmail = asyncHandler(async (req, res) => {
  let { customerId, leadId, type = 'follow-up', subject, body } = req.body;

  let lead = null;
  let customer = null;

  if (leadId) {
    lead = await Lead.findById(leadId).populate('customerId');
    if (lead && lead.customerId) {
      customer = lead.customerId;
      customerId = customer._id;
    }
  }

  if (!customer && customerId) {
    customer = await Customer.findById(customerId);
    if (customer && !lead) {
      lead = await Lead.findOne({ customerId: customer._id });
      if (lead) leadId = lead._id;
    }
  }

  if (!customer) {
    res.status(404);
    throw new Error('Customer or Lead not found');
  }

  if (!isAdminOrOwner(req.user)) {
    const isAssigned =
      (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
      customer.assignedTelecaller === req.user.name ||
      (lead && lead.telecallerId && String(lead.telecallerId) === String(req.user._id));
    if (!isAssigned) {
      res.status(403);
      throw new Error('Access denied: You can only send emails to contacts assigned to you');
    }
  }

  if (!customer.email) {
    res.status(400);
    throw new Error('This customer has no email address on file');
  }

  if (customer.email.endsWith('@example.com') || customer.email.endsWith('@crm.com')) {
    res.status(400);
    throw new Error(
      'Customer email is a placeholder domain (@example.com / @crm.com). Please edit the customer profile with a real recipient email address before sending.'
    );
  }

  const template = TEMPLATES[type] ? TEMPLATES[type](customer) : {};
  const finalSubject = subject || template.subject || 'Message from SmartCRM';
  const finalBody = body || template.body || 'Greetings from SmartCRM Solutions.';

  const result = await sendEmail({
    to: customer.email,
    subject: finalSubject,
    html: sanitizeEmailHtml(escapeHtml(finalBody).replace(/\n/g, '<br/>')),
  });

  const log = await EmailLog.create({
    leadId: lead?._id || leadId || null,
    customerId: customer._id,
    customerName: customer.name,
    email: customer.email,
    to: customer.email,
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'crm@system.local',
    direction: 'outgoing',
    subject: finalSubject,
    body: finalBody,
    bodySnippet: finalBody.slice(0, 160),
    type: TEMPLATES[type] ? type : 'custom',
    status: result.success ? 'sent' : 'failed',
    isRead: true,
    error: result.error || '',
    sentBy: req.user._id,
    sentByName: req.user.name,
    metadata: {
      leadId: lead?._id || null,
      messageId: result.messageId || null,
    },
  });

  // If associated lead exists, log this email event in lead history
  if (lead) {
    try {
      lead.history.push({
        status: lead.status || 'in-progress',
        date: new Date(),
        remark: `Dispatched email "${finalSubject}" via CRM by ${req.user.name || 'User'}`,
        updatedBy: req.user._id,
      });
      await lead.save();
    } catch (err) {
      console.warn('[sendCustomerEmail] Error appending to lead history:', err.message);
    }
  }

  if (!result.success) {
    return res.status(502).json({ success: false, message: `Email send failed: ${result.error}`, log });
  }

  res.status(201).json({ success: true, message: 'Email dispatched successfully to lead', log });
});

// @desc    Receive incoming email from a lead / webhook on CRM system
// @route   POST /api/emails/inbound or POST /api/emails/receive
// @access  Public (for webhooks) or Private
const receiveInboundEmail = asyncHandler(async (req, res) => {
  const {
    leadId,
    customerId,
    from,
    sender,
    to,
    recipient,
    subject,
    body,
    text,
    html,
    receivedAt,
  } = req.body;

  const senderEmail = (from || sender || req.body['from-address'] || '').toLowerCase().trim();
  const rawSubject = subject || req.body['subject'] || req.body['message-subject'] || 'Inbound Message from Lead';
  const rawBody = body || text || req.body['body-plain'] || html || 'No content';
  const emailSubject = escapeHtml(rawSubject);
  const emailBody = sanitizeEmailHtml(rawBody);

  if (!senderEmail || !senderEmail.includes('@')) {
    res.status(400);
    throw new Error('A valid sender email address (from) is required');
  }

  let lead = null;
  let customer = null;

  if (leadId) {
    lead = await Lead.findById(leadId).populate('customerId');
    if (lead && lead.customerId) customer = lead.customerId;
  }

  if (!customer && customerId) {
    customer = await Customer.findById(customerId);
    if (customer && !lead) {
      lead = await Lead.findOne({ customerId: customer._id });
    }
  }

  // Automatic match by email if neither leadId nor customerId passed
  if (!customer) {
    customer = await Customer.findOne({ email: senderEmail });
    if (customer && !lead) {
      lead = await Lead.findOne({ customerId: customer._id });
    }
  }

  // If still no lead, but sender matches any lead customer name or partial
  if (!lead && customer) {
    lead = await Lead.findOne({ customerId: customer._id });
  }

  const log = await EmailLog.create({
    leadId: lead?._id || null,
    customerId: customer?._id || null,
    customerName: customer?.name || lead?.customerName || senderEmail,
    email: senderEmail,
    from: senderEmail,
    to: to || recipient || process.env.EMAIL_USER || 'crm@system.local',
    direction: 'incoming',
    subject: emailSubject,
    body: emailBody,
    bodySnippet: emailBody.slice(0, 160),
    type: 'incoming',
    status: 'received',
    isRead: false,
    receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
    sentBy: null,
    sentByName: customer?.name || senderEmail,
    metadata: {
      source: 'lead_inbound_email',
      leadId: lead?._id || null,
    },
  });

  // If lead exists, append to history so lead panel immediately reflects received email
  if (lead) {
    try {
      lead.history.push({
        status: lead.status || 'in-progress',
        date: new Date(),
        remark: `Received incoming email from lead: "${emailSubject}"`,
        updatedBy: null,
      });
      await lead.save();
    } catch (err) {
      console.warn('[receiveInboundEmail] Error updating lead history:', err.message);
    }
  }

  res.status(201).json({
    success: true,
    message: `Incoming email from ${senderEmail} successfully received and logged on CRM system`,
    log,
  });
});

// @desc    Get all emails (received & sent) for a specific lead
// @route   GET /api/leads/:leadId/emails or GET /api/emails?leadId=...
// @access  Private
const getLeadEmails = asyncHandler(async (req, res) => {
  const leadId = req.params.leadId || req.params.id || req.query.leadId;

  if (!leadId) {
    res.status(400);
    throw new Error('Lead ID is required');
  }

  const lead = await Lead.findById(leadId).populate('customerId');
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  if (!isAdminOrOwner(req.user)) {
    const customerIds = await getTelecallerCustomerIds(req.user);
    const isOwner = (lead.telecallerId && String(lead.telecallerId) === String(req.user._id)) ||
                    customerIds.some(id => String(id) === String(lead.customerId?._id || lead.customerId));
    if (!isOwner) {
      res.status(403);
      throw new Error('Access denied: You cannot access emails for leads assigned to other team members');
    }
  }

  const customer = lead.customerId;
  const customerEmail = customer?.email ? customer.email.toLowerCase().trim() : null;

  // Build match query for all communication associated with this lead
  const orConditions = [{ leadId: lead._id }];

  if (customer && customer._id) {
    orConditions.push({ customerId: customer._id });
  }

  if (customerEmail) {
    orConditions.push({ email: customerEmail });
    orConditions.push({ to: customerEmail });
    orConditions.push({ from: customerEmail });
  }

  const logs = await EmailLog.find({ $or: orConditions })
    .sort({ createdAt: -1 })
    .lean();

  const receivedCount = logs.filter((l) => l.direction === 'incoming').length;
  const sentCount = logs.filter((l) => l.direction !== 'incoming').length;
  const unreadCount = logs.filter((l) => l.direction === 'incoming' && !l.isRead).length;

  res.json({
    success: true,
    count: logs.length,
    receivedCount,
    sentCount,
    unreadCount,
    lead: {
      id: lead._id,
      customerName: lead.customerName,
      status: lead.status,
      customerEmail: customerEmail || '',
      customerId: customer?._id || null,
    },
    logs,
  });
});

// @desc    Mark an email as read
// @route   PATCH /api/emails/:id/read
// @access  Private
const markEmailRead = asyncHandler(async (req, res) => {
  const log = await EmailLog.findById(req.params.id);
  if (!log) {
    res.status(404);
    throw new Error('Email log not found');
  }

  if (!isAdminOrOwner(req.user)) {
    const assignedCustIds = await Customer.find({
      $or: [{ telecallerId: req.user._id }, { assignedTelecaller: req.user.name }],
    }).distinct('_id');
    const isOwner = (log.sentBy && String(log.sentBy) === String(req.user._id)) ||
                    (log.customerId && assignedCustIds.some(id => String(id) === String(log.customerId)));
    if (!isOwner) {
      res.status(403);
      throw new Error('Access denied: You cannot modify email logs belonging to other team members');
    }
  }

  log.isRead = true;
  await log.save();

  res.json({ success: true, log });
});

// @desc    Get email logs (filter by type/status/customer/lead, pagination)
// @route   GET /api/emails?type=&status=&customerId=&leadId=&direction=&page=&limit=
// @access  Private
const getEmailLogs = asyncHandler(async (req, res) => {
  const { type, status, customerId, leadId, direction, page = 1, limit = 10, sentBy } = req.query;
  const conditions = [];

  if (!isAdminOrOwner(req.user)) {
    const assignedCustIds = await Customer.find({
      $or: [{ telecallerId: req.user._id }, { assignedTelecaller: req.user.name }],
    }).distinct('_id');
    conditions.push({
      $or: [
        { sentBy: req.user._id },
        { customerId: { $in: assignedCustIds } },
      ],
    });
  } else if (sentBy && sentBy !== 'all') {
    conditions.push({ sentBy });
  }

  if (type) conditions.push({ type });
  if (status) conditions.push({ status });
  if (customerId) conditions.push({ customerId });
  if (leadId) conditions.push({ leadId });
  if (direction && direction !== 'all') conditions.push({ direction });

  const filter = conditions.length > 0 ? { $and: conditions } : {};

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const [logs, total] = await Promise.all([
    EmailLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    EmailLog.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: logs.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    logs,
  });
});

// @desc    Send test email to verify SMTP deliverability (Admin only)
// @route   POST /api/emails/test
// @access  Private/Admin
const testEmailDelivery = asyncHandler(async (req, res) => {
  const { recipientEmail } = req.body;

  if (!recipientEmail || !recipientEmail.trim() || !recipientEmail.includes('@')) {
    res.status(400);
    throw new Error('A valid recipientEmail is required');
  }

  const cleanRecipient = recipientEmail.trim();

  if (cleanRecipient.endsWith('@example.com') || cleanRecipient.endsWith('@crm.com')) {
    res.status(400);
    throw new Error(
      'Cannot send test to a placeholder domain (@example.com or @crm.com). Please enter your real email address (e.g. Gmail or Outlook).'
    );
  }

  const result = await sendEmail({
    to: cleanRecipient,
    subject: `SmartCRM Deliverability Test — ${new Date().toLocaleTimeString()}`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2 style="color: #2563eb;">SmartCRM SMTP Deliverability Test Passed!</h2>
        <p>This email confirms that the SmartCRM outgoing email pipeline is fully functional and delivering properly.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
        <ul style="line-height: 1.8; color: #475569;">
          <li><strong>Relay Host:</strong> ${process.env.EMAIL_HOST || 'send.one.com'} (Port: ${process.env.EMAIL_PORT || '465 / 2525'})</li>
          <li><strong>Authenticated Sender:</strong> ${process.env.EMAIL_USER || 'info@paymanent.com'}</li>
          <li><strong>Recipient:</strong> ${cleanRecipient}</li>
          <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
        </ul>
        <p style="color: #16a34a; font-weight: bold;">✔ All SMTP authentication checks passed.</p>
      </div>
    `,
  });

  // Record into EmailLog so admin can see test dispatches in the email logs
  await EmailLog.create({
    customerName: 'Admin SMTP Test',
    email: cleanRecipient,
    to: cleanRecipient,
    subject: `SmartCRM Deliverability Test — ${new Date().toLocaleTimeString()}`,
    body: `Live SMTP Deliverability Verification dispatch via port ${result.port || 465}.`,
    type: 'general',
    direction: 'outgoing',
    status: result.success ? 'sent' : 'failed',
    error: result.error || '',
    sentBy: req.user._id,
    sentByName: req.user.name,
  }).catch((err) => console.error('Failed to log test email:', err.message));

  if (!result.success) {
    res.status(502);
    throw new Error(result.error || 'SMTP delivery failed. Check credentials in .env.');
  }

  res.json({
    success: true,
    message: `Test email successfully dispatched to ${cleanRecipient} via one.com (port ${result.port || 465})! Please check your Inbox and Spam/Junk folder.`,
    messageId: result.messageId,
  });
});

module.exports = {
  sendCustomerEmail,
  getEmailLogs,
  getLeadEmails,
  receiveInboundEmail,
  markEmailRead,
  testEmailDelivery,
};
