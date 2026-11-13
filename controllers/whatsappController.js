const crypto = require('crypto');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const WhatsAppLog = require('../models/WhatsAppLog');
const Customer = require('../models/Customer');
const {
  cleanPhoneNumber,
  getWhatsAppWebLink,
  getWaMeLink,
  sendWhatsAppText,
  sendWhatsAppTemplate,
} = require('../utils/sendWhatsApp');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// @desc    Send WhatsApp Message (Meta Cloud API with automatic WhatsApp Web / wa.me bridge fallback)
// @route   POST /api/whatsapp/send
// @access  Private
const sendMessage = asyncHandler(async (req, res) => {
  const { customerId, phone, mobile, name, message, text, type = 'custom' } = req.body;
  const messageText = (message || text || '').trim();

  if (!messageText) {
    res.status(400);
    throw new Error('Message body cannot be empty');
  }

  let customer = null;
  if (customerId && mongoose.isValidObjectId(customerId)) {
    customer = await Customer.findById(customerId);
  }

  const rawPhone = phone || mobile || customer?.mobile || customer?.phone || customer?.alternateNumber;
  if (!customer && rawPhone) {
    // Try to find customer by phone or mobile
    customer = await Customer.findOne({
      $or: [{ mobile: rawPhone }, { phone: rawPhone }, { alternateNumber: rawPhone }],
    });
  }

  const callerRole = (req.user?.role || '').toLowerCase();
  if (customer && !['admin', 'owner', 'manager'].includes(callerRole)) {
    const isAssigned =
      (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
      customer.assignedTelecaller === req.user.name ||
      !customer.telecallerId;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only send WhatsApp messages to customers assigned to you');
    }
  }

  const targetMobile = rawPhone || customer?.mobile || customer?.phone || customer?.alternateNumber;
  if (!targetMobile) {
    res.status(400);
    throw new Error('Recipient mobile number is required');
  }

  const cleanPhone = cleanPhoneNumber(targetMobile);
  const recipientName = customer?.name || name || 'Customer';
  const waLink = getWhatsAppWebLink(cleanPhone, messageText);
  const waMeLink = getWaMeLink(cleanPhone, messageText);

  // Attempt real delivery via Meta WhatsApp Cloud API if credentials configured
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

  let deliveryResult = { success: false };
  if (token && phoneId) {
    deliveryResult = await sendWhatsAppText({
      to: cleanPhone,
      message: messageText,
    });
  }

  const isCloudSuccess = Boolean(deliveryResult.success);
  const logStatus = isCloudSuccess ? 'sent' : 'logged';
  const deliveryMode = isCloudSuccess ? 'cloud_api' : 'wa_link';

  const log = await WhatsAppLog.create({
    customerId: customer?._id || undefined,
    customerName: recipientName,
    phone: cleanPhone || targetMobile,
    mobile: cleanPhone || targetMobile,
    message: messageText,
    type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom'].includes(type)
      ? type
      : 'custom',
    status: logStatus,
    deliveryMode,
    error: isCloudSuccess ? '' : (deliveryResult.error || 'Direct wa_link bridge mode active'),
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: deliveryResult.providerMessageId || '',
  });

  res.status(201).json({
    success: true,
    deliveredVia: deliveryMode,
    isCloudApi: isCloudSuccess,
    waLink,
    waMeLink,
    message: messageText,
    recipient: {
      id: customer?._id,
      name: recipientName,
      phone: cleanPhone,
    },
    warning: isCloudSuccess ? undefined : deliveryResult.error,
    log,
  });
});

