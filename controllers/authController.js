const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Session = require('../models/Session');
const generateToken = require('../utils/generateToken');
const parseUserAgent = require('../utils/parseUserAgent');

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
    res.status(401);
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

module.exports = { login, getMe, updateMe, getSessions, revokeSession, changePassword, logout };
