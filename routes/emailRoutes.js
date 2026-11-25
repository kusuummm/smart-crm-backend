const express = require('express');
const router = express.Router();
const {
  sendCustomerEmail,
  getEmailLogs,
  getLeadEmails,
  receiveInboundEmail,
  markEmailRead,
  testEmailDelivery,
} = require('../controllers/emailController');
const { protect, authorize } = require('../middleware/auth');

// Inbound email webhook (can receive from email relays/webhooks)
router.post('/inbound', receiveInboundEmail);

// Protected routes
router.use(protect);

router.post('/send', sendCustomerEmail);
router.post('/receive', receiveInboundEmail);
router.get('/lead/:leadId', getLeadEmails);
router.patch('/:id/read', markEmailRead);
router.post('/test', authorize('admin'), testEmailDelivery);
router.get('/', getEmailLogs);

module.exports = router;
