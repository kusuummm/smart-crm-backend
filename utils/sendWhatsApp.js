const mongoose = require('mongoose');
const axios = require('axios');

let cachedDbConfig = null;

// Dynamic defaults from environment (no hardcoded credentials)
const getEnvPhoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || '';
const getEnvWabaId = () => process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
const getEnvToken = () => process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || '';

/**
 * Auto-discover WhatsApp Business Phone Number ID and account details using Meta Graph API.
 * Given only an access token, it automatically queries assigned WABAs and phone numbers.
 */
const autoDiscoverMetaContact = async (tokenOverride, phoneIdOverride, wabaIdOverride) => {
  const token = (tokenOverride || getToken() || '').trim();
  const phoneId = (phoneIdOverride || '').trim();
  const wabaId = (wabaIdOverride || '').trim();

  if (!token) {
    return {
      success: false,
      error: 'WhatsApp Access Token is required to discover contact details',
    };
  }

  const version = process.env.WHATSAPP_API_VERSION || 'v23.0';
  const headers = { Authorization: `Bearer ${token}` };

  // 1. If a specific phoneId is provided or configured, query it directly
  if (phoneId) {
    try {
      const { data } = await axios.get(`https://graph.facebook.com/${version}/${phoneId}`, {
        headers,
        params: { fields: 'id,verified_name,display_phone_number,quality_rating,code_verification_status,whatsapp_business_account' },
        timeout: 10000,
      });
      return {
        success: true,
        phoneNumberId: data.id || phoneId,
        displayPhoneNumber: data.display_phone_number || '',
        verifiedName: data.verified_name || '',
        qualityRating: data.quality_rating || '',
        verificationStatus: data.code_verification_status || '',
        wabaId: data.whatsapp_business_account?.id || wabaId || '',
        allNumbers: [
          {
            id: data.id || phoneId,
            displayPhoneNumber: data.display_phone_number || '',
            verifiedName: data.verified_name || '',
            qualityRating: data.quality_rating || '',
          },
        ],
      };
    } catch (_) {
      // Continue to broader discovery if direct lookup fails
    }
  }

  const collectedNumbers = [];
  let discoveredWabaId = wabaId || getEnvWabaId();

  // 2. Query assigned WhatsApp Business Accounts for this token
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/${version}/me/assigned_whatsapp_business_accounts`,
      {
        headers,
        params: {
          fields: 'id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status,quality_rating}',
          limit: 25,
        },
        timeout: 10000,
      }
    );

    if (data?.data && Array.isArray(data.data)) {
      for (const account of data.data) {
        if (!discoveredWabaId && account.id) {
          discoveredWabaId = account.id;
        }
        const nums = account.phone_numbers?.data || [];
        for (const n of nums) {
          collectedNumbers.push({
            id: n.id,
            displayPhoneNumber: n.display_phone_number || '',
            verifiedName: n.verified_name || account.name || '',
            qualityRating: n.quality_rating || '',
            verificationStatus: n.code_verification_status || '',
            wabaId: account.id,
            wabaName: account.name || '',
          });
        }
      }
    }
  } catch (_) {}

  // 3. If no numbers found yet, and we have a wabaId, query WABA phone_numbers directly
  if (collectedNumbers.length === 0 && discoveredWabaId) {
    try {
      const { data } = await axios.get(
        `https://graph.facebook.com/${version}/${discoveredWabaId}/phone_numbers`,
        {
          headers,
          params: { fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating' },
          timeout: 10000,
        }
      );
      if (data?.data && Array.isArray(data.data)) {
        for (const n of data.data) {
          collectedNumbers.push({
            id: n.id,
            displayPhoneNumber: n.display_phone_number || '',
            verifiedName: n.verified_name || '',
            qualityRating: n.quality_rating || '',
            verificationStatus: n.code_verification_status || '',
            wabaId: discoveredWabaId,
          });
        }
      }
    } catch (_) {}
  }

  // 4. If still no numbers, try businesses owned WABA accounts
  if (collectedNumbers.length === 0) {
    try {
      const { data } = await axios.get(
        `https://graph.facebook.com/${version}/me/businesses`,
        {
          headers,
          params: {
            fields: 'id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}',
          },
          timeout: 10000,
        }
      );
      if (data?.data && Array.isArray(data.data)) {
        for (const biz of data.data) {
          const wabas = biz.owned_whatsapp_business_accounts?.data || [];
          for (const w of wabas) {
            if (!discoveredWabaId) discoveredWabaId = w.id;
            const nums = w.phone_numbers?.data || [];
            for (const n of nums) {
              collectedNumbers.push({
                id: n.id,
                displayPhoneNumber: n.display_phone_number || '',
                verifiedName: n.verified_name || w.name || biz.name || '',
                wabaId: w.id,
              });
            }
          }
        }
      }
    } catch (_) {}
  }

  if (collectedNumbers.length > 0) {
    const primary = collectedNumbers[0];
    return {
      success: true,
      phoneNumberId: primary.id,
      displayPhoneNumber: primary.displayPhoneNumber,
      verifiedName: primary.verifiedName,
      qualityRating: primary.qualityRating,
      verificationStatus: primary.verificationStatus,
      wabaId: primary.wabaId || discoveredWabaId,
      allNumbers: collectedNumbers,
    };
  }

  return {
    success: false,
    error: 'No WhatsApp Business phone numbers found associated with this token. Please ensure the token has whatsapp_business_messaging permissions in Meta Business Manager.',
    wabaId: discoveredWabaId || undefined,
  };
};

