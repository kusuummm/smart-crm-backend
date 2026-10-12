const express = require('express');
const router = express.Router();
const {
  getTelephonyConfig,
  initiateCall,
  handleCallWebhook,
} = require('../controllers/telephonyController');
const { protect } = require('../middleware/auth');

// Public webhooks for telephony carriers (Twilio / Exotel)
router.post('/webhook/call', handleCallWebhook);
router.post('/webhook/recording', handleCallWebhook);

// Protected CRM routes
router.use(protect);
router.get('/config', getTelephonyConfig);
router.post('/call', initiateCall);

module.exports = router;
