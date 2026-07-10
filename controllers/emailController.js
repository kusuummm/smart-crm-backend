const asyncHandler = require('express-async-handler');
const EmailLog = require('../models/EmailLog');
const Customer = require('../models/Customer');
const sendEmail = require('../utils/sendEmail');

const scopeToRole = (req, filter = {}) => {
  if (req.user.role === 'telecaller') {
    filter.sentBy = req.user._id;
  }
  return filter;
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
    subject: 'Special Offer Just For You',
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
  if (!customer.email) {
    res.status(400);
    throw new Error('This customer has no email address on file');
  }

  const template = TEMPLATES[type] ? TEMPLATES[type](customer) : {};
  const finalSubject = subject || template.subject || 'Message from SmartCRM';
  const finalBody = body || template.body || '';

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
  const filter = scopeToRole(req);

  if (type) filter.type = type;
  if (status) filter.status = status;
  if (customerId) filter.customerId = customerId;

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

module.exports = { sendCustomerEmail, getEmailLogs };
