const asyncHandler = require('express-async-handler');
const EmailLog = require('../models/EmailLog');
const Customer = require('../models/Customer');
const sendEmail = require('../utils/sendEmail');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// Built-in templates for welcome / follow-up / offer emails.
// Kept simple and editable - the actual subject/body can also be overridden by the caller.
const TEMPLATES = {
  welcome: (customer) => ({
    subject: 'Welcome to SmartCRM Solutions!',
    body: `Dear ${customer.name},\n\nThank you for choosing SmartCRM. We're excited to have you on board and look forward to helping your business grow.\n\nBest regards,\nSmartCRM Team`,
  }),
  'follow-up': (customer) => ({
    subject: `Following up, ${customer.name}`,
    body: `Hi ${customer.name},\n\nJust checking in regarding our recent conversation. Please let us know if you have any questions.\n\nBest regards,\nSmartCRM Team`,
  }),
  offer: (customer) => ({
    subject: `Exclusive Update for ${customer.name} - SmartCRM`,
    body: `Dear ${customer.name},\n\nWe have an exclusive offer available for you. Reach out to learn more!\n\nBest regards,\nSmartCRM Team`,
  }),
};

// @desc    Send an email to a customer (welcome / follow-up / offer / custom) and log it
// @route   POST /api/emails/send
// @access  Private
const sendCustomerEmail = asyncHandler(async (req, res) => {
  const { customerId, type = 'follow-up', subject, body } = req.body;

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  if (req.user.role === 'telecaller') {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only send emails to customers assigned to you');
    }
  }

  if (!customer.email) {
    res.status(400);
    throw new Error('This customer has no email address on file');
  }

  if (customer.email.endsWith('@example.com') || customer.email.endsWith('@crm.com')) {
    res.status(400);
    throw new Error('Customer email is a placeholder domain (@example.com / @crm.com). Please edit the customer profile with a real recipient email address before sending.');
  }

  const template = TEMPLATES[type] ? TEMPLATES[type](customer) : {};
  const finalSubject = subject || template.subject || 'Message from SmartCRM';
  const finalBody = body || template.body || 'Greetings from SmartCRM Solutions.';

  const result = await sendEmail({
    to: customer.email,
    subject: finalSubject,
    html: finalBody.replace(/\n/g, '<br/>'),
  });

  const log = await EmailLog.create({
    customerId,
    customerName: customer.name,
    email: customer.email,
    subject: finalSubject,
    body: finalBody,
    type,
    status: result.success ? 'sent' : 'failed',
    error: result.error || '',
    sentBy: req.user._id,
    sentByName: req.user.name,
  });

  if (!result.success) {
    return res.status(502).json({ success: false, message: `Email send failed: ${result.error}`, log });
  }

  res.status(201).json({ success: true, log });
});

// @desc    Get email logs (filter by type/status/customer, pagination)
// @route   GET /api/emails?type=&status=&customerId=&page=&limit=
// @access  Private
const getEmailLogs = asyncHandler(async (req, res) => {
  const { type, status, customerId, page = 1, limit = 10 } = req.query;
  const conditions = [];

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    conditions.push({
      $or: [
        { sentBy: req.user._id },
        { customerId: { $in: customerIds } },
      ],
    });
  }

  if (type) conditions.push({ type });
  if (status) conditions.push({ status });
  if (customerId) conditions.push({ customerId });

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
    throw new Error('Cannot send test to a placeholder domain (@example.com or @crm.com). Please enter your real email address (e.g. Gmail or Outlook).');
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
          <li><strong>Relay Host:</strong> ${process.env.EMAIL_HOST || 'send.one.com'}:${process.env.EMAIL_PORT || '465'}</li>
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
    subject: `SmartCRM Deliverability Test — ${new Date().toLocaleTimeString()}`,
    body: 'Live SMTP Deliverability Verification dispatch.',
    type: 'general',
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
    message: `Test email successfully dispatched to ${cleanRecipient} via one.com! Please check your Inbox and Spam/Junk folder.`,
    messageId: result.messageId,
  });
});

module.exports = { sendCustomerEmail, getEmailLogs, testEmailDelivery };

