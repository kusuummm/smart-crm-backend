const axios = require('axios');

const getToken = () => process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
const getPhoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

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
const sendWhatsAppText = async ({ to, message }) => {
  const token = getToken();
  if (!token || !getPhoneId()) {
    return { success: false, error: 'WhatsApp credentials are not configured in .env' };
  }

  try {
    const { data } = await axios.post(
      BASE_URL(),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return { success: true, providerMessageId: data.messages?.[0]?.id };
  } catch (error) {
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
};

// Sends a pre-approved template message (required for the first message to a
// customer, or after the 24-hour session window has closed).
// `templateName` must match a template already approved in Meta Business Manager.
// `params` is an array of strings filled into the template's {{1}}, {{2}}, etc.
const sendWhatsAppTemplate = async ({ to, templateName, languageCode = 'en_US', params = [] }) => {
  const token = getToken();
  if (!token || !getPhoneId()) {
    return { success: false, error: 'WhatsApp credentials are not configured in .env' };
  }

  try {
    const { data } = await axios.post(
      BASE_URL(),
      {
        messaging_product: 'whatsapp',
        to,
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
    return { success: true, providerMessageId: data.messages?.[0]?.id };
  } catch (error) {
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
};

module.exports = { sendWhatsAppText, sendWhatsAppTemplate };
