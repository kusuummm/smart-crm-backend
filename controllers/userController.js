const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Session = require('../models/Session');

// @desc    Create a new telecaller (or admin) account
// @route   POST /api/users
// @access  Private/Admin
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, phone } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email and password are required');
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password,
    role: role === 'admin' ? 'admin' : 'telecaller',
    phone,
  });

  res.status(201).json({ success: true, user });
});

// @desc    Get all users (optionally filter by role)
// @route   GET /api/users?role=telecaller
// @access  Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;

  const users = await User.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, count: users.length, users });
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private/Admin
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  res.json({ success: true, user });
});

// @desc    Update a user's profile (name, phone, role)
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { name, phone, role } = req.body;
  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (role) user.role = role;

  await user.save();
  res.json({ success: true, user });
});

// @desc    Reset a user's password (admin action)
// @route   PUT /api/users/:id/reset-password
// @access  Private/Admin
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    res.status(400);
    throw new Error('New password must be at least 4 characters');
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.password = newPassword;
  await user.save();

  // A reset password means old sessions should no longer be trusted.
  await Session.deleteMany({ user: user._id });

  res.json({ success: true, message: 'Password reset successfully' });
});

// @desc    Enable or disable a user account
// @route   PUT /api/users/:id/status
// @access  Private/Admin
const toggleUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.status = user.status === 'active' ? 'inactive' : 'active';
  await user.save();

  // If the account was just disabled, kick out any devices still logged in.
  if (user.status === 'inactive') {
    await Session.deleteMany({ user: user._id });
  }

  res.json({ success: true, user });
});

// @desc    Delete a user
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  await user.deleteOne();
  await Session.deleteMany({ user: user._id });
  res.json({ success: true, message: 'User deleted successfully' });
});

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  resetPassword,
  toggleUserStatus,
  deleteUser,
};
