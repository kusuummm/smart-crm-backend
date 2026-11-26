const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const emailNotificationService = require('../services/emailNotificationService');
const whatsAppNotificationService = require('../services/whatsAppNotificationService');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Session = require('../models/Session');
const Otp = require('../models/Otp');
const generateToken = require('../utils/generateToken');
const parseUserAgent = require('../utils/parseUserAgent');
const sendOtpEmail = require('../utils/sendOtpEmail');

// @desc    Login user (admin or member)
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  const normalizedEmail = email.toString().trim().toLowerCase();

  // If browser autofilled OTP code instead of email
  if (/^\d{4,8}$/.test(normalizedEmail)) {
    res.status(400);
    throw new Error('Please enter your registered email address and password to log in (not the OTP code).');
  }

  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid credentials');
  }

  // Strict CRM Access Control: Only admin and member accounts can access the CRM
  let normalizedRole = (user.role || '').toLowerCase().trim();
  if (normalizedRole === 'telecaller') normalizedRole = 'member';
  const isAllowedRole = ['admin', 'owner', 'member'].includes(normalizedRole);

  if (!isAllowedRole) {
    res.status(403);
    throw new Error('Access denied. Only admin and member accounts are authorized to access the CRM.');
  }

  const isAdminRole = ['admin', 'owner'].includes(normalizedRole);
  if (!isAdminRole && (user.status === 'pending' || user.isApproved === false)) {
    res.status(403);
    throw new Error('Your account is pending administrator approval. Please wait until an admin approves your account.');
  }

  if (user.status === 'rejected') {
    res.status(403);
    throw new Error('Your account registration was rejected by the administrator.');
  }

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Your account is inactive. Please contact the administrator.');
  }

  // SINGLE DEVICE POLICY FOR ADMIN ACCOUNT:
  // An admin account can be logged into one device only.
  // Terminate any previous active sessions on other devices before registering the new device.
  let priorSessionsTerminated = 0;
  if (isAdminRole) {
    const delResult = await Session.deleteMany({ user: user._id });
    priorSessionsTerminated = delResult.deletedCount || 0;
    if (priorSessionsTerminated > 0) {
      console.log(`[Single Device Policy] Terminated ${priorSessionsTerminated} previous session(s) for admin: ${user.email}`);
    }
  }

  const { token, sid } = generateToken(user._id, user.role);

  // Record this login as its own session/device
  await Session.create({
    user: user._id,
    tokenId: sid,
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
  });

  // Update user online status
  user.isOnline = true;
  user.lastActive = new Date();
  await user.save();

  res.json({
    success: true,
    token,
    priorSessionsTerminated,
    singleDeviceEnforced: isAdminRole,
    message: isAdminRole && priorSessionsTerminated > 0
      ? 'Signed in successfully. Previous session on other device has been logged out (single active device policy).'
      : 'Signed in successfully.',
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
      phone: user.phone || '',
      balance: user.balance || '₹0.0',
    },
  });
});

// @desc    Get currently logged-in user
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  let userData = req.user;
  if (req.user && req.user.toObject) {
    userData = req.user.toObject();
  } else if (req.user) {
    userData = { ...req.user };
  }

  try {
    const Wallet = require('../models/Wallet');
    const wallet = await Wallet.findOne({ userId: req.user._id });
    if (wallet) {
      userData.balance = `₹${wallet.balance.toFixed(1)}`;
    }
  } catch {}

  res.json({ success: true, user: userData });
});

// @desc    Update own profile (name, phone)
// @route   PUT /api/auth/me
// @access  Private
const updateMe = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;

  if (!name || !name.trim()) {
    res.status(400);
    throw new Error('Name is required');
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // Security guard: Prevent unauthorized mass assignment / privilege escalation on privileged fields
  const PRIVILEGED_FIELDS = [
    'role',
    'status',
    'isApproved',
    'balance',
    'referralCode',
    'referredBy',
    'isOnline',
    'lastActive',
    'email',
    'password',
  ];

  const attemptedPrivilegedFields = PRIVILEGED_FIELDS.filter(
    (field) => req.body[field] !== undefined && String(req.body[field]) !== String(user[field])
  );

  if (attemptedPrivilegedFields.length > 0) {
    res.status(403);
    throw new Error(
      `Unauthorized modification of privileged field(s): ${attemptedPrivilegedFields.join(', ')}`
    );
  }

  user.name = name.trim();
  if (phone !== undefined) user.phone = phone;
  user.avatar = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
  await user.save();

  res.json({
    success: true,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
      phone: user.phone,
      balance: user.balance || '₹0.0',
    },
  });
});

