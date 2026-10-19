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
  const { name, email, password, role, phone, status, isApproved } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email and password are required');
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  // Normalize role to lower-case
  let assignedRole = (role || 'member').toLowerCase().trim();
  if (assignedRole === 'lead' || assignedRole === 'standard user') {
    assignedRole = 'member';
  }

  // Security guard: Only an Owner can create another Owner account
  const callerRole = (req.user?.role || '').toLowerCase();
  if (assignedRole === 'owner' && callerRole !== 'owner') {
    res.status(403);
    throw new Error('Only an organization Owner can create another Owner account');
  }

  // Safety: non-owners cannot create admins unless requester is admin or owner
  if (assignedRole === 'admin' && callerRole !== 'owner' && callerRole !== 'admin') {
    res.status(403);
    throw new Error('Only an Administrator or Owner can create Admin accounts');
  }

  // When created directly by an administrator or owner, default to active and approved
  const finalStatus = status || 'active';
  const finalApproved = isApproved !== undefined ? Boolean(isApproved) : true;

  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    role: assignedRole,
    phone: phone ? phone.trim() : '',
    status: finalStatus,
    isApproved: finalApproved,
  });

  let message = 'User account created successfully!';
  if (assignedRole === 'owner') {
    message = 'Organization Owner account created successfully!';
  } else if (assignedRole === 'admin') {
    message = 'Administrator account created successfully!';
  } else if (assignedRole === 'manager') {
    message = 'Team Manager account created successfully! Can supervise team leads and distribute leads.';
  } else {
    message = 'Team Member account created successfully!';
  }

  res.status(201).json({
    success: true,
    user,
    message,
  });
});

