const express = require('express');
const router = express.Router();
const { login, getMe, updateMe, getSessions, revokeSession, changePassword, logout } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);
router.get('/sessions', protect, getSessions);
router.delete('/sessions/:id', protect, revokeSession);
router.put('/change-password', protect, changePassword);
router.post('/logout', protect, logout);

module.exports = router;
