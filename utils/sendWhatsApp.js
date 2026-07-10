const axios = require('axios');

const BASE_URL = () =>
  `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v20.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Sends a free-form text message. Only works within Meta's 24-hour customer
// service window (i.e. after the customer has messaged you recently).
// For the first outbound message to a customer, use sendWhatsAppTemplate instead.
const sendWhatsAppText = async ({ to, message }) => {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
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
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
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
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
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
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
    return { success: true, providerMessageId: data.messages?.[0]?.id };
  } catch (error) {
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
};

module.exports = { sendWhatsAppText, sendWhatsAppTemplate };
