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
  loadDbConfig,
  getToken,
  getPhoneId,
  setRuntimeWhatsAppConfig,
  verifyMetaConnection,
} = require('../utils/sendWhatsApp');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// @desc    Send WhatsApp Message (Meta Cloud API or Instant CRM Test Mode)
// @route   POST /api/whatsapp/send
// @access  Private
const sendMessage = asyncHandler(async (req, res) => {
  const { customerId, phone, mobile, name, message, text, type = 'custom' } = req.body;
  let messageText = (message || text || '').trim();

  // If message text is empty, generate an appropriate polite default based on type
  if (!messageText) {
    if (type === 'greeting') {
      messageText = `Hello ${name || 'there'}! Warm greetings from our team. Wishing you a wonderful day!`;
    } else if (type === 'follow-up') {
      messageText = `Hello ${name || 'there'}, following up regarding our recent discussion. Please let us know if you need any assistance!`;
    } else {
      messageText = `Hello ${name || 'there'}, thank you for connecting with us!`;
    }
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
  await loadDbConfig();
  const token = getToken();
  const phoneId = getPhoneId();
  const isConfigured = Boolean(token && phoneId);

  let deliveryResult = { success: false };
  if (isConfigured) {
    deliveryResult = await sendWhatsAppText({
      to: cleanPhone,
      message: messageText,
    });
  }

  const isCloudSuccess = Boolean(deliveryResult.success);
  // If Cloud API configured and sent: 'cloud_api'
  // If not configured: 'test_mode' (allows in-CRM test sending without tokens)
  // If configured but returned error: 'cloud_api' with error
  const deliveryMode = isCloudSuccess
    ? 'cloud_api'
    : (!isConfigured ? 'test_mode' : 'cloud_api');

  const logStatus = isCloudSuccess
    ? 'sent'
    : (!isConfigured ? 'delivered' : 'failed');

  const log = await WhatsAppLog.create({
    customerId: customer?._id || undefined,
    customerName: recipientName,
    phone: cleanPhone || targetMobile,
    mobile: cleanPhone || targetMobile,
    message: messageText,
    type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom', 'greeting'].includes(type)
      ? (type === 'greeting' ? 'general' : type)
      : 'custom',
    status: logStatus,
    deliveryMode,
    error: isCloudSuccess ? '' : (!isConfigured ? '' : (deliveryResult.error || 'Meta Cloud API delivery failed')),
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: isCloudSuccess
      ? (deliveryResult.providerMessageId || '')
      : `test_msg_${Date.now()}`,
  });

  res.status(201).json({
    success: true,
    deliveredVia: deliveryMode,
    isCloudApi: isCloudSuccess,
    isTestMode: !isConfigured,
    waLink,
    waMeLink,
    message: messageText,
    recipient: {
      id: customer?._id,
      name: recipientName,
      phone: cleanPhone,
    },
    notice: !isConfigured
      ? 'Delivered in CRM Testing Mode. Tokens can be added later in Admin Panel to route to real external numbers.'
      : undefined,
    warning: isCloudSuccess ? undefined : (isConfigured ? deliveryResult.error : undefined),
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

  await loadDbConfig();
  const token = getToken();
  const phoneId = getPhoneId();
  const isConfigured = Boolean(token && phoneId);

  let result = { success: false };
  if (isConfigured) {
    result = await sendWhatsAppTemplate({
      to: cleanPhone,
      templateName,
      languageCode,
      params,
    });
  }

  const isCloudSuccess = Boolean(result.success);
  const deliveryMode = isCloudSuccess
    ? 'cloud_api'
    : (!isConfigured ? 'test_mode' : 'cloud_api');
  const logStatus = isCloudSuccess
    ? 'sent'
    : (!isConfigured ? 'delivered' : 'failed');

  const log = await WhatsAppLog.create({
    customerId: customer?._id || undefined,
    customerName: customer?.name || 'Customer',
    phone: cleanPhone || targetMobile,
    mobile: cleanPhone || targetMobile,
    message: displayMessage || `[Template: ${templateName}]`,
    type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom'].includes(type)
      ? type
      : 'template',
    status: logStatus,
    deliveryMode,
    error: isCloudSuccess ? '' : (!isConfigured ? '' : (result.error || '')),
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: isCloudSuccess ? (result.providerMessageId || '') : `test_tpl_${Date.now()}`,
  });

  res.status(201).json({
    success: true,
    deliveredVia: deliveryMode,
    isCloudApi: isCloudSuccess,
    isTestMode: !isConfigured,
    waLink,
    waMeLink,
    log,
    notice: !isConfigured
      ? 'Delivered in CRM Testing Mode. Add Meta Cloud API credentials in Admin Panel to route to real external numbers.'
      : undefined,
    warning: isCloudSuccess ? undefined : (isConfigured ? result.error : undefined),
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

  await loadDbConfig();
  const token = getToken();
  const phoneId = getPhoneId();
  const isConfigured = Boolean(token && phoneId);

  let result = { success: false };
  if (isConfigured) {
    result = await sendWhatsAppText({
      to: cleanPhone,
      message: reminderText,
    });
  }

  const isCloudSuccess = Boolean(result.success);
  const deliveryMode = isCloudSuccess
    ? 'cloud_api'
    : (!isConfigured ? 'test_mode' : 'cloud_api');
  const logStatus = isCloudSuccess
    ? 'sent'
    : (!isConfigured ? 'delivered' : 'failed');

  const log = await WhatsAppLog.create({
    customerId: customer?._id || undefined,
    customerName: customer?.name || 'Customer',
    phone: cleanPhone || reminderPhone,
    mobile: cleanPhone || reminderPhone,
    message: reminderText,
    type: 'follow-up',
    status: logStatus,
    deliveryMode,
    error: isCloudSuccess ? '' : (!isConfigured ? '' : (result.error || '')),
    sentBy: req.user._id,
    sentByName: req.user.name,
    providerMessageId: isCloudSuccess ? (result.providerMessageId || '') : `test_rem_${Date.now()}`,
  });

  res.status(201).json({
    success: true,
    deliveredVia: deliveryMode,
    isCloudApi: isCloudSuccess,
    isTestMode: !isConfigured,
    waLink,
    waMeLink,
    log,
    notice: !isConfigured
      ? 'Delivered in CRM Testing Mode. Add Meta Cloud API credentials in Admin Panel to route to real external numbers.'
      : undefined,
    warning: isCloudSuccess ? undefined : (isConfigured ? result.error : undefined),
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

// @desc    Get WhatsApp API Configuration
// @route   GET /api/whatsapp/config
// @access  Private/Admin
const getConfig = asyncHandler(async (req, res) => {
  await loadDbConfig();
  const token = getToken() || '';
  const phoneId = getPhoneId() || '';
  const wabaId = process.env.WHATSAPP_WABA_ID || '';

  const maskedToken = token.length > 8
    ? `${token.substring(0, 6)}••••••••${token.substring(token.length - 4)}`
    : (token ? '••••••••' : '');

  res.json({
    success: true,
    isConfigured: Boolean(token && phoneId),
    isTestMode: !Boolean(token && phoneId),
    phoneNumberId: phoneId,
    wabaId,
    maskedToken,
    hasToken: Boolean(token),
    webhookUrl: '/api/whatsapp/webhook',
  });
});

// @desc    Update WhatsApp API Configuration (Access Token, Phone ID, WABA)
// @route   PUT /api/whatsapp/config
// @access  Private/Admin
const updateConfig = asyncHandler(async (req, res) => {
  const { accessToken, phoneNumberId, wabaId } = req.body;
  const SystemConfig = require('../models/SystemConfig');

  let current = await SystemConfig.findOne({ key: 'whatsapp_config' });
  const existingVal = current?.value || {};

  const updatedVal = {
    accessToken: accessToken !== undefined ? accessToken.trim() : existingVal.accessToken,
    phoneNumberId: phoneNumberId !== undefined ? phoneNumberId.trim() : existingVal.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: wabaId !== undefined ? wabaId.trim() : existingVal.wabaId || process.env.WHATSAPP_WABA_ID,
  };

  await SystemConfig.findOneAndUpdate(
    { key: 'whatsapp_config' },
    { value: updatedVal },
    { upsert: true, new: true }
  );

  setRuntimeWhatsAppConfig(updatedVal);

  res.json({
    success: true,
    message: 'WhatsApp API credentials updated successfully. Messages will now send from your registered company number.',
    isConfigured: Boolean(updatedVal.accessToken && updatedVal.phoneNumberId),
    phoneNumberId: updatedVal.phoneNumberId,
    wabaId: updatedVal.wabaId,
  });
});

// @desc    Test Meta WhatsApp Connection Handshake
// @route   POST /api/whatsapp/test-connection
// @access  Private/Admin
const testConnection = asyncHandler(async (req, res) => {
  const { token, phoneId } = req.body || {};
  const result = await verifyMetaConnection(token, phoneId);

  if (!result.connected) {
    return res.status(400).json({
      success: false,
      message: `Meta Cloud API Handshake Failed: ${result.error}`,
      details: result,
    });
  }

  res.json({
    success: true,
    message: `Meta Cloud API Handshake Successful! Verified as "${result.verifiedName || 'WhatsApp Business'}" (${result.displayPhoneNumber || result.phoneId})`,
    details: result,
  });
});

module.exports = {
  sendMessage,
  sendTemplate,
  sendFollowUpReminder,
  getLogs,
  verifyWebhook,
  receiveWebhook,
  getConfig,
  updateConfig,
  testConnection,
};
