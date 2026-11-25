const isAdminOrOwner = (user) => {
  const r = (user?.role || '').toLowerCase();
  return r === 'admin' || r === 'owner';
};

const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const WhatsAppLog = require('../models/WhatsAppLog');
const Customer = require('../models/Customer');
const baileysService = require('../services/baileysService');
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
  autoDiscoverMetaContact,
  PEYUG_OFFICIAL_TEMPLATES,
  getTemplateDetails,
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

  if (customer && !isAdminOrOwner(req.user)) {
    const isAssigned =
      (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
      customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('Access denied: You can only send WhatsApp messages to contacts assigned to you');
    }
  }

  const targetMobile = rawPhone || customer?.mobile || customer?.phone || customer?.alternateNumber;
  if (!targetMobile) {
    res.status(400);
    throw new Error('Recipient mobile number is required');
  }

  const cleanPhone = cleanPhoneNumber(targetMobile);
  const recipientName = customer?.name || name || 'Customer';

  // If a template is specified, resolve the exact approved template body
  const templateObj = req.body.templateName ? getTemplateDetails(req.body.templateName) : null;
  if (templateObj?.bodyText) {
    messageText = templateObj.bodyText;
  }

  let waLink = getWhatsAppWebLink(cleanPhone, messageText);
  let waMeLink = getWaMeLink(cleanPhone, messageText);

  // 1. If Built-in WhatsApp Client (Baileys) is connected, send directly through socket!
  if (baileysService.isConnected()) {
    const bResult = await baileysService.sendMessage(cleanPhone, messageText);
    if (bResult.success) {
      const log = await WhatsAppLog.create({
        customerId: customer?._id || undefined,
        customerName: recipientName,
        phone: cleanPhone || targetMobile,
        mobile: cleanPhone || targetMobile,
        message: messageText,
        templateName: req.body.templateName || '',
        type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom', 'greeting'].includes(type)
          ? (type === 'greeting' ? 'general' : type)
          : 'custom',
        status: 'delivered',
        deliveryMode: 'real_whatsapp',
        error: '',
        sentBy: req.user._id,
        sentByName: req.user.name,
        providerMessageId: bResult.messageId || `wa_socket_${Date.now()}`,
      });

      return res.status(201).json({
        success: true,
        deliveredVia: 'real_whatsapp',
        isRealWhatsApp: true,
        isCloudApi: false,
        status: 'delivered',
        message: messageText,
        templateName: req.body.templateName || '',
        recipient: {
          id: customer?._id,
          name: recipientName,
          phone: cleanPhone,
        },
        log,
      });
    }
  }

  // 2. Handle Real WhatsApp Web direct dispatch (if explicitly requested)
  const isDirectWeb = req.body.mode === 'wa_web' || req.body.mode === 'direct_web';
  if (isDirectWeb && !baileysService.isConnected()) {
    const log = await WhatsAppLog.create({
      customerId: customer?._id || undefined,
      customerName: recipientName,
      phone: cleanPhone || targetMobile,
      mobile: cleanPhone || targetMobile,
      message: messageText,
      templateName: req.body.templateName || '',
      type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom', 'greeting'].includes(type)
        ? (type === 'greeting' ? 'general' : type)
        : 'custom',
      status: 'delivered',
      deliveryMode: 'wa_web',
      error: '',
      sentBy: req.user._id,
      sentByName: req.user.name,
      providerMessageId: `wa_web_${Date.now()}`,
    });

    return res.status(201).json({
      success: true,
      deliveredVia: 'wa_web',
      isRealWhatsApp: true,
      isCloudApi: false,
      isTestMode: false,
      is24hWindowClosed: false,
      status: 'delivered',
      waLink,
      waMeLink,
      message: messageText,
      templateName: req.body.templateName || '',
      recipient: {
        id: customer?._id,
        name: recipientName,
        phone: cleanPhone,
      },
      log,
    });
  }

  // Attempt real delivery via Meta WhatsApp Cloud API if credentials configured
  await loadDbConfig();
  const token = getToken();
  const phoneId = getPhoneId();
  const isConfigured = Boolean(token && phoneId);

  let deliveryResult = { success: false };
  if (isConfigured) {
    if (req.body.templateName) {
      deliveryResult = await sendWhatsAppTemplate({
        to: cleanPhone,
        templateName: req.body.templateName,
        languageCode: req.body.languageCode || 'en_US',
        params: req.body.params || [],
      });
    } else {
      deliveryResult = await sendWhatsAppText({
        to: cleanPhone,
        message: messageText,
      });
    }
  }

  if (deliveryResult.bodyText) {
    messageText = deliveryResult.bodyText;
    waLink = getWhatsAppWebLink(cleanPhone, messageText);
    waMeLink = getWaMeLink(cleanPhone, messageText);
  }

  const isCloudSuccess = Boolean(deliveryResult.success);
  const is24hClosed = Boolean(
    deliveryResult.is24hWindowClosed ||
      String(deliveryResult.error || '').includes('131047')
  );

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
    templateName: req.body.templateName || '',
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
      : `failed_${Date.now()}`,
  });

  const statusCode = isCloudSuccess || !isConfigured ? 201 : 200;

  res.status(statusCode).json({
    success: isCloudSuccess || !isConfigured,
    deliveredVia: deliveryMode,
    isCloudApi: isCloudSuccess,
    isTestMode: !isConfigured,
    is24hWindowClosed: is24hClosed,
    waLink,
    waMeLink,
    message: messageText,
    templateName: req.body.templateName || '',
    recipient: {
      id: customer?._id,
      name: recipientName,
      phone: cleanPhone,
    },
    error: isCloudSuccess ? undefined : (isConfigured ? deliveryResult.error : undefined),
    warning: is24hClosed
      ? 'Customer has not messaged in the last 24 hours (Meta Policy #131047). Free text cannot be delivered until customer replies. Use an approved PeYug template below or click "Send via WhatsApp Web".'
      : (isCloudSuccess ? undefined : deliveryResult.error),
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

  if (customer && !isAdminOrOwner(req.user)) {
    const isAssigned =
      (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
      customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('Access denied: You can only send WhatsApp messages to contacts assigned to you');
    }
  }

  const targetMobile = rawPhone || customer?.mobile || customer?.phone || customer?.alternateNumber;
  if (!targetMobile) {
    res.status(400);
    throw new Error('This customer has no mobile number on file');
  }

  const cleanPhone = cleanPhoneNumber(targetMobile);
  const templateObj = getTemplateDetails(templateName);
  let resolvedBody = displayMessage || templateObj?.bodyText || `[Template: ${templateName}]`;

  let waLink = getWhatsAppWebLink(cleanPhone, resolvedBody);
  let waMeLink = getWaMeLink(cleanPhone, resolvedBody);

  // If Built-in WhatsApp (Baileys) is connected, send template body directly through socket!
  if (baileysService.isConnected()) {
    const bResult = await baileysService.sendMessage(cleanPhone, resolvedBody);
    if (bResult.success) {
      const log = await WhatsAppLog.create({
        customerId: customer?._id || undefined,
        customerName: customer?.name || 'Customer',
        phone: cleanPhone || targetMobile,
        mobile: cleanPhone || targetMobile,
        message: resolvedBody,
        templateName: templateName || '',
        type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom'].includes(type)
          ? type
          : 'template',
        status: 'delivered',
        deliveryMode: 'real_whatsapp',
        error: '',
        sentBy: req.user._id,
        sentByName: req.user.name,
        providerMessageId: bResult.messageId || `wa_socket_tpl_${Date.now()}`,
      });

      return res.status(201).json({
        success: true,
        deliveredVia: 'real_whatsapp',
        isRealWhatsApp: true,
        isCloudApi: false,
        message: resolvedBody,
        templateName: templateName || '',
        log,
      });
    }
  }

  // If Real WhatsApp mode is requested for template
  if (req.body.mode === 'wa_web' || req.body.mode === 'direct_web') {
    const log = await WhatsAppLog.create({
      customerId: customer?._id || undefined,
      customerName: customer?.name || 'Customer',
      phone: cleanPhone || targetMobile,
      mobile: cleanPhone || targetMobile,
      message: resolvedBody,
      templateName: templateName || '',
      type: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application', 'custom'].includes(type)
        ? type
        : 'template',
      status: 'delivered',
      deliveryMode: 'wa_web',
      error: '',
      sentBy: req.user._id,
      sentByName: req.user.name,
      providerMessageId: `wa_web_tpl_${Date.now()}`,
    });

    return res.status(201).json({
      success: true,
      deliveredVia: 'wa_web',
      isRealWhatsApp: true,
      isCloudApi: false,
      isTestMode: false,
      message: resolvedBody,
      templateName: templateName || '',
      waLink,
      waMeLink,
      log,
    });
  }

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

  if (result.bodyText) {
    resolvedBody = result.bodyText;
    waLink = getWhatsAppWebLink(cleanPhone, resolvedBody);
    waMeLink = getWaMeLink(cleanPhone, resolvedBody);
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
    message: resolvedBody,
    templateName: templateName || '',
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
    message: resolvedBody,
    templateName: templateName || '',
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
const verifyWebhook = async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  await loadDbConfig();
  const validTokens = new Set(
    [
      'peyug_crm_webhook_verify_sec_948f21',
      process.env.WHATSAPP_VERIFY_TOKEN,
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      cachedDbConfig?.verifyToken,
    ].filter(Boolean)
  );

  if (mode === 'subscribe' && token && validTokens.has(token)) {
    console.log('[Meta WhatsApp Webhook] Challenge verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[Meta WhatsApp Webhook] Verification rejected. Token received:', token);
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
              const updateData = { status: statusUpdate.status };
              if (statusUpdate.errors && statusUpdate.errors.length > 0) {
                const errDetails = statusUpdate.errors
                  .map((e) => `${e.title || e.message || 'Error'} (code ${e.code})`)
                  .join('; ');
                updateData.error = errDetails;
                console.warn(
                  `[Meta WhatsApp Webhook] Message ${statusUpdate.id} status=${statusUpdate.status} error=${errDetails}`
                );
              }
              await WhatsAppLog.findOneAndUpdate(
                { providerMessageId: statusUpdate.id },
                { $set: updateData }
              );
            }
          }

          // Inbound messages from customers
          const messages = value.messages || [];
          for (const inMsg of messages) {
            try {
              const fromPhone = inMsg.from; // e.g. '919251177886'
              const textBody =
                inMsg.text?.body ||
                (inMsg.button?.text ? `[Button: ${inMsg.button.text}]` : '[Media/Interactive]');
              const cleanDigits = String(fromPhone).slice(-10);

              const customer = await Customer.findOne({
                $or: [
                  { mobile: new RegExp(cleanDigits) },
                  { phone: new RegExp(cleanDigits) },
                ],
              });

              await WhatsAppLog.create({
                customerId: customer?._id || undefined,
                customerName:
                  customer?.name ||
                  value.contacts?.[0]?.profile?.name ||
                  `Customer (+${fromPhone})`,
                phone: fromPhone,
                mobile: fromPhone,
                message: textBody,
                type: 'custom',
                status: 'read',
                deliveryMode: 'cloud_api',
                providerMessageId: inMsg.id,
                sentByName: customer?.name || 'Customer (Inbound)',
              });
            } catch (inErr) {
              console.error('Error logging inbound WhatsApp message:', inErr.message);
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

// @desc    Auto-discover WhatsApp Phone Number & WABA details from Meta Access Token
// @route   POST /api/whatsapp/auto-discover
// @access  Private/Admin
const autoDiscoverContact = asyncHandler(async (req, res) => {
  const { token, phoneId, wabaId } = req.body || {};
  await loadDbConfig();
  const activeToken = (token || getToken() || '').trim();

  if (!activeToken) {
    res.status(400);
    throw new Error('Access token is required to auto-discover WhatsApp contact details');
  }

  const result = await autoDiscoverMetaContact(activeToken, phoneId, wabaId);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.error || 'Failed to discover WhatsApp contact details from token',
    });
  }

  res.json({
    success: true,
    message: `Discovered active WhatsApp contact: ${result.displayPhoneNumber || result.phoneNumberId} (${result.verifiedName || 'WhatsApp Business'})`,
    ...result,
  });
});

// @desc    Get WhatsApp API Configuration
// @route   GET /api/whatsapp/config
// @access  Private/Admin
const getConfig = asyncHandler(async (req, res) => {
  const dbConfig = await loadDbConfig();
  const token = getToken() || '';
  let phoneId = getPhoneId() || '';
  let wabaId = dbConfig?.wabaId || process.env.WHATSAPP_WABA_ID || '';

  const maskedToken = token.length > 8
    ? `${token.substring(0, 6)}••••••••${token.substring(token.length - 4)}`
    : (token ? '••••••••' : '');

  let verifiedName = dbConfig?.verifiedName || '';
  let displayPhoneNumber = dbConfig?.displayPhoneNumber || '';

  // If token is present but phoneId is not yet resolved, attempt auto-discovery
  if (token && !phoneId) {
    try {
      const disc = await autoDiscoverMetaContact(token);
      if (disc.success && disc.phoneNumberId) {
        phoneId = disc.phoneNumberId;
        verifiedName = disc.verifiedName || verifiedName;
        displayPhoneNumber = disc.displayPhoneNumber || displayPhoneNumber;
        wabaId = disc.wabaId || wabaId;
        setRuntimeWhatsAppConfig({
          phoneNumberId: disc.phoneNumberId,
          displayPhoneNumber: disc.displayPhoneNumber,
          verifiedName: disc.verifiedName,
          wabaId: disc.wabaId,
        });
      }
    } catch (_) {}
  } else if (token && phoneId && (!verifiedName || !displayPhoneNumber)) {
    try {
      const ver = await verifyMetaConnection(token, phoneId);
      if (ver.connected) {
        verifiedName = ver.verifiedName || verifiedName;
        displayPhoneNumber = ver.displayPhoneNumber || displayPhoneNumber;
      }
    } catch (_) {}
  }

  res.json({
    success: true,
    isConfigured: Boolean(token && phoneId),
    isTestMode: !Boolean(token && phoneId),
    phoneNumberId: phoneId,
    wabaId,
    maskedToken,
    hasToken: Boolean(token),
    verifiedName,
    displayPhoneNumber,
    webhookUrl: '/api/whatsapp/webhook',
    templates: PEYUG_OFFICIAL_TEMPLATES,
  });
});

// @desc    Update WhatsApp API Configuration (Access Token, Phone ID, WABA)
// @route   PUT /api/whatsapp/config
// @access  Private/Admin
const updateConfig = asyncHandler(async (req, res) => {
  const { accessToken, phoneNumberId, wabaId, autoDetect = true } = req.body;
  const SystemConfig = require('../models/SystemConfig');

  let current = await SystemConfig.findOne({ key: 'whatsapp_config' });
  const existingVal = current?.value || {};

  const cleanToken = accessToken !== undefined ? accessToken.trim() : (existingVal.accessToken || '');
  let cleanPhoneId = phoneNumberId !== undefined ? phoneNumberId.trim() : (existingVal.phoneNumberId || '');
  let cleanWabaId = wabaId !== undefined ? wabaId.trim() : (existingVal.wabaId || '');

  let discoveredDetails = null;

  // If token is provided, and either phone ID is missing OR token changed, auto-discover
  const isNewToken = Boolean(cleanToken && cleanToken !== existingVal.accessToken);
  if (cleanToken && (isNewToken || !cleanPhoneId) && autoDetect) {
    try {
      const disc = await autoDiscoverMetaContact(cleanToken, cleanPhoneId, cleanWabaId);
      if (disc.success) {
        discoveredDetails = disc;
        if (disc.phoneNumberId) cleanPhoneId = disc.phoneNumberId;
        if (disc.wabaId) cleanWabaId = disc.wabaId;
      }
    } catch (err) {
      console.warn('Auto-discovery during updateConfig failed:', err.message);
    }
  }

  const updatedVal = {
    accessToken: cleanToken,
    phoneNumberId: cleanPhoneId,
    wabaId: cleanWabaId,
    displayPhoneNumber: discoveredDetails?.displayPhoneNumber || existingVal.displayPhoneNumber || '',
    verifiedName: discoveredDetails?.verifiedName || existingVal.verifiedName || '',
    updatedAt: new Date(),
  };

  await SystemConfig.findOneAndUpdate(
    { key: 'whatsapp_config' },
    { value: updatedVal },
    { upsert: true, new: true }
  );

  setRuntimeWhatsAppConfig(updatedVal);

  res.json({
    success: true,
    message: updatedVal.displayPhoneNumber
      ? `WhatsApp API updated and connected to ${updatedVal.displayPhoneNumber} (${updatedVal.verifiedName || 'WhatsApp Business'})!`
      : 'WhatsApp API credentials updated successfully.',
    isConfigured: Boolean(updatedVal.accessToken && updatedVal.phoneNumberId),
    phoneNumberId: updatedVal.phoneNumberId,
    wabaId: updatedVal.wabaId,
    displayPhoneNumber: updatedVal.displayPhoneNumber,
    verifiedName: updatedVal.verifiedName,
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

// @desc    Get All Live Templates directly from Meta WABA + merged official list
// @route   GET /api/whatsapp/templates
// @access  Private
const getLiveTemplates = asyncHandler(async (req, res) => {
  const dbConfig = await loadDbConfig();
  const token = getToken();
  const wabaId = dbConfig?.wabaId || process.env.WHATSAPP_WABA_ID || '';

  let liveTemplates = [];
  if (token && wabaId) {
    try {
      const { data } = await axios.get(
        `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v23.0'}/${wabaId}/message_templates`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { limit: 100 },
        }
      );
      if (data && data.data) {
        liveTemplates = data.data.map((t) => {
          const bodyComp = (t.components || []).find((c) => c.type === 'BODY');
          const headerComp = (t.components || []).find((c) => c.type === 'HEADER');
          const buttonsComp = (t.components || []).find((c) => c.type === 'BUTTONS');
          return {
            name: t.name,
            label: t.name.replace(/_/g, ' '),
            status: t.status,
            language: t.language,
            category: t.category,
            hasImage: headerComp ? headerComp.format === 'IMAGE' : false,
            headerType: headerComp ? headerComp.format : 'NONE',
            bodyText: bodyComp ? bodyComp.text : '',
            buttons: buttonsComp ? buttonsComp.buttons : [],
            description: bodyComp?.text?.substring(0, 80) + '...' || '',
          };
        });
      }
    } catch (err) {
      console.warn('Could not fetch live Meta templates:', err.message);
    }
  }

  // Merge: Start with rich official templates with Hindi titles and details
  const merged = [...PEYUG_OFFICIAL_TEMPLATES];
  for (const lt of liveTemplates) {
    const existing = merged.find((m) => m.name === lt.name);
    if (!existing) {
      merged.push(lt);
    } else {
      existing.status = lt.status;
    }
  }

  res.json({
    success: true,
    count: merged.length,
    templates: merged,
    liveMetaCount: liveTemplates.length,
  });
});

// @desc    Create / Register New Meta WhatsApp Template
// @route   POST /api/whatsapp/templates
// @access  Private/Admin
const createMetaTemplate = asyncHandler(async (req, res) => {
  const { name, category = 'MARKETING', language = 'en_US', bodyText, hasImage = true } = req.body;

  if (!name || !bodyText) {
    res.status(400);
    throw new Error('Template name and bodyText are required');
  }

  const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const dbConfig = await loadDbConfig();
  const token = getToken();
  const wabaId = dbConfig?.wabaId || process.env.WHATSAPP_WABA_ID || '';

  if (!token || !wabaId) {
    res.status(400);
    throw new Error('Meta WABA credentials not configured');
  }

  const components = [];
  if (hasImage) {
    components.push({
      type: 'HEADER',
      format: 'IMAGE',
      example: {
        header_handle: ['https://peyug.in/assets/images/banner/PeYug.png'],
      },
    });
  }

  components.push({
    type: 'BODY',
    text: bodyText,
  });

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v23.0'}/${wabaId}/message_templates`,
      {
        name: cleanName,
        category,
        language,
        components,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    res.status(201).json({
      success: true,
      message: `Template "${cleanName}" submitted to Meta for approval! Status: ${data.status || 'PENDING'}`,
      template: data,
    });
  } catch (err) {
    res.status(400);
    throw new Error(err.response?.data?.error?.message || err.message);
  }
});

// @desc    Get Built-in WhatsApp Device status and QR code
// @route   GET /api/whatsapp/device/status
// @access  Private
const getDeviceStatus = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    ...baileysService.getStatus(),
  });
});

// @desc    Connect Built-in WhatsApp Device (starts QR generation)
// @route   POST /api/whatsapp/device/connect
// @access  Private
const connectDevice = asyncHandler(async (req, res) => {
  baileysService.initBaileys(true);
  const status = await baileysService.waitForQr(3000);
  res.json({
    success: true,
    ...status,
  });
});

// @desc    Disconnect Built-in WhatsApp Device
// @route   POST /api/whatsapp/device/disconnect
// @access  Private
const disconnectDevice = asyncHandler(async (req, res) => {
  await baileysService.disconnect();
  res.json({
    success: true,
    connected: false,
    status: 'disconnected',
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
  autoDiscoverContact,
  getLiveTemplates,
  createMetaTemplate,
  getDeviceStatus,
  connectDevice,
  disconnectDevice,
};
