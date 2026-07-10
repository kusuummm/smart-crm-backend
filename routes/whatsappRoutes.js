const express = require('express');
const router = express.Router();
const {
  sendMessage,
  sendTemplate,
  sendFollowUpReminder,
  getLogs,
  verifyWebhook,
  receiveWebhook,
} = require('../controllers/whatsappController');
const { protect } = require('../middleware/auth');

// Public webhook endpoints - Meta calls these directly, no user JWT available.
// Verified instead via the shared WHATSAPP_WEBHOOK_VERIFY_TOKEN (GET) and, in
// production, Meta's X-Hub-Signature-256 header should also be checked (POST).
router.get('/webhook', verifyWebhook);
router.post('/webhook', receiveWebhook);

router.use(protect);
router.post('/send', sendMessage);
router.post('/send-template', sendTemplate);
router.post('/send-followup-reminder', sendFollowUpReminder);
router.get('/', getLogs);

module.exports = router;