// @desc    Send Custom Template
// @route   POST /api/whatsapp/send-template
// @access  Private
const sendTemplate = asyncHandler(async (req, res) => {
  const {
    customerId,
    phone,
    templateName,
    languageCode = 'en_US',
    params = [],
    type = 'template',
    displayMessage,
  } = req.body;

  let customer = null;
  if (customerId && mongoose.isValidObjectId(customerId)) {
    customer = await Customer.findById(customerId);
  }

  const rawPhone = phone || customer?.mobile || customer?.phone || customer?.alternateNumber;
  if (!customer && rawPhone) {
    customer = await Customer.findOne({
      $or: [{ mobile: rawPhone }, { phone: rawPhone }, { alternateNumber: rawPhone }],
    });
  }

  const callerRole = (req.user?.role || '').toLowerCase();
  if (customer && !['admin', 'owner', 'manager'].includes(callerRole)) {
    const isAssigned =
      (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
      customer.assignedTelecaller === req.user.name ||
      !customer.telecallerId;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only send WhatsApp messages to customers assigned to you');
    }
  }

  const targetMobile = rawPhone || customer?.mobile || customer?.phone || customer?.alternateNumber;
  if (!targetMobile) {
    res.status(400);
    throw new Error('This customer has no mobile number on file');
  }

  const cleanPhone = cleanPhoneNumber(targetMobile);
  const waLink = getWhatsAppWebLink(cleanPhone, displayMessage || `[Template: ${templateName}]`);
  const waMeLink = getWaMeLink(cleanPhone, displayMessage || `[Template: ${templateName}]`);

  const result = await sendWhatsAppTemplate({
    to: cleanPhone,
    templateName,
    languageCode,
    params,
  });

  const isCloudSuccess = Boolean(result.success);
  const log = await WhatsAppLog.create({
    customerId: customer?._id || undefined,
    customerName: customer?.name || 'Customer',
    phone: cleanPhone || targetMobile,
    mobile: cleanPhone || targetMobile,
    message: displayMessage || `[Template: ${templateName}]`,
    type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom'].includes(type)
      ? type
      : 'template',
    status: isCloudSuccess ? 'sent' : 'logged',
    deliveryMode: isCloudSuccess ? 'cloud_api' : 'wa_link',
    error: isCloudSuccess ? '' : (result.error || ''),
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: result.providerMessageId || '',
  });

  res.status(201).json({
    success: true,
    deliveredVia: isCloudSuccess ? 'cloud_api' : 'wa_link',
    isCloudApi: isCloudSuccess,
    waLink,
    waMeLink,
    log,
    warning: isCloudSuccess ? undefined : result.error,
  });
});

// @desc    Follow Up Reminder
// @route   POST /api/whatsapp/followup-reminder
// @access  Private
const sendFollowUpReminder = asyncHandler(async (req, res) => {
  const { customerId, phone, message } = req.body;

  let customer = null;
  if (customerId && mongoose.isValidObjectId(customerId)) {
    customer = await Customer.findById(customerId);
  }

  const reminderPhone = phone || customer?.mobile || customer?.phone || customer?.alternateNumber;
  if (!reminderPhone) {
    res.status(400);
    throw new Error('This customer has no mobile number on file');
  }

  const cleanPhone = cleanPhoneNumber(reminderPhone);
  const reminderText = message || `Hello ${customer?.name || 'there'}, this is a follow-up reminder from our team regarding your inquiry. Please let us know if you need any assistance!`;
  const waLink = getWhatsAppWebLink(cleanPhone, reminderText);
  const waMeLink = getWaMeLink(cleanPhone, reminderText);

  const result = await sendWhatsAppText({
    to: cleanPhone,
    message: reminderText,
  });

  const isCloudSuccess = Boolean(result.success);
  const log = await WhatsAppLog.create({
    customerId: customer?._id || undefined,
    customerName: customer?.name || 'Customer',
    phone: cleanPhone || reminderPhone,
    mobile: cleanPhone || reminderPhone,
    message: reminderText,
    type: 'follow-up',
    status: isCloudSuccess ? 'sent' : 'logged',
    deliveryMode: isCloudSuccess ? 'cloud_api' : 'wa_link',
    error: isCloudSuccess ? '' : (result.error || ''),
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: result.providerMessageId || '',
  });

  res.status(201).json({
    success: true,
    deliveredVia: isCloudSuccess ? 'cloud_api' : 'wa_link',
    isCloudApi: isCloudSuccess,
    waLink,
    waMeLink,
    log,
  });
});

// @desc    Get WhatsApp Logs
// @route   GET /api/whatsapp?type=&status=&customerId=&phone=&page=&limit=
// @access  Private
const getLogs = asyncHandler(async (req, res) => {
  const { type, status, customerId, phone, page = 1, limit = 10, sentBy } = req.query;
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
  if (phone) {
    const clean = cleanPhoneNumber(phone);
    conditions.push({
      $or: [
        { phone },
        { mobile: phone },
        { phone: clean },
        { mobile: clean },
        { phone: { $regex: clean.slice(-10), $options: 'i' } },
      ],
    });
  }

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
