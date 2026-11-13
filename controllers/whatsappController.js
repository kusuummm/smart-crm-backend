const crypto = require('crypto');
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

  const callerRole = (req.user?.role || '').toLowerCase();
  if (!['admin', 'owner', 'manager'].includes(callerRole)) {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only send WhatsApp messages to customers assigned to you');
    }
  }

  const targetMobile = customer.mobile || customer.phone || customer.alternateNumber;
  if (!targetMobile) {
    res.status(400);
    throw new Error('This customer has no mobile number on file');
  }

  // Meta default template
  const result = await sendWhatsAppTemplate({
    to: targetMobile,
    templateName: 'hello_world',
    languageCode: 'en_US',
    params: [],
  });

  const log = await WhatsAppLog.create({
    customerId,
    customerName: customer.name,
    phone: targetMobile,
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

  const callerRole = (req.user?.role || '').toLowerCase();
  if (!['admin', 'owner', 'manager'].includes(callerRole)) {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only send WhatsApp messages to customers assigned to you');
    }
  }

  const targetMobile = customer.mobile || customer.phone || customer.alternateNumber;
  if (!targetMobile) {
    res.status(400);
    throw new Error('This customer has no mobile number on file');
  }

  const result = await sendWhatsAppTemplate({
    to: targetMobile,
    templateName,
    languageCode,
    params,
  });

  const log = await WhatsAppLog.create({
    customerId,
    customerName: customer.name,
    phone: targetMobile,
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

  const callerRole = (req.user?.role || '').toLowerCase();
  if (!['admin', 'owner', 'manager'].includes(callerRole)) {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only send WhatsApp reminders to customers assigned to you');
    }
  }

  const reminderPhone = customer.mobile || customer.phone || customer.alternateNumber;
  if (!reminderPhone) {
    res.status(400);
    throw new Error('This customer has no mobile number on file');
  }

  const result = await sendWhatsAppTemplate({
    to: reminderPhone,
    templateName: 'hello_world',
    languageCode: 'en_US',
    params: [],
  });

  const log = await WhatsAppLog.create({
    customerId,
    customerName: customer.name,
    phone: reminderPhone,
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
  const { type, status, customerId, page = 1, limit = 10, sentBy } = req.query;
  const conditions = [];

  const callerRole = (req.user?.role || '').toLowerCase();
  const isSupervisor = ['admin', 'owner', 'manager'].includes(callerRole);
  if (!isSupervisor) {
    conditions.push({ sentBy: req.user._id });
  } else if (sentBy && sentBy !== 'all') {
    conditions.push({ sentBy });
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

// @desc    Webhook Verify (GET /api/whatsapp/webhook)
// @route   GET /api/whatsapp/webhook
// @access  Public
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && token && token === expectedToken) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
};

// @desc    Receive Meta Updates (POST /api/whatsapp/webhook)
// @route   POST /api/whatsapp/webhook
// @access  Public
const receiveWebhook = (req, res) => {
  // 1. Verify X-Hub-Signature-256 against WHATSAPP_APP_SECRET if configured
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = req.headers['x-hub-signature-256'];

  if (appSecret && signature) {
    try {
      const hmac = crypto.createHmac('sha256', appSecret);
      const payload = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
      const digest = `sha256=${hmac.update(payload).digest('hex')}`;

      const sigBuf = Buffer.from(signature);
      const digBuf = Buffer.from(digest);
      if (sigBuf.length !== digBuf.length || !crypto.timingSafeEqual(sigBuf, digBuf)) {
        console.warn('WhatsApp webhook signature verification failed.');
        return res.sendStatus(401);
      }
    } catch (err) {
      console.warn('Webhook signature verification error:', err.message);
      return res.sendStatus(401);
    }
  }

  // 2. Return 200 immediately to Meta (Meta retries on timeout)
  res.sendStatus(200);

  // 3. Process status updates and template events asynchronously
  setImmediate(async () => {
    try {
      const entries = req.body?.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change?.value;
          if (!value) continue;

          // Delivery/read status updates
          const statuses = value.statuses || [];
          for (const statusUpdate of statuses) {
            if (statusUpdate.id) {
              await WhatsAppLog.findOneAndUpdate(
                { providerMessageId: statusUpdate.id },
                { status: statusUpdate.status }
              );
            }
          }

          // Message template status updates (e.g. APPROVED, REJECTED)
          if (change.field === 'message_template_status_update') {
            console.log(
              `[Meta WhatsApp] Template update for ${value.message_template_name}: ${value.event}`
            );
          }
        }
      }
    } catch (err) {
      console.error('Error processing WhatsApp webhook asynchronously:', err);
    }
  });
};

module.exports = {
  sendMessage,
  sendTemplate,
  sendFollowUpReminder,
  getLogs,
  verifyWebhook,
  receiveWebhook,
};