// @desc    List all active sessions (devices) for the logged-in user
// @route   GET /api/auth/sessions
// @access  Private
const getSessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find({ user: req.user._id }).sort({ lastSeenAt: -1 });

  res.json({
    success: true,
    sessions: sessions.map((s) => ({
      id: s._id,
      device: parseUserAgent(s.userAgent),
      ip: s.ip,
      loginAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.tokenId === req.sessionId,
    })),
  });
});

// @desc    Revoke (sign out) a specific session
// @route   DELETE /api/auth/sessions/:id
// @access  Private
const revokeSession = asyncHandler(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.id, user: req.user._id });

  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }

  const wasCurrent = session.tokenId === req.sessionId;
  await session.deleteOne();

  res.json({ success: true, wasCurrent });
});

// @desc    Change own password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400);
    throw new Error('Current and new password are required');
  }
  if (newPassword.length < 4) {
    res.status(400);
    throw new Error('New password must be at least 4 characters');
  }

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.matchPassword(currentPassword);

  if (!isMatch) {
    res.status(400);
    throw new Error('Current password is incorrect');
  }

  user.password = newPassword;
  await user.save();

  res.json({ success: true, message: 'Password updated successfully' });
});

// @desc    Logout
// @route   POST /api/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res) => {
  if (req.sessionId) {
    await Session.deleteOne({ tokenId: req.sessionId });
  }
  if (req.user) {
    await User.updateOne({ _id: req.user._id }, { $set: { isOnline: false, lastActive: new Date() } });
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// @desc    Step 1: Request random 6-digit OTP for new member registration
// @route   POST /api/auth/register/send-otp
// @access  Public
const registerSendOtp = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !name.trim()) {
    res.status(400);
    throw new Error('Full Name is required');
  }
  if (!email || !email.trim() || !email.includes('@')) {
    res.status(400);
    throw new Error('A valid email address is required');
  }
  if (!password || password.length < 4) {
    res.status(400);
    throw new Error('Password must be at least 4 characters');
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    res.status(400);
    throw new Error('An account with this email address already exists. Please log in.');
  }

  // Generate random 6-digit OTP
  const otp = crypto.randomInt(100000, 1000000).toString();
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  await Otp.deleteMany({ email: normalizedEmail, purpose: 'register' });
  await Otp.create({
    email: normalizedEmail,
    otp,
    purpose: 'register',
    metadata: {
      name: name.trim(),
      password: hashedPassword,
      phone: phone?.trim() || '',
      role: 'member',
    },
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  console.log(`\n========================================\n[REGISTRATION OTP] OTP for ${normalizedEmail}: ${otp}\n========================================\n`);

  const mailResult = await emailNotificationService.sendVerificationEmail({
    recipientEmail: normalizedEmail,
    recipientName: name,
    otp,
  });

  if (phone && phone.trim()) {
    whatsAppNotificationService.sendVerificationWhatsApp({
      recipientPhone: phone.trim(),
      recipientName: name,
      otp,
    }).catch((waErr) => console.warn('[Auth Register WhatsApp OTP Notice]:', waErr.message));
  }

  if (!mailResult.success) {
    if (!process.env.EMAIL_USER) {
      console.warn(`[OTP Warning] EMAIL_USER is not configured. Registration OTP for ${normalizedEmail} is ${otp}`);
      return res.json({
        success: true,
        message: `Verification code generated: ${otp} (SMTP unconfigured; please configure EMAIL_USER & EMAIL_PASS in Render environment).`,
      });
    }
    res.status(502);
    throw new Error(`Failed to dispatch verification email: ${mailResult.error}`);
  }

  res.json({
    success: true,
    message: `6-digit verification code sent to ${normalizedEmail}. Please check your inbox and enter the OTP to complete registration.`,
  });
});

