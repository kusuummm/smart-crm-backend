const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Session = require('../models/Session');
const Otp = require('../models/Otp');
const generateToken = require('../utils/generateToken');
const parseUserAgent = require('../utils/parseUserAgent');
const sendOtpEmail = require('../utils/sendOtpEmail');

// @desc    Login user (admin or telecaller)
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid credentials');
  }

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Invalid credentials or inactive account');
  }

  const { token, sid } = generateToken(user._id, user.role);

  // Record this login as its own session/device, so the user can see and
  // manage "where they're logged in" later (see getSessions/revokeSession).
  await Session.create({
    user: user._id,
    tokenId: sid,
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
  });

  res.json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
    },
  });
});

// @desc    Get currently logged-in user
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user });
});

// @desc    Update own profile (name, phone). Email/role are intentionally
//          not editable here - email is the login identifier and role
//          changes are an admin-only action via /api/users/:id.
// @route   PUT /api/auth/me
// @access  Private
const updateMe = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;

  if (!name || !name.trim()) {
    res.status(400);
    throw new Error('Name is required');
  }

  const user = await User.findById(req.user._id);
  user.name = name.trim();
  if (phone !== undefined) user.phone = phone;
  // Refresh the initials-based avatar to match the new name.
  user.avatar = user.name.split(' ').map((w) => w[0]).join('').substring(0, 2).toUpperCase();
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

// @desc    Revoke (sign out) a specific session - e.g. a lost device
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

// @desc    Logout - deletes this device's session record so the token
//          can no longer be used (see protect() in middleware/auth.js).
// @route   POST /api/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res) => {
  if (req.sessionId) {
    await Session.deleteOne({ tokenId: req.sessionId });
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// @desc    Step 1: Request 6-digit OTP for new user registration
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

  if (normalizedEmail.endsWith('@crm.com') || normalizedEmail.endsWith('@example.com')) {
    res.status(400);
    throw new Error('Please register with your real email address (not a placeholder domain)');
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    res.status(400);
    throw new Error('An account with this email address already exists. Please log in.');
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  await Otp.deleteMany({ email: normalizedEmail, purpose: 'register' });
  await Otp.create({
    email: normalizedEmail,
    otp,
    purpose: 'register',
    metadata: {
      name: name.trim(),
      password,
      phone: phone?.trim() || '',
      role: 'telecaller',
    },
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const mailResult = await sendOtpEmail({
    to: normalizedEmail,
    otp,
    purpose: 'register',
  });

  if (!mailResult.success) {
    res.status(502);
    throw new Error(`Failed to dispatch verification email: ${mailResult.error}`);
  }

  res.json({
    success: true,
    message: `6-digit verification code sent to ${normalizedEmail}. Please check your Inbox and Spam folder.`,
  });
});

// @desc    Step 2: Verify OTP, create account and log in automatically
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

  const otpDoc = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'register',
    otp: cleanOtp,
  });

  if (!otpDoc || otpDoc.expiresAt < new Date()) {
    res.status(400);
    throw new Error('Invalid or expired verification code. Please request a new code.');
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    await Otp.deleteOne({ _id: otpDoc._id });
    res.status(400);
    throw new Error('An account with this email already exists. Please sign in.');
  }

  const user = await User.create({
    name: otpDoc.metadata.name,
    email: normalizedEmail,
    password: otpDoc.metadata.password,
    phone: otpDoc.metadata.phone || '',
    role: otpDoc.metadata.role || 'telecaller',
    status: 'active',
  });

  await Otp.deleteOne({ _id: otpDoc._id });

  const { token, sid } = generateToken(user._id, user.role);

  await Session.create({
    user: user._id,
    tokenId: sid,
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: 'Account registered and verified successfully!',
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

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Account is deactivated. Please contact an administrator.');
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  await Otp.deleteMany({ email: normalizedEmail, purpose: 'forgot_password' });
  await Otp.create({
    email: normalizedEmail,
    otp,
    purpose: 'forgot_password',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const mailResult = await sendOtpEmail({
    to: normalizedEmail,
    otp,
    purpose: 'forgot_password',
  });

  if (!mailResult.success) {
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

  const otpDoc = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'forgot_password',
    otp: cleanOtp,
  });

  if (!otpDoc || otpDoc.expiresAt < new Date()) {
    res.status(400);
    throw new Error('Invalid or expired verification code');
  }

  const user = await User.findOne({ email: normalizedEmail }).select('+password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.password = newPassword;
  await user.save();

  await Otp.deleteOne({ _id: otpDoc._id });

  // Issue new session and log in user directly with their new password
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

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

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

  const otpDoc = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'change_password',
    otp: cleanOtp,
  });

  if (!otpDoc || otpDoc.expiresAt < new Date()) {
    res.status(400);
    throw new Error('Invalid or expired verification code');
  }

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
  forgotPasswordSendOtp,
  forgotPasswordVerifyReset,
  changePasswordSendOtp,
  changePasswordWithOtp,
};
