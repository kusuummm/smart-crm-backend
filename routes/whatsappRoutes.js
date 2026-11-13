const express = require('express');
const router = express.Router();
const {
  sendMessage,
  sendTemplate,
  sendFollowUpReminder,
  getLogs,
  verifyWebhook,
  receiveWebhook,
  getConfig,
  updateConfig,
  testConnection,
} = require('../controllers/whatsappController');
const { protect, authorize } = require('../middleware/auth');

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

// WhatsApp Configuration & Diagnostics
router.get('/config', authorize('manager'), getConfig);
router.put('/config', authorize('admin'), updateConfig);
router.post('/test-connection', authorize('admin'), testConnection);

module.exports = router;
