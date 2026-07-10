const express = require('express');
const router = express.Router();
const { sendCustomerEmail, getEmailLogs } = require('../controllers/emailController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/send', sendCustomerEmail);
router.get('/', getEmailLogs);

module.exports = router;