// @desc    Step 2: Verify OTP, and ONLY if OTP matches, register as member
// @route   POST /api/auth/register/verify-otp
// @access  Public
const registerVerifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    res.status(400);
    throw new Error('Email and verification code are required');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const cleanOtp = otp.toString().trim();

  const pendingOtp = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'register',
  });

  if (!pendingOtp || pendingOtp.expiresAt < new Date()) {
    res.status(400);
    throw new Error('No active verification code found or code expired. Please request a new verification code.');
  }

  if (pendingOtp.otp !== cleanOtp) {
    pendingOtp.attempts = (pendingOtp.attempts || 0) + 1;
    if (pendingOtp.attempts >= 5) {
      await Otp.deleteOne({ _id: pendingOtp._id });
      res.status(400);
      throw new Error('Too many invalid attempts. For your security, this verification code has been invalidated. Please request a new code.');
    }
    await pendingOtp.save();
    res.status(400);
    throw new Error(`Invalid verification code. ${5 - pendingOtp.attempts} attempts remaining.`);
  }

  const otpDoc = pendingOtp;

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    await Otp.deleteOne({ _id: otpDoc._id });
    res.status(400);
    throw new Error('An account with this email already exists. Please sign in.');
  }

  // Register strictly as member upon successful OTP match
  const user = await User.create({
    name: otpDoc.metadata.name,
    email: normalizedEmail,
    password: otpDoc.metadata.password,
    phone: otpDoc.metadata.phone || '',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  await Otp.deleteOne({ _id: otpDoc._id });

  // Issue token and create session for seamless access
  const { token, sid } = generateToken(user._id, user.role);

  await Session.create({
    user: user._id,
    tokenId: sid,
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
  });

  user.isOnline = true;
  user.lastActive = new Date();
  await user.save();

  emailNotificationService.sendWelcomeEmail({
    recipientEmail: user.email,
    recipientName: user.name,
    userType: 'member',
  }).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Registration verified and completed successfully! Welcome to Smart CRM.',
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
      isApproved: user.isApproved,
      phone: user.phone || '',
      balance: user.balance || '₹0.0',
    },
  });
});

// @desc    Direct registration without OTP (Disabled - OTP is strictly required to register)
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  res.status(400);
  throw new Error('Direct registration is disabled. An OTP must be sent to your email and verified to register as a member.');
});

// @desc    Step 1: Request OTP for password reset (Forgot Password)
// @route   POST /api/auth/forgot-password/send-otp
// @access  Public
const forgotPasswordSendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || !email.trim()) {
    res.status(400);
    throw new Error('Email is required');
  }

  const normalizedEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    res.status(404);
    throw new Error('No account found with this email address');
  }

  // CRM Access check
  let normalizedRole = (user.role || '').toLowerCase().trim();
  if (normalizedRole === 'telecaller') normalizedRole = 'member';
  if (!['admin', 'owner', 'member'].includes(normalizedRole)) {
    res.status(403);
    throw new Error('Access denied. Only admin and member accounts are authorized to access the CRM.');
  }

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Account is deactivated. Please contact an administrator.');
  }

  const otp = crypto.randomInt(100000, 1000000).toString();

  await Otp.deleteMany({ email: normalizedEmail, purpose: 'forgot_password' });
  await Otp.create({
    email: normalizedEmail,
    otp,
    purpose: 'forgot_password',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  console.log(`\n========================================\n[FORGOT PASSWORD OTP] Code for ${normalizedEmail}: ${otp}\n========================================\n`);

  const mailResult = await emailNotificationService.sendPasswordResetEmail({
    recipientEmail: normalizedEmail,
    recipientName: user.name,
    otp,
  });

  if (user.phone && user.phone.trim()) {
    whatsAppNotificationService.sendPasswordResetWhatsApp({
      recipientPhone: user.phone.trim(),
      recipientName: user.name,
      otp,
    }).catch((waErr) => console.warn('[Auth Forgot Password WhatsApp OTP Notice]:', waErr.message));
  }

  if (!mailResult.success) {
    if (!process.env.EMAIL_USER) {
      console.warn(`[OTP Warning] EMAIL_USER is not configured. Reset code for ${normalizedEmail} is ${otp}`);
      return res.json({
        success: true,
        message: `Password reset code generated: ${otp} (SMTP unconfigured; please configure EMAIL_USER & EMAIL_PASS in Render environment).`,
      });
    }
    res.status(502);
    throw new Error(`Failed to dispatch reset code: ${mailResult.error}`);
  }

  res.json({
    success: true,
    message: `Password reset code sent to ${normalizedEmail}. Please check your Inbox and Spam folder.`,
  });
});

