const axios = require('axios');

const getToken = () => process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
const getPhoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

/**
 * Clean and normalize phone numbers into international numeric format (e.g., '918239977386')
 * Handles Indian numbers (10 digits) with default country code '91'
 * Removes '+', '-', spaces, parentheses, etc.
 */
const cleanPhoneNumber = (rawPhone, defaultCountryCode = '91') => {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return '';

  // If starts with 00, strip leading 00
  if (digits.startsWith('00')) {
    digits = digits.substring(2);
  }

  // 10-digit standard Indian mobile (e.g. 8239977386 -> 918239977386)
  if (digits.length === 10) {
    return `${defaultCountryCode}${digits}`;
  }

  // 11 digits starting with 0 (e.g. 08239977386 -> 918239977386)
  if (digits.length === 11 && digits.startsWith('0')) {
    return `${defaultCountryCode}${digits.substring(1)}`;
  }

  return digits;
};

/**
 * Generate 1-click WhatsApp Web deep link
 * Opens web.whatsapp.com with the target phone and pre-filled message
 */
const getWhatsAppWebLink = (phone, message = '') => {
  const cleaned = cleanPhoneNumber(phone);
  const textParam = message ? `&text=${encodeURIComponent(message)}` : '';
  return `https://web.whatsapp.com/send?phone=${cleaned}${textParam}`;
};

/**
 * Generate universal WhatsApp mobile/desktop wa.me deep link
 */
const getWaMeLink = (phone, message = '') => {
  const cleaned = cleanPhoneNumber(phone);
  const textParam = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${cleaned}${textParam}`;
};

const BASE_URL = () => {
  const phoneId = getPhoneId();
  if (process.env.WHATSAPP_API_URL) {
    return `${process.env.WHATSAPP_API_URL.replace(/\/+$/, '')}/${phoneId}/messages`;
  }
  return `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v23.0'}/${phoneId}/messages`;
};

// Sends a free-form text message. Only works within Meta's 24-hour customer
// service window (i.e. after the customer has messaged you recently).
// For the first outbound message to a customer, use sendWhatsAppTemplate instead.
const sendWhatsAppText = async ({ to, message, text }) => {
  const token = getToken();
  const phoneId = getPhoneId();
  const cleanTo = cleanPhoneNumber(to);
  const messageBody = (message || text || '').trim();

  if (!cleanTo) {
    return { success: false, error: 'Recipient phone number is invalid' };
  }

  if (!messageBody) {
    return { success: false, error: 'Message body cannot be empty' };
  }

  if (!token || !phoneId) {
    return {
      success: false,
      isConfigured: false,
      error: 'WhatsApp credentials (WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID) are not configured in .env',
      waLink: getWhatsAppWebLink(cleanTo, messageBody),
      waMeLink: getWaMeLink(cleanTo, messageBody),
    };
  }

  try {
    const { data } = await axios.post(
      BASE_URL(),
      {
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'text',
        text: { body: messageBody },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return {
      success: true,
      providerMessageId: data.messages?.[0]?.id,
      cleanTo,
      waLink: getWhatsAppWebLink(cleanTo, messageBody),
      waMeLink: getWaMeLink(cleanTo, messageBody),
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      cleanTo,
      waLink: getWhatsAppWebLink(cleanTo, messageBody),
      waMeLink: getWaMeLink(cleanTo, messageBody),
    };
  }
};

// Sends a pre-approved template message (required for the first message to a
// customer, or after the 24-hour session window has closed).
// `templateName` must match a template already approved in Meta Business Manager.
// `params` is an array of strings filled into the template's {{1}}, {{2}}, etc.
const sendWhatsAppTemplate = async ({ to, templateName = 'hello_world', languageCode = 'en_US', params = [] }) => {
  const token = getToken();
  const phoneId = getPhoneId();
  const cleanTo = cleanPhoneNumber(to);

  if (!cleanTo) {
    return { success: false, error: 'Recipient phone number is invalid' };
  }

  if (!token || !phoneId) {
    return {
      success: false,
      isConfigured: false,
      error: 'WhatsApp credentials are not configured in .env',
      waLink: getWhatsAppWebLink(cleanTo),
      waMeLink: getWaMeLink(cleanTo),
    };
  }

  try {
    const { data } = await axios.post(
      BASE_URL(),
      {
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: params.length
            ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
            : [],
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return {
      success: true,
      providerMessageId: data.messages?.[0]?.id,
      cleanTo,
      waLink: getWhatsAppWebLink(cleanTo),
      waMeLink: getWaMeLink(cleanTo),
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      cleanTo,
      waLink: getWhatsAppWebLink(cleanTo),
      waMeLink: getWaMeLink(cleanTo),
    };
  }
};

module.exports = {
  cleanPhoneNumber,
  getWhatsAppWebLink,
  getWaMeLink,
  sendWhatsAppText,
  sendWhatsAppTemplate,
};

