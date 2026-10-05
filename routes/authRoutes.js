const express = require('express');
const router = express.Router();
const {
  login,
  getMe,
  updateMe,
  getSessions,
  revokeSession,
  changePassword,
  logout,
  registerSendOtp,
  registerVerifyOtp,
  forgotPasswordSendOtp,
  forgotPasswordVerifyReset,
  changePasswordSendOtp,
  changePasswordWithOtp,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public Authentication
router.post('/login', login);
router.post('/register/send-otp', registerSendOtp);
router.post('/register/verify-otp', registerVerifyOtp);
router.post('/forgot-password/send-otp', forgotPasswordSendOtp);
router.post('/forgot-password/verify-reset', forgotPasswordVerifyReset);

// Private User Account & Session Management
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);
router.get('/sessions', protect, getSessions);
router.delete('/sessions/:id', protect, revokeSession);
router.put('/change-password', protect, changePassword);
router.post('/profile/send-otp', protect, changePasswordSendOtp);
router.put('/profile/change-password-otp', protect, changePasswordWithOtp);
router.post('/logout', protect, logout);

module.exports = router;

