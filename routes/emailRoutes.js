const express = require('express');
const router = express.Router();
const { sendCustomerEmail, getEmailLogs, testEmailDelivery } = require('../controllers/emailController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.post('/send', sendCustomerEmail);
router.post('/test', authorize('admin'), testEmailDelivery);
router.get('/', getEmailLogs);

module.exports = router;
