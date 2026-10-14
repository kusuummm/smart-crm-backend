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
  register,
  forgotPasswordSendOtp,
  forgotPasswordVerifyReset,
  changePasswordSendOtp,
  changePasswordWithOtp,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Public Authentication (Rate limited to guard against brute-force attacks)
router.post('/login', authLimiter, login);
router.post('/register', authLimiter, register);
router.post('/register/send-otp', authLimiter, registerSendOtp);
router.post('/register/verify-otp', authLimiter, registerVerifyOtp);
router.post('/forgot-password/send-otp', authLimiter, forgotPasswordSendOtp);
router.post('/forgot-password/verify-reset', authLimiter, forgotPasswordVerifyReset);

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