// @desc    Step 2: Verify OTP and reset password, then log user in directly
// @route   POST /api/auth/forgot-password/verify-reset
// @access  Public
const forgotPasswordVerifyReset = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    res.status(400);
    throw new Error('Email, OTP code, and new password are required');
  }

  if (newPassword.length < 4) {
    res.status(400);
    throw new Error('New password must be at least 4 characters');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const cleanOtp = otp.toString().trim();

  const pendingOtp = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'forgot_password',
  });

  if (!pendingOtp || pendingOtp.expiresAt < new Date()) {
    res.status(400);
    throw new Error('Reset code expired or not found. Please request a new one.');
  }

  if (pendingOtp.otp !== cleanOtp) {
    pendingOtp.attempts = (pendingOtp.attempts || 0) + 1;
    if (pendingOtp.attempts >= 5) {
      await Otp.deleteOne({ _id: pendingOtp._id });
      res.status(400);
      throw new Error('Too many failed attempts. This reset code has been invalidated for security. Please request a new one.');
    }
    await pendingOtp.save();
    res.status(400);
    throw new Error(`Invalid verification code. ${5 - pendingOtp.attempts} attempts remaining.`);
  }

  const otpDoc = pendingOtp;

  const user = await User.findOne({ email: normalizedEmail }).select('+password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // CRM Access check
  let normalizedRole = (user.role || '').toLowerCase().trim();
  if (normalizedRole === 'telecaller') normalizedRole = 'member';
  if (!['admin', 'owner', 'member'].includes(normalizedRole)) {
    res.status(403);
    throw new Error('Access denied. Only admin and member accounts are authorized to access the CRM.');
  }

  if (user.status === 'pending' || user.isApproved === false) {
    res.status(403);
    throw new Error('Your account is pending administrator approval. Please wait until an admin approves your account.');
  }

  if (user.status === 'rejected') {
    res.status(403);
    throw new Error('Your account registration was rejected by the administrator.');
  }

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Your account is inactive. Please contact the administrator.');
  }

  const isAdminRole = ['admin', 'owner'].includes(normalizedRole);
  // Single-device policy for admin account
  if (isAdminRole) {
    await Session.deleteMany({ user: user._id });
  }

  user.password = newPassword;
  await user.save();

  await Otp.deleteOne({ _id: otpDoc._id });

  // Issue new session and log in user directly
  const { token, sid } = generateToken(user._id, user.role);

  await Session.create({
    user: user._id,
    tokenId: sid,
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
  });

  res.json({
    success: true,
    message: 'Password reset successfully! Logging you in...',
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
      phone: user.phone,
    },
  });
});

// @desc    Request OTP to change password from user profile
// @route   POST /api/auth/profile/send-otp
// @access  Private
const changePasswordSendOtp = asyncHandler(async (req, res) => {
  const normalizedEmail = req.user.email.toLowerCase().trim();

  const otp = crypto.randomInt(100000, 1000000).toString();

  await Otp.deleteMany({ email: normalizedEmail, purpose: 'change_password' });
  await Otp.create({
    email: normalizedEmail,
    otp,
    purpose: 'change_password',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const mailResult = await sendOtpEmail({
    to: normalizedEmail,
    otp,
    purpose: 'change_password',
  });

  if (req.user.phone && req.user.phone.trim()) {
    whatsAppNotificationService.sendVerificationWhatsApp({
      recipientPhone: req.user.phone.trim(),
      recipientName: req.user.name,
      otp,
    }).catch((waErr) => console.warn('[Auth Change Password WhatsApp OTP Notice]:', waErr.message));
  }

  if (!mailResult.success) {
    res.status(502);
    throw new Error(`Failed to send verification code: ${mailResult.error}`);
  }

  res.json({
    success: true,
    message: `Verification code sent to ${normalizedEmail}. Please check your Inbox and Spam folder.`,
  });
});

// @desc    Verify OTP and change password from user profile
// @route   PUT /api/auth/profile/change-password-otp
// @access  Private
const changePasswordWithOtp = asyncHandler(async (req, res) => {
  const { otp, newPassword } = req.body;

  if (!otp || !newPassword) {
    res.status(400);
    throw new Error('Verification code and new password are required');
  }

  if (newPassword.length < 4) {
    res.status(400);
    throw new Error('New password must be at least 4 characters');
  }

  const normalizedEmail = req.user.email.toLowerCase().trim();
  const cleanOtp = otp.toString().trim();

  const pendingOtp = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'change_password',
  });

  if (!pendingOtp || pendingOtp.expiresAt < new Date()) {
    res.status(400);
    throw new Error('No active verification code found or code expired. Please request a new code.');
  }

  if (pendingOtp.otp !== cleanOtp) {
    pendingOtp.attempts = (pendingOtp.attempts || 0) + 1;
    if (pendingOtp.attempts >= 5) {
      await Otp.deleteOne({ _id: pendingOtp._id });
      res.status(400);
      throw new Error('Too many failed attempts. This code has been invalidated for security. Please request a new code.');
    }
    await pendingOtp.save();
    res.status(400);
    throw new Error(`Invalid verification code. ${5 - pendingOtp.attempts} attempts remaining.`);
  }

  const otpDoc = pendingOtp;

  const user = await User.findById(req.user._id).select('+password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.password = newPassword;
  await user.save();

  await Otp.deleteOne({ _id: otpDoc._id });

  res.json({
    success: true,
    message: 'Password updated successfully!',
  });
});

module.exports = {
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
};
