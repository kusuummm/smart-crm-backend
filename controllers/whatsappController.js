const asyncHandler = require('express-async-handler');
const WhatsAppLog = require('../models/WhatsAppLog');
const Customer = require('../models/Customer');
const { sendWhatsAppTemplate } = require('../utils/sendWhatsApp');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// @desc    Send WhatsApp Message (Meta hello_world template default)
// @route   POST /api/whatsapp/send
// @access  Private
const sendMessage = asyncHandler(async (req, res) => {
  const { customerId, type = 'follow-up' } = req.body;

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
      throw new Error('You can only send WhatsApp messages to customers assigned to you');
    }
  }

  if (!customer.mobile) {
    res.status(400);
    throw new Error('This customer has no mobile number on file');
  }

  // Meta default template
  const result = await sendWhatsAppTemplate({
    to: customer.mobile,
    templateName: 'hello_world',
    languageCode: 'en_US',
    params: [],
  });

  const log = await WhatsAppLog.create({
    customerId,
    customerName: customer.name,
    phone: customer.mobile,
    message: 'hello_world template',
    type,
    status: result.success ? 'sent' : 'failed',
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: result.providerMessageId || '',
  });

  if (!result.success) {
    return res.status(502).json({
      success: false,
      message: `WhatsApp send failed: ${result.error}`,
      log,
    });
  }

  res.status(201).json({ success: true, log });
});

// @desc    Send Custom Template
// @route   POST /api/whatsapp/send-template
// @access  Private
const sendTemplate = asyncHandler(async (req, res) => {
  const {
    customerId,
    templateName,
    languageCode = 'en_US',
    params = [],
    type = 'template',
    displayMessage,
  } = req.body;

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
      throw new Error('You can only send WhatsApp messages to customers assigned to you');
    }
  }

  const result = await sendWhatsAppTemplate({
    to: customer.mobile,
    templateName,
    languageCode,
    params,
  });

  const log = await WhatsAppLog.create({
    customerId,
    customerName: customer.name,
    phone: customer.mobile,
    message: displayMessage || `[Template: ${templateName}]`,
    type,
    status: result.success ? 'sent' : 'failed',
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: result.providerMessageId || '',
  });

  if (!result.success) {
    return res.status(502).json({
      success: false,
      message: `WhatsApp send failed: ${result.error}`,
      log,
    });
  }

  res.status(201).json({ success: true, log });
});

// @desc    Follow Up Reminder
// @route   POST /api/whatsapp/followup-reminder
// @access  Private
const sendFollowUpReminder = asyncHandler(async (req, res) => {
  const { customerId } = req.body;

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
      throw new Error('You can only send WhatsApp reminders to customers assigned to you');
    }
  }

  const result = await sendWhatsAppTemplate({
    to: customer.mobile,
    templateName,
    languageCode: 'en_US',
    params: [],
  });

  const log = await WhatsAppLog.create({
    customerId,
    customerName: customer.name,
    phone: customer.mobile,
    message: 'hello_world followup',
    type: 'follow-up',
    status: result.success ? 'sent' : 'failed',
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: result.providerMessageId || '',
  });

  if (!result.success) {
    return res.status(502).json({
      success: false,
      message: `WhatsApp send failed: ${result.error}`,
      log,
    });
  }

  res.status(201).json({ success: true, log });
});

// @desc    Get WhatsApp Logs
// @route   GET /api/whatsapp?type=&status=&customerId=&page=&limit=
// @access  Private
const getLogs = asyncHandler(async (req, res) => {
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
    WhatsAppLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    WhatsAppLog.countDocuments(filter),
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

// @desc    Webhook Verify
// @route   GET /api/whatsapp/webhook
// @access  Public
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
};

// @desc    Receive Meta Updates
// @route   POST /api/whatsapp/webhook
// @access  Public
const receiveWebhook = asyncHandler(async (req, res) => {
  const statusUpdate = req.body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];

  if (statusUpdate) {
    await WhatsAppLog.findOneAndUpdate(
      { providerMessageId: statusUpdate.id },
      { status: statusUpdate.status }
    );
  }

  res.sendStatus(200);
});

module.exports = {
  sendMessage,
  sendTemplate,
  sendFollowUpReminder,
  getLogs,
  verifyWebhook,
  receiveWebhook,
};