// @desc    Get all users (optionally filter by role/status), enriched with workload counts
// @route   GET /api/users?role=telecaller
// @access  Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role && req.query.role !== 'all') {
    const qRole = req.query.role.toLowerCase().trim();
    if (qRole === 'owner') {
      filter.role = { $in: ['owner', 'Owner'] };
    } else if (qRole === 'admin') {
      filter.role = { $in: ['admin', 'Admin'] };
    } else if (qRole === 'manager') {
      filter.role = { $in: ['manager', 'Manager'] };
    } else if (qRole === 'member' || qRole === 'telecaller' || qRole === 'lead') {
      filter.role = { $in: ['member', 'Member', 'telecaller', 'Telecaller', 'user', 'User', 'lead', 'Lead'] };
    } else {
      filter.role = req.query.role;
    }
  }
  if (req.query.status) filter.status = req.query.status;
  if (req.query.pending === 'true') {
    filter.$or = [{ status: 'pending' }, { isApproved: false }];
  }

  // Look up users and recent active sessions within the last 3 minutes in parallel
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
  const [users, activeSessions] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).lean(),
    Session.find({
      lastSeenAt: { $gte: threeMinutesAgo },
    }).select('user lastSeenAt').lean(),
  ]);

  const activeSessionMap = new Map();
  activeSessions.forEach((s) => {
    activeSessionMap.set(String(s.user), s.lastSeenAt);
  });

  // Pre-calculate customer and lead counts across all operational users (members, telecallers, managers)
  const isOperationalRole = (r) => {
    const roleLower = (r || '').toLowerCase();
    return roleLower !== 'admin' && roleLower !== 'owner';
  };
  const callerUserIds = users.filter((u) => isOperationalRole(u.role)).map((u) => u._id);
  const callerNames = users.filter((u) => isOperationalRole(u.role)).map((u) => u.name);

  const [customerAgg, leadAgg] = await Promise.all([
    Customer.aggregate([
      {
        $match: {
          $or: [
            { telecallerId: { $in: callerUserIds } },
            { assignedTelecaller: { $in: callerNames } },
          ],
        },
      },
      {
        $project: {
          matchedKey: {
            $cond: [
              { $and: [{ $ne: ['$telecallerId', null] }, { $in: ['$telecallerId', callerUserIds] }] },
              { $toString: '$telecallerId' },
              '$assignedTelecaller',
            ],
          },
        },
      },
      {
        $group: {
          _id: '$matchedKey',
          count: { $sum: 1 },
        },
      },
    ]),
    Lead.aggregate([
      { $match: { telecallerId: { $in: callerUserIds } } },
      { $group: { _id: '$telecallerId', count: { $sum: 1 } } },
    ]),
  ]);

  const customerCountMap = new Map();
  customerAgg.forEach((item) => {
    if (item._id) customerCountMap.set(String(item._id), item.count);
  });

  const leadCountMap = new Map();
  leadAgg.forEach((item) => {
    if (item._id) leadCountMap.set(String(item._id), item.count);
  });

  // Enrich each user with assigned customer and lead counts and real-time online status
  const enrichedUsers = users.map((u) => {
    const uObj = u.toObject ? u.toObject() : { ...u };
    const lastSessionSeen = activeSessionMap.get(String(u._id));
    const hasRecentActivity = u.lastActive && (Date.now() - new Date(u.lastActive).getTime()) < 3 * 60 * 1000;
    
    // User is online if active account with active session or recent heartbeat
    const isOnline = Boolean(
      u.status === 'active' && (lastSessionSeen || (u.isOnline && hasRecentActivity))
    );
    uObj.isOnline = isOnline;
    uObj.lastActive = lastSessionSeen || u.lastActive || u.updatedAt || u.createdAt;

    if (isOperationalRole(u.role)) {
      const byId = customerCountMap.get(String(u._id)) || 0;
      const byName = customerCountMap.get(u.name) || 0;
      uObj.assignedCustomers = Math.max(byId, byName);
      uObj.assignedLeads = leadCountMap.get(String(u._id)) || 0;
    } else {
      uObj.assignedCustomers = 0;
      uObj.assignedLeads = 0;
    }
    return uObj;
  });

  const pendingCount = await User.countDocuments({
    $or: [{ status: 'pending' }, { isApproved: false }],
  });

  res.json({
    success: true,
    count: enrichedUsers.length,
    pendingCount,
    users: enrichedUsers,
  });
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
  const callerRole = (req.user?.role || '').toLowerCase();

  if (name) user.name = name.trim();
  if (phone !== undefined) user.phone = phone;

  if (role) {
    let newRole = role.toLowerCase().trim();
    if (newRole === 'lead' || newRole === 'standard user') newRole = 'member';

    // Hierarchy guards:
    // Only an Owner can promote a user to Owner
    if (newRole === 'owner' && callerRole !== 'owner') {
      res.status(403);
      throw new Error('Only an organization Owner can promote a user to Owner');
    }

    // Only an Owner can demote or change an Owner account's role
    if (user.role?.toLowerCase() === 'owner' && callerRole !== 'owner') {
      res.status(403);
      throw new Error('Only an organization Owner can modify an Owner account');
    }

    user.role = newRole;
  }

  await user.save();

  // If operational user name changed, sync denormalized assignedTelecaller in Customer records
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

  const callerRole = (req.user?.role || '').toLowerCase();
  if (user.role?.toLowerCase() === 'owner' && callerRole !== 'owner') {
    res.status(403);
    throw new Error('Only an organization Owner can reset an Owner password');
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
    throw new Error('You cannot disable your own active account');
  }

  const callerRole = (req.user?.role || '').toLowerCase();
  if (user.role?.toLowerCase() === 'owner' && callerRole !== 'owner') {
    res.status(403);
    throw new Error('Only an organization Owner can change status of an Owner account');
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
    throw new Error('You cannot delete your own account');
  }

  const callerRole = (req.user?.role || '').toLowerCase();
  if (user.role?.toLowerCase() === 'owner') {
    if (callerRole !== 'owner') {
      res.status(403);
      throw new Error('Only an organization Owner can delete an Owner account');
    }
    const ownerCount = await User.countDocuments({ role: { $in: ['owner', 'Owner'] } });
    if (ownerCount <= 1) {
      res.status(400);
      throw new Error('Cannot delete the last remaining Owner account in the organization');
    }
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

// @desc    Approve a pending telecaller registration
// @route   PUT /api/users/:id/approve
// @access  Private/Admin
const approveUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.status = 'active';
  user.isApproved = true;
  await user.save();

  res.json({
    success: true,
    message: `${user.name} has been approved successfully. They can now access the system.`,
    user,
  });
});