const loadDbConfig = async () => {
  const envToken = getEnvToken();
  const envPhoneId = getEnvPhoneId();
  const envWabaId = getEnvWabaId();

  if (cachedDbConfig !== null) {
    // Check if process.env.WHATSAPP_ACCESS_TOKEN was changed externally
    if (envToken && cachedDbConfig.envTokenTracked && cachedDbConfig.envTokenTracked !== envToken) {
      cachedDbConfig = null; // force reload and sync
    } else {
      return cachedDbConfig;
    }
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      cachedDbConfig = {
        accessToken: envToken,
        phoneNumberId: envPhoneId,
        wabaId: envWabaId,
        envTokenTracked: envToken,
      };
      return cachedDbConfig;
    }
    const SystemConfig = require('../models/SystemConfig');
    const doc = await SystemConfig.findOne({ key: 'whatsapp_config' }).maxTimeMS(2000);
    if (doc?.value) {
      cachedDbConfig = { ...doc.value };

      // If envToken is set and differs from what was previously synced from env, adopt env token
      if (envToken && cachedDbConfig.envTokenTracked !== envToken) {
        cachedDbConfig.accessToken = envToken;
        cachedDbConfig.envTokenTracked = envToken;
        if (envPhoneId) {
          cachedDbConfig.phoneNumberId = envPhoneId;
        } else {
          // Invalidate stale phone ID belonging to old token so it auto-discovers
          delete cachedDbConfig.phoneNumberId;
          delete cachedDbConfig.displayPhoneNumber;
          delete cachedDbConfig.verifiedName;
        }
        if (envWabaId) cachedDbConfig.wabaId = envWabaId;

        // Asynchronously update in background
        SystemConfig.updateOne({ key: 'whatsapp_config' }, { value: cachedDbConfig }, { upsert: true }).catch(() => {});
      }
    } else {
      cachedDbConfig = {
        accessToken: envToken,
        phoneNumberId: envPhoneId,
        wabaId: envWabaId,
        envTokenTracked: envToken,
      };
    }
  } catch (_) {
    cachedDbConfig = {
      accessToken: envToken,
      phoneNumberId: envPhoneId,
      wabaId: envWabaId,
      envTokenTracked: envToken,
    };
  }
  return cachedDbConfig;
};

const setRuntimeWhatsAppConfig = (cfg) => {
  cachedDbConfig = { ...(cachedDbConfig || {}), ...cfg };
  if (cfg.accessToken) process.env.WHATSAPP_ACCESS_TOKEN = cfg.accessToken;
  if (cfg.phoneNumberId) process.env.WHATSAPP_PHONE_NUMBER_ID = cfg.phoneNumberId;
  if (cfg.wabaId) process.env.WHATSAPP_WABA_ID = cfg.wabaId;
};

const getToken = () => (cachedDbConfig?.accessToken || getEnvToken() || '').trim();
const getPhoneId = () => (cachedDbConfig?.phoneNumberId || getEnvPhoneId() || '').trim();

/**
 * Verify Meta Cloud API connection directly with Graph API.
 * If phoneId is omitted, automatically discovers it from the token.
 */
