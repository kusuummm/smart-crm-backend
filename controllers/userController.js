const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const CallHistory = require('../models/CallHistory');
const Event = require('../models/Event');
const WhatsAppLog = require('../models/WhatsAppLog');
const EmailLog = require('../models/EmailLog');

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

// @desc    Get all users (optionally filter by role), enriched with workload counts
// @route   GET /api/users?role=telecaller
// @access  Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;

  const users = await User.find(filter).sort({ createdAt: -1 });

  // Enrich each user with assigned customer and lead counts
  const enrichedUsers = await Promise.all(
    users.map(async (u) => {
      const uObj = u.toObject();
      if (u.role !== 'admin') {
        const [customerCount, leadCount] = await Promise.all([
          Customer.countDocuments({
            $or: [{ telecallerId: u._id }, { assignedTelecaller: u.name }],
          }),
          Lead.countDocuments({ telecallerId: u._id }),
        ]);
        uObj.assignedCustomers = customerCount;
        uObj.assignedLeads = leadCount;
      } else {
        uObj.assignedCustomers = 0;
        uObj.assignedLeads = 0;
      }
      return uObj;
    })
  );

  res.json({ success: true, count: enrichedUsers.length, users: enrichedUsers });
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
  const oldName = user.name;

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (role) user.role = role;

  await user.save();

  // If telecaller name changed, sync denormalized assignedTelecaller in Customer records
  if (name && name !== oldName) {
    await Customer.updateMany(
      { telecallerId: user._id },
      { $set: { assignedTelecaller: user.name } }
    );
  }

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

  // Safety: Admin cannot disable their own currently active account
  if (String(req.user._id) === String(user._id) && user.status === 'active') {
    res.status(400);
    throw new Error('You cannot disable your own admin account');
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

  // Safety: Admin cannot delete their own account
  if (String(req.user._id) === String(user._id)) {
    res.status(400);
    throw new Error('You cannot delete your own admin account');
  }

  // Unassign any customers and leads linked to this user so they don't orphan
  await Promise.all([
    Customer.updateMany(
      { $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }] },
      { $set: { telecallerId: null, assignedTelecaller: 'Unassigned' } }
    ),
    Lead.updateMany(
      { telecallerId: user._id },
      { $set: { telecallerId: null } }
    ),
  ]);

  await user.deleteOne();
  await Session.deleteMany({ user: user._id });

  res.json({
    success: true,
    message: 'User deleted successfully. Any assigned customers were moved to Unassigned.',
  });
});

// @desc    Reassign all customers and leads from one telecaller to another
// @route   POST /api/users/reassign-workload
// @access  Private/Admin
const reassignWorkload = asyncHandler(async (req, res) => {
  const { fromUserId, toUserId } = req.body;

  if (!fromUserId || !toUserId) {
    res.status(400);
    throw new Error('Both source and target telecaller IDs are required');
  }

  if (String(fromUserId) === String(toUserId)) {
    res.status(400);
    throw new Error('Source and target users must be different');
  }

  const [fromUser, toUser] = await Promise.all([
    User.findById(fromUserId),
    User.findById(toUserId),
  ]);

  if (!fromUser) {
    res.status(404);
    throw new Error('Source user not found');
  }

  if (!toUser) {
    res.status(404);
    throw new Error('Target user not found');
  }

  if (toUser.status !== 'active') {
    res.status(400);
    throw new Error('Cannot transfer workload to an inactive user account');
  }

  const [customerResult, leadResult] = await Promise.all([
    Customer.updateMany(
      { $or: [{ telecallerId: fromUser._id }, { assignedTelecaller: fromUser.name }] },
      { $set: { telecallerId: toUser._id, assignedTelecaller: toUser.name } }
    ),
    Lead.updateMany(
      { telecallerId: fromUser._id },
      { $set: { telecallerId: toUser._id } }
    ),
  ]);

  res.json({
    success: true,
    message: `Successfully transferred ${customerResult.modifiedCount} customer(s) and ${leadResult.modifiedCount} lead(s) from ${fromUser.name} to ${toUser.name}`,
    reassignedCustomers: customerResult.modifiedCount,
    reassignedLeads: leadResult.modifiedCount,
  });
});

// @desc    Get system diagnostic and CRM-wide overview
// @route   GET /api/users/system-overview
// @access  Private/Admin
const getSystemOverview = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalCustomers,
    totalLeads,
    totalFollowUps,
    totalCalls,
    totalEvents,
    totalWhatsApp,
    totalEmails,
  ] = await Promise.all([
    User.countDocuments(),
    Customer.countDocuments(),
    Lead.countDocuments(),
    FollowUp.countDocuments(),
    CallHistory.countDocuments(),
    Event.countDocuments(),
    WhatsAppLog.countDocuments(),
    EmailLog.countDocuments(),
  ]);

  const smtpUser = process.env.SMTP_USER || 'info@paymanent.com';
  const hasWhatsApp = Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  const dbConnected = mongoose.connection.readyState === 1;

  res.json({
    success: true,
    overview: {
      metrics: {
        totalUsers,
        totalCustomers,
        totalLeads,
        totalFollowUps,
        totalCalls,
        totalEvents,
        totalWhatsApp,
        totalEmails,
      },
      integrations: {
        smtp: {
          status: 'configured',
          host: process.env.SMTP_HOST || 'send.one.com',
          port: process.env.SMTP_PORT || 587,
          sender: smtpUser,
        },
        whatsapp: {
          status: hasWhatsApp ? 'configured' : 'simulator_mode',
          phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ? 'Configured' : 'Demo/Mock Mode',
        },
        database: {
          status: dbConnected ? 'connected' : 'disconnected',
          name: mongoose.connection.name || 'smart-crm',
        },
      },
    },
  });
});

// @desc    Get system-wide audit activity logs for Admin
// @route   GET /api/users/audit-logs
// @access  Private/Admin
const getAuditLogs = asyncHandler(async (req, res) => {
  const { limit = 30 } = req.query;
  const limitNum = Math.min(parseInt(limit, 10) || 30, 100);

  const [calls, waLogs, emailLogs] = await Promise.all([
    CallHistory.find().sort({ createdAt: -1 }).limit(limitNum),
    WhatsAppLog.find().sort({ createdAt: -1 }).limit(limitNum),
    EmailLog.find().sort({ createdAt: -1 }).limit(limitNum),
  ]);

  const activities = [
    ...calls.map((c) => ({
      id: c._id,
      type: 'call',
      actor: c.telecallerName || 'Agent',
      customer: c.customerName,
      details: `${c.duration} call (${c.status}) - ${c.remarks || 'No remarks'}`,
      time: c.createdAt || c.date,
    })),
    ...waLogs.map((w) => ({
      id: w._id,
      type: 'whatsapp',
      actor: w.sentBy || 'Agent',
      customer: w.customerName,
      details: `WhatsApp message: "${w.message?.slice(0, 60)}..." (${w.status})`,
      time: w.createdAt || w.date,
    })),
    ...emailLogs.map((e) => ({
      id: e._id,
      type: 'email',
      actor: e.sentBy || 'Agent',
      customer: e.customerName,
      details: `Email: "${e.subject}" (${e.status})`,
      time: e.createdAt || e.date,
    })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, limitNum);

  res.json({ success: true, count: activities.length, activities });
});

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  resetPassword,
  toggleUserStatus,
  deleteUser,
  reassignWorkload,
  getSystemOverview,
  getAuditLogs,
};