// @desc    Reject a pending telecaller registration
// @route   PUT /api/users/:id/reject
// @access  Private/Admin
const rejectUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.status = 'rejected';
  user.isApproved = false;
  await user.save();

  // Invalidate any active session
  await Session.deleteMany({ user: user._id });

  res.json({
    success: true,
    message: `${user.name}'s registration has been rejected.`,
    user,
  });
});

// @desc    Get system-wide audit activity logs for Admin (strictly administrative, callers isolated)
// @route   GET /api/users/audit-logs
// @access  Private/Admin
const getAuditLogs = asyncHandler(async (req, res) => {
  const { limit = 30 } = req.query;
  const limitNum = Math.min(parseInt(limit, 10) || 30, 100);

  // Admin cannot access callers' call recordings or caller contacts
  // Only administrative activity logs are returned
  const [waLogs, emailLogs] = await Promise.all([
    WhatsAppLog.find({ sentBy: req.user._id }).sort({ createdAt: -1 }).limit(limitNum),
    EmailLog.find({ sentBy: req.user._id }).sort({ createdAt: -1 }).limit(limitNum),
  ]);

  const activities = [
    ...waLogs.map((w) => ({
      id: w._id,
      type: 'whatsapp',
      actor: w.sentByName || 'Admin',
      customer: w.customerName,
      details: `WhatsApp message: "${w.message?.slice(0, 60)}..." (${w.status})`,
      time: w.createdAt || w.date,
    })),
    ...emailLogs.map((e) => ({
      id: e._id,
      type: 'email',
      actor: e.sentByName || 'Admin',
      customer: e.customerName,
      details: `Email: "${e.subject}" (${e.status})`,
      time: e.createdAt || e.date,
    })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, limitNum);

  res.json({ success: true, count: activities.length, activities });
});

// @desc    Heartbeat to keep caller online status alive
// @route   POST /api/users/heartbeat
// @access  Private
const heartbeat = asyncHandler(async (req, res) => {
  if (req.user) {
    await User.updateOne(
      { _id: req.user._id },
      { $set: { isOnline: true, lastActive: new Date() } }
    );
  }
  if (req.sessionId) {
    await Session.updateOne({ tokenId: req.sessionId }, { $set: { lastSeenAt: new Date() } });
  }
  res.json({ success: true, isOnline: true, lastActive: new Date() });
});

const parseDurationToSeconds = (dur) => {
  if (!dur) return 0;
  if (typeof dur === 'number') return dur;
  const str = String(dur).toLowerCase().trim();
  let total = 0;
  const mMatch = str.match(/(\d+)\s*m/);
  const sMatch = str.match(/(\d+)\s*s/);
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  if (sMatch) total += parseInt(sMatch[1], 10);
  if (!mMatch && !sMatch) {
    const num = parseInt(str, 10);
    if (!isNaN(num)) total = num;
  }
  return total;
};

// @desc    Get overall aggregate progress report of callers across a period
// @route   GET /api/users/callers-progress-report?period=7d&startDate=&endDate=
// @access  Private/Admin
const getCallersProgressReport = asyncHandler(async (req, res) => {
  const { period = '7d', startDate: customStart, endDate: customEnd } = req.query;

  const now = new Date();
  let start = new Date();
  let end = new Date();
  end.setHours(23, 59, 59, 999);

  if (customStart && customEnd) {
    start = new Date(customStart + 'T00:00:00');
    end = new Date(customEnd + 'T23:59:59');
  } else if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === '14d') {
    start.setDate(now.getDate() - 13);
    start.setHours(0, 0, 0, 0);
  } else if (period === '30d') {
    start.setDate(now.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'this-month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  } else {
    // default 7d
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  }

  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  const [telecallers, calls, leads] = await Promise.all([
    User.find({
      role: { $in: ['telecaller', 'Telecaller', 'member', 'Member', 'manager', 'Manager', 'lead', 'Lead'] },
      isApproved: true,
    })
      .select('_id name email avatar phone isOnline')
      .lean(),
    CallHistory.find({
      date: { $gte: startStr, $lte: endStr },
    })
      .populate('customerId', 'name mobile phone company city')
      .lean(),
    Lead.find({
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { 'history.date': { $gte: start, $lte: end } },
      ],
    })
      .populate('customerId', 'name mobile phone company city')
      .lean(),
  ]);

  const daysArray = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dStr = cur.toISOString().split('T')[0];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    daysArray.push({
      date: dStr,
      displayDate: `${monthNames[cur.getMonth()]} ${cur.getDate()}`,
      dayName: dayNames[cur.getDay()],
    });
    cur.setDate(cur.getDate() + 1);
  }

  let totalCalls = 0;
  let totalConnected = 0;
  let totalMissed = 0;
  let totalBusy = 0;
  let totalDurationSec = 0;
  let totalLeadsFollowedUp = 0;
  let totalConversions = 0;
  const activeCallerIdSet = new Set();

  const dailyTrend = daysArray.map((dayObj) => {
    const dayCalls = calls.filter((c) => c.date === dayObj.date);
    const dayConnected = dayCalls.filter((c) => c.status === 'connected');
    const dayMissed = dayCalls.filter((c) => c.status === 'missed');
    const dayBusy = dayCalls.filter((c) => c.status === 'busy');

    let dayDurSec = 0;
    const dayCallerSet = new Set();
    dayCalls.forEach((c) => {
      dayDurSec += parseDurationToSeconds(c.duration);
      if (c.calledBy) {
        dayCallerSet.add(String(c.calledBy));
        activeCallerIdSet.add(String(c.calledBy));
      }
    });

    let dayLeadsUpdated = 0;
    let dayConversions = 0;
    leads.forEach((l) => {
      if (l.history && l.history.length > 0) {
        l.history.forEach((h) => {
          if (h.date) {
            const hDateStr = new Date(h.date).toISOString().split('T')[0];
            if (hDateStr === dayObj.date) {
              dayLeadsUpdated++;
              if (h.status === 'converted') dayConversions++;
              if (h.updatedBy) {
                dayCallerSet.add(String(h.updatedBy));
                activeCallerIdSet.add(String(h.updatedBy));
              }
            }
          }
        });
      }
    });

    totalCalls += dayCalls.length;
    totalConnected += dayConnected.length;
    totalMissed += dayMissed.length;
    totalBusy += dayBusy.length;
    totalDurationSec += dayDurSec;
    totalLeadsFollowedUp += dayLeadsUpdated;
    totalConversions += dayConversions;

    const dayDurMin = Math.round(dayDurSec / 60);

    return {
      date: dayObj.date,
      displayDate: dayObj.displayDate,
      dayName: dayObj.dayName,
      totalCalls: dayCalls.length,
      connectedCalls: dayConnected.length,
      missedCalls: dayMissed.length,
      busyCalls: dayBusy.length,
      durationMinutes: dayDurMin,
      durationFormatted: `${Math.floor(dayDurMin / 60)}h ${dayDurMin % 60}m`,
      leadsFollowedUp: dayLeadsUpdated,
      conversions: dayConversions,
      activeCallersCount: dayCallerSet.size,
    };
  });

  const callersBreakdown = telecallers.map((t) => {
    const tCalls = calls.filter((c) => String(c.calledBy) === String(t._id));
    const tConnected = tCalls.filter((c) => c.status === 'connected');
    let tDurSec = 0;
    tCalls.forEach((c) => {
      tDurSec += parseDurationToSeconds(c.duration);
    });

    let tLeadsUpdated = 0;
    let tConversions = 0;
    leads.forEach((l) => {
      if (String(l.telecallerId) === String(t._id)) {
        if (l.history) {
          l.history.forEach((h) => {
            if (h.date) {
              const hDateStr = new Date(h.date).toISOString().split('T')[0];
              if (hDateStr >= startStr && hDateStr <= endStr) {
                tLeadsUpdated++;
                if (h.status === 'converted') tConversions++;
              }
            }
          });
        }
      }
    });

    const tDurMin = Math.round(tDurSec / 60);
    const convRate = tCalls.length > 0 ? ((tConversions / tCalls.length) * 100).toFixed(1) + '%' : '0.0%';

    return {
      callerId: t._id,
      name: t.name,
      email: t.email,
      phone: t.phone || '',
      avatar: t.avatar || t.name.slice(0, 2).toUpperCase(),
      isOnline: Boolean(t.isOnline),
      totalCalls: tCalls.length,
      connectedCalls: tConnected.length,
      totalDurationMinutes: tDurMin,
      leadsFollowedUp: tLeadsUpdated,
      conversions: tConversions,
      conversionRate: convRate,
    };
  }).sort((a, b) => b.totalCalls - a.totalCalls);

  const stageCounts = {
    new: 0,
    contacted: 0,
    interested: 0,
    meeting: 0,
    'follow-up': 0,
    converted: 0,
    'not-interested': 0,
    closed: 0,
  };
  leads.forEach((l) => {
    if (stageCounts[l.status] !== undefined) {
      stageCounts[l.status]++;
    }
  });

  const pipelineDistribution = [
    { name: 'New Follow-up', status: 'new', count: stageCounts['new'], color: '#3b82f6' },
    { name: 'Contacted', status: 'contacted', count: stageCounts['contacted'], color: '#f59e0b' },
    { name: 'Interested', status: 'interested', count: stageCounts['interested'], color: '#8b5cf6' },
    { name: 'Meeting Scheduled', status: 'meeting', count: stageCounts['meeting'], color: '#6366f1' },
    { name: 'In Progress', status: 'follow-up', count: stageCounts['follow-up'], color: '#ea580c' },
    { name: 'Converted / Won', status: 'converted', count: stageCounts['converted'], color: '#10b981' },
    { name: 'Not Interested', status: 'not-interested', count: stageCounts['not-interested'], color: '#ef4444' },
    { name: 'Closed', status: 'closed', count: stageCounts['closed'], color: '#6b7280' },
  ];

  const totalDurMin = Math.round(totalDurationSec / 60);
  const avgSec = totalConnected > 0 ? Math.round(totalDurationSec / totalConnected) : 0;
  const avgFormatted = `${Math.floor(avgSec / 60)}m ${avgSec % 60}s`;

  res.json({
    success: true,
    period,
    startDate: startStr,
    endDate: endStr,
    summary: {
      totalCalls,
      connectedCalls: totalConnected,
      missedCalls: totalMissed,
      busyCalls: totalBusy,
      totalDurationMinutes: totalDurMin,
      totalDurationFormatted: `${Math.floor(totalDurMin / 60)}h ${totalDurMin % 60}m`,
      avgCallDuration: avgFormatted,
      totalLeadsFollowedUp,
      totalConversions,
      overallConversionRate: totalCalls > 0 ? ((totalConversions / totalCalls) * 100).toFixed(1) + '%' : '0.0%',
      activeCallersCount: activeCallerIdSet.size,
      totalRegisteredCallers: telecallers.length,
      topPerformingCaller: callersBreakdown[0] || null,
    },
    dailyTrend,
    pipelineDistribution,
    callOutcomes: [
      { name: 'Connected', value: totalConnected, color: '#10b981' },
      { name: 'Missed', value: totalMissed, color: '#ef4444' },
      { name: 'Busy', value: totalBusy, color: '#f59e0b' },
    ],
    callersBreakdown,
  });
});