const verifyMetaConnection = async (tokenOverride, phoneIdOverride) => {
  await loadDbConfig();
  const token = (tokenOverride || getToken() || '').trim();
  let phoneId = (phoneIdOverride || getPhoneId() || '').trim();

  if (!token) {
    return {
      connected: false,
      error: 'WhatsApp Access Token is missing',
    };
  }

  // If phoneId is missing, attempt auto-discovery from token
  if (!phoneId) {
    const disc = await autoDiscoverMetaContact(token);
    if (!disc.success || !disc.phoneNumberId) {
      return {
        connected: false,
        error: disc.error || 'Could not find a WhatsApp Phone Number ID linked to this token',
      };
    }
    phoneId = disc.phoneNumberId;
    setRuntimeWhatsAppConfig({
      phoneNumberId: disc.phoneNumberId,
      displayPhoneNumber: disc.displayPhoneNumber,
      verifiedName: disc.verifiedName,
      wabaId: disc.wabaId,
    });
  }

  try {
    const version = process.env.WHATSAPP_API_VERSION || 'v23.0';
    const { data } = await axios.get(`https://graph.facebook.com/${version}/${phoneId}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: 'verified_name,display_phone_number,quality_rating,code_verification_status' },
      timeout: 10000,
    });
    return {
      connected: true,
      verifiedName: data.verified_name,
      displayPhoneNumber: data.display_phone_number,
      qualityRating: data.quality_rating,
      verificationStatus: data.code_verification_status,
      phoneId,
    };
  } catch (err) {
    return {
      connected: false,
      error: err.response?.data?.error?.message || err.message,
    };
  }
};

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

// Known text-only templates on PeYug WABA (do not expect a header image)
const TEXT_ONLY_TEMPLATES = new Set([
  'peyug_about',
  'peyug_anouncement_upi_',
  'hello_world',
]);

const DEFAULT_BANNER_IMAGE = 'https://peyug.in/assets/images/banner/PeYug.png';

const PEYUG_OFFICIAL_TEMPLATES = [
  {
    name: 'welcome_to_peyug',
    label: 'Welcome to PeYug (Official)',
    category: 'MARKETING',
    hasImage: true,
    description: 'Official welcome message with Android/iOS app links',
    bodyText: `Welcome to PeYug – The New Era of Payment!

हमारी Sales Team से जुड़ने के लिए धन्यवाद।
अब आप Peyug के साथ सुरक्षित और आसान डिजिटल पेमेंट का अनुभव ले सकते हैं।

📲 Peyug App डाउनलोड करें:
Android 👉 https://play.google.com/store/apps/details?id=com.safesoftware.passbook.jinl 
iOS 👉 https://apps.apple.com/in/app/peyug/id6753785405 

लिखे ; https://peyug.in/contact 
E-mail: contact@peyug.in 

किसी भी सहायता के लिए हम हमेशा आपके साथ हैं।
— Team PeYug`,
    buttons: [{ type: 'URL', text: 'https://www.peyug.in', url: 'https://www.peyug.in/' }],
  },
  {
    name: 'peyug_missed_call_h_v1',
    label: 'मिस्ड कॉल / फॉलो-अप (Hindi)',
    category: 'MARKETING',
    hasImage: true,
    description: 'Auto follow-up acknowledging call and sharing top services',
    bodyText: `नमस्ते 🙏
आपका कॉल प्राप्त हुआ।
PeYug से जुड़ने के लिए धन्यवाद।
हमारी टीम जल्द ही आपसे संपर्क करेगी।

📌 हमारी सेवाएं:
✔ डेली डिपॉज़िट
✔ इमरजेंसी लोन, डिपॉज़िट लोन
✔ सुरक्षित डिजिटल भुगतान

अधिक जानकारी के लिए WhatsApp पर "Hi" लिखें।

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_family_welcome_h_v1',
    label: 'PeYug परिवार Welcome',
    category: 'MARKETING',
    hasImage: true,
    description: 'Welcome to PeYug family highlighting financial empowerment',
    bodyText: `🎉 PeYug परिवार में आपका स्वागत है।

अब आप:
✅ डेली बचत कर सकते हैं
✅ इमरजेंसी लोन सहायता पा सकते हैं
✅ घर बैठे डिजिटल कलेक्शन कर सकते हैं

हमारा लक्ष्य: “हर व्यक्ति को आर्थिक रूप से मज़बूत बनाना।” 💙

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_daily_deposit_h_v1',
    label: 'डेली डिपॉज़िट सेवा',
    category: 'MARKETING',
    hasImage: true,
    description: 'Daily savings and deposit options (₹100, ₹200, ₹500)',
    bodyText: `💰 डेली डिपॉज़िट सेवा

आप कितना डिपॉज़िट शुरू करना चाहते हैं?

🔘 ₹100 प्रतिदिन
🔘 ₹200 प्रतिदिन
🔘 ₹500 प्रतिदिन
🔘 अपनी मर्ज़ी की राशि

आज ही अपनी बचत शुरू करें और अपने सपनों को पूरा करें। 🙏

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_emergency_loan_h_v1',
    label: 'इमरजेंसी लोन सहायता',
    category: 'MARKETING',
    hasImage: true,
    description: 'Personal, business, medical and emergency loan support',
    bodyText: `⚡ इमरजेंसी लोन सहायता

कृपया अपनी आवश्यकता चुनें:

🔘 पर्सनल लोन
🔘 बिजनेस लोन
🔘 मेडिकल इमरजेंसी
🔘 शिक्षा की जरूरत

हमारी टीम आपको जल्द से जल्द सहायता प्रदान करेगी। 💙

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_emi_reminder_h_v1',
    label: 'EMI / भुगतान रिमाइंडर',
    category: 'MARKETING',
    hasImage: true,
    description: 'Polite reminder that payment / EMI due date is near',
    bodyText: `🙏 नमस्ते,
आपकी ईएमआई / भुगतान की डीउ डेट पास है।

कृपया समय पर भुगतान करके अपना रिकॉर्ड अच्छा बनाए रखें।

किसी सहायता के लिए Reply करें।

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_account_activate_h_v1',
    label: 'Account Activate (START)',
    category: 'MARKETING',
    hasImage: true,
    description: 'Prompts customer to activate account with "START"',
    bodyText: `🚀 आपका अकाउंट अभी तक सक्रिय नहीं हुआ है।

आज ही शुरुआत करें और पाएं:
✅ आसान जमा सुविधा
✅ इमरजेंसी सहायता
✅ डिजिटल भुगतान सुविधा

Reply करें: "START"

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_security_trust_h_v1',
    label: 'सुरक्षा & विश्वास',
    category: 'MARKETING',
    hasImage: true,
    description: 'Trust message highlighting fund security and digital records',
    bodyText: `🔐 आपका पैसा, आपकी सुरक्षा।

PeYug में:
✔ सुरक्षित ट्रांजेक्शन
✔ डिजिटल रिकॉर्ड
✔ आसान भुगतान
✔ तेज़ सपोर्ट

विश्वास ही हमारी सबसे बड़ी ताकत है। 🙏

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_about',
    label: 'PeYug Refer & Earn (Cashback)',
    category: 'MARKETING',
    hasImage: false,
    description: 'Refer & Earn ₹100 Cashback + 1% monthly commission',
    bodyText: `⭐ REFER करें • EARN करें
PeYug - The New Era of Payment  ( UPI app )के साथ Extra Income कमाएँ!
⿡ हर रेफ़रल पर ₹100 Cashback

बस PeYug अकाउंट बनाएँ → लिंक शेयर करें →
हर सफल रेफ़रल पर तुरंत ₹100 कमाएँ!

⿢ 1% Monthly Cashback (Average Balance)

जिस यूज़र को आप refer करें,
वह जितना Average Balance रखेगा,
उसका 1% हर महीने आपको Cashback मिलेगा!

⿣ FD / RD / Daily Deposit पर 2% तक Cashback
Referred user जितना deposit करेगा,
आपको 2% तक  cashback !  

"आज ही डाउनलोड करें"  
Android  : https://play.google.com/store/apps/detailsid=com.safesoftware.passbook.jinl&hl=en_IN 
IOS ; https://apps.apple.com/in/app/peyug/id6753785405`,
    buttons: [],
  },
  {
    name: 'peyug_anouncement_upi_',
    label: 'PeYug UPI Launch',
    category: 'MARKETING',
    hasImage: false,
    description: 'Announcement about PeYug UPI payment ecosystem',
    bodyText: `We are proud to introduce

PeYug The New Era of Payment

Built with innovation, trust and technology, PeYug is designed to deliver a secure, seamless and smarter digital payment experience for everyone.

From instant UPI transactions to advanced security layers, PeYug represents our commitment to empowering India's digital future. A step forward in convenience. A leap forward in financial technology.

Our vision is simple: To make digital payments more accessible, more rellable, and more powerful.

Join us as we begin this exciting journey.

PeYug - The New Era of Payment

Download : PeYug ( UPI App)  
IOS: https://apps.apple.com/in/app/peyug/id6753785405  ,
Android : https://play.google.com/store/apps/details?id=com.safesoftware.passbook.jinl&hl=en_IN`,
    buttons: [],
  },
  {
    name: 'peyug_saving_h_v1',
    label: 'बचत करना हुआ आसान',
    category: 'MARKETING',
    hasImage: true,
    description: 'Encourage daily savings and deposits',
    bodyText: `💰 अब पैसे बचत करना हुआ और आसान!
PeYug App के साथ पाएँ:

✅ डेली डिपॉज़िट सुविधा
✅ इमरजेंसी लोन सहायता
✅ सुरक्षित डिजिटल ट्रांजेक्शन
✅ आसान और भरोसेमंद सेवा

आज ही जुड़ें और अपने भविष्य को सुरक्षित बनाएं। 🚀

📲 अधिक जानकारी के लिए अभी Reply करें — "START"

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_lead_capture_h_v1',
    label: 'Lead Capture (Hindi)',
    category: 'MARKETING',
    hasImage: true,
    description: 'Collect customer name, city, and business need',
    bodyText: `नमस्ते 🙏
PeYug में आपका स्वागत है।
कृपया नीचे दी गई जानकारी भेजें:

1️⃣ आपका नाम
2️⃣ शहर का नाम
3️⃣ आपका व्यवसाय / काम
4️⃣ आपको किस सेवा की आवश्यकता है?

✔ डेली डिपॉज़िट ✔ लोन ✔ QR पेमेंट ✔ बिजनेस कलेक्शन

हमारी टीम तुरंत आपकी सहायता करेगी।

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_flow_welcome_h_v1',
    label: 'PeYug Menu Flow',
    category: 'MARKETING',
    hasImage: true,
    description: 'Welcome menu with 1-5 service options',
    bodyText: `🙏 नमस्ते, PeYug में आपका स्वागत है।
हम आपके पैसों को सुरक्षित और आसान तरीके से मैनेज करने में मदद करते हैं।

कृपया नीचे एक विकल्प चुनें 👇

1️⃣ डेली डिपॉज़िट
2️⃣ इमरजेंसी लोन
3️⃣ QR पेमेंट सेवा
4️⃣ रेफरल
5️⃣ ग्राहक सहायता

🎥 PeYug वीडियो: https://www.youtube.com/shorts/SyFXZpIh6jY
🌐 वेबसाइट: https://peyug.in/`,
    buttons: [],
  },
  {
    name: 'peyug_missed_call_v2',
    label: 'Missed Call Follow-up (English/Hindi)',
    category: 'MARKETING',
    hasImage: true,
    description: 'English/Hindi missed call response',
    bodyText: `नमस्ते 🙏
आपका कॉल प्राप्त हुआ।

PeYug से जुड़ने के लिए धन्यवाद।
हमारी टीम जल्द ही आपसे संपर्क करेगी।

📌 सेवाएं:
✔ Daily Deposit
✔ Emergency Loan, Deposit Loan
✔ सुरक्षित डिजिटल भुगतान

अधिक जानकारी के लिए WhatsApp पर "Hi" लिखें।

🎥 PeYug Video: https://youtu.be/peyug_intro`,
    buttons: [],
  },
];

const getTemplateDetails = (templateName) => {
  if (!templateName) return null;
  return PEYUG_OFFICIAL_TEMPLATES.find((t) => t.name === templateName) || null;
};

// Sends a free-form text message. Only works within Meta's 24-hour customer
// service window (i.e. after the customer has messaged you recently).
// For the first outbound message to a customer, use sendWhatsAppTemplate instead.
const sendWhatsAppText = async ({ to, message, text }) => {
  await loadDbConfig();
  const token = getToken();
  let phoneId = getPhoneId();
  const cleanTo = cleanPhoneNumber(to);
  const messageBody = (message || text || '').trim();

  if (!cleanTo) {
    return { success: false, error: 'Recipient phone number is invalid' };
  }

  if (!messageBody) {
    return { success: false, error: 'Message body cannot be empty' };
  }

  // If token is configured but phoneId not yet resolved, attempt dynamic auto-discovery
  if (token && !phoneId) {
    try {
      const disc = await autoDiscoverMetaContact(token);
      if (disc.success && disc.phoneNumberId) {
        phoneId = disc.phoneNumberId;
        setRuntimeWhatsAppConfig({
          phoneNumberId: disc.phoneNumberId,
          displayPhoneNumber: disc.displayPhoneNumber,
          verifiedName: disc.verifiedName,
          wabaId: disc.wabaId,
        });
      }
    } catch (_) {}
  }

  if (!token || !phoneId) {
    return {
      success: false,
      isConfigured: false,
      error: 'WhatsApp credentials (WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID) are not configured or contact could not be resolved',
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
    const errorMsg = error.response?.data?.error?.message || error.message;
    const is24hWindowClosed = Boolean(
      String(errorMsg).includes('131047') || error.response?.data?.error?.code === 131047
    );
    return {
      success: false,
      is24hWindowClosed,
      error: errorMsg,
      cleanTo,
      waLink: getWhatsAppWebLink(cleanTo, messageBody),
      waMeLink: getWaMeLink(cleanTo, messageBody),
    };
  }
};

// Sends a pre-approved template message (required for the first message to a
// customer, or after the 24-hour session window has closed).
// Automatically attaches approved header images when required by the template.
const sendWhatsAppTemplate = async ({
  to,
  templateName = 'peyug_about',
  languageCode = 'en_US',
  params = [],
  headerImageUrl = null,
}) => {
  await loadDbConfig();
  const token = getToken();
  let phoneId = getPhoneId();
  const cleanTo = cleanPhoneNumber(to);

  if (!cleanTo) {
    return { success: false, error: 'Recipient phone number is invalid' };
  }

  // If token is configured but phoneId not yet resolved, attempt dynamic auto-discovery
  if (token && !phoneId) {
    try {
      const disc = await autoDiscoverMetaContact(token);
      if (disc.success && disc.phoneNumberId) {
        phoneId = disc.phoneNumberId;
        setRuntimeWhatsAppConfig({
          phoneNumberId: disc.phoneNumberId,
          displayPhoneNumber: disc.displayPhoneNumber,
          verifiedName: disc.verifiedName,
          wabaId: disc.wabaId,
        });
      }
    } catch (_) {}
  }

  if (!token || !phoneId) {
    return {
      success: false,
      isConfigured: false,
      error: 'WhatsApp credentials are not configured or contact could not be resolved',
      waLink: getWhatsAppWebLink(cleanTo),
      waMeLink: getWaMeLink(cleanTo),
    };
  }

  try {
    const isTextOnly = TEXT_ONLY_TEMPLATES.has(templateName);
    const components = [];

    // Most PeYug approved templates have an IMAGE header
    if (!isTextOnly) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: { link: headerImageUrl || DEFAULT_BANNER_IMAGE },
          },
        ],
      });
    }

    if (params && params.length > 0) {
      components.push({
        type: 'body',
        parameters: params.map((text) => ({ type: 'text', text: String(text) })),
      });
    }

    const { data } = await axios.post(
      BASE_URL(),
      {
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components.length > 0 ? { components } : {}),
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const templateDetails = getTemplateDetails(templateName);
    const resolvedBody = templateDetails?.bodyText || '';

    return {
      success: true,
      providerMessageId: data.messages?.[0]?.id,
      cleanTo,
      templateName,
      bodyText: resolvedBody,
      waLink: getWhatsAppWebLink(cleanTo, resolvedBody),
      waMeLink: getWaMeLink(cleanTo, resolvedBody),
    };
  } catch (error) {
    const templateDetails = getTemplateDetails(templateName);
    const resolvedBody = templateDetails?.bodyText || '';
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      cleanTo,
      templateName,
      bodyText: resolvedBody,
      waLink: getWhatsAppWebLink(cleanTo, resolvedBody),
      waMeLink: getWaMeLink(cleanTo, resolvedBody),
    };
  }
};

module.exports = {
  cleanPhoneNumber,
  getWhatsAppWebLink,
  getWaMeLink,
  sendWhatsAppText,
  sendWhatsAppTemplate,
  loadDbConfig,
  setRuntimeWhatsAppConfig,
  verifyMetaConnection,
  autoDiscoverMetaContact,
  getToken,
  getPhoneId,
  PEYUG_OFFICIAL_TEMPLATES,
  getTemplateDetails,
  DEFAULT_BANNER_IMAGE,
};