// @desc    Get detailed audit and call logs for a specific day or metric category
// @route   GET /api/users/callers-progress-detail?date=YYYY-MM-DD&status=&callerId=
// @access  Private/Admin
const getCallersProgressDetail = asyncHandler(async (req, res) => {
  const { date, status, callerId } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  const callQuery = { date: targetDate };
  if (status) callQuery.status = status;
  if (callerId) callQuery.calledBy = callerId;

  const [calls, leads, telecallers] = await Promise.all([
    CallHistory.find(callQuery)
      .populate('customerId', 'name mobile phone company city')
      .populate('calledBy', 'name email avatar phone')
      .sort({ time: -1 }),
    Lead.find({
      'history.date': {
        $gte: new Date(targetDate + 'T00:00:00.000Z'),
        $lte: new Date(targetDate + 'T23:59:59.999Z'),
      },
    })
      .populate('customerId', 'name mobile phone company city')
      .populate('telecallerId', 'name email avatar'),
    User.find({
      role: { $in: ['telecaller', 'Telecaller', 'member', 'Member', 'manager', 'Manager', 'lead', 'Lead'] },
    }).select('_id name email avatar phone isOnline'),
  ]);

  const callerStatsMap = {};
  telecallers.forEach((t) => {
    callerStatsMap[String(t._id)] = {
      callerId: t._id,
      name: t.name,
      email: t.email,
      avatar: t.avatar || t.name.slice(0, 2).toUpperCase(),
      phone: t.phone || '',
      callsCount: 0,
      connectedCount: 0,
      missedCount: 0,
      durationSeconds: 0,
      leadsUpdated: 0,
      conversions: 0,
    };
  });

  const formattedLogs = [];

  calls.forEach((c) => {
    const callerIdStr = c.calledBy?._id ? String(c.calledBy._id) : (c.calledBy ? String(c.calledBy) : null);
    const durSec = parseDurationToSeconds(c.duration);
    if (callerIdStr && callerStatsMap[callerIdStr]) {
      callerStatsMap[callerIdStr].callsCount++;
      if (c.status === 'connected') callerStatsMap[callerIdStr].connectedCount++;
      if (c.status === 'missed') callerStatsMap[callerIdStr].missedCount++;
      callerStatsMap[callerIdStr].durationSeconds += durSec;
    }

    formattedLogs.push({
      id: c._id,
      time: c.time || '10:00',
      type: 'call',
      callerName: c.calledBy?.name || c.calledByName || 'Telecaller',
      customerName: c.customerName || c.customerId?.name || 'Customer',
      customerPhone: c.customerId?.mobile || c.customerId?.phone || '',
      customerCompany: c.customerId?.company || '',
      status: c.status,
      duration: c.duration,
      remarks: c.remarks || 'Outbound customer interaction',
      sentiment: c.aiSummary?.sentiment || 'Neutral',
    });
  });

  leads.forEach((l) => {
    if (l.history && l.history.length > 0) {
      l.history.forEach((h) => {
        if (h.date) {
          const hDateStr = new Date(h.date).toISOString().split('T')[0];
          if (hDateStr === targetDate) {
            const updaterIdStr = h.updatedBy ? String(h.updatedBy) : (l.telecallerId ? String(l.telecallerId._id || l.telecallerId) : null);
            if (updaterIdStr && callerStatsMap[updaterIdStr]) {
              callerStatsMap[updaterIdStr].leadsUpdated++;
              if (h.status === 'converted') callerStatsMap[updaterIdStr].conversions++;
            }

            formattedLogs.push({
              id: `${l._id}-${new Date(h.date).getTime()}`,
              time: new Date(h.date).toTimeString().slice(0, 5),
              type: 'lead-update',
              callerName: l.telecallerId?.name || 'Assigned Caller',
              customerName: l.customerName || l.customerId?.name || 'Customer',
              customerPhone: l.customerId?.mobile || l.customerId?.phone || '',
              customerCompany: l.customerId?.company || '',
              status: h.status,
              duration: '-',
              remarks: h.remark || `Follow-up status updated to ${h.status}`,
              sentiment: h.status === 'converted' ? 'Positive' : 'Neutral',
            });
          }
        }
      });
    }
  });

  formattedLogs.sort((a, b) => (b.time > a.time ? 1 : -1));

  const activeCallersThisDay = Object.values(callerStatsMap).filter((c) => c.callsCount > 0 || c.leadsUpdated > 0);

  res.json({
    success: true,
    date: targetDate,
    totalCalls: calls.length,
    connectedCalls: calls.filter((c) => c.status === 'connected').length,
    totalLogs: formattedLogs.length,
    activeCallersThisDay,
    logs: formattedLogs,
  });
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
  approveUser,
  rejectUser,
  heartbeat,
  getCallersProgressReport,
  getCallersProgressDetail,
};

