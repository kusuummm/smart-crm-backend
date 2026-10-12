const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const WhatsAppLog = require('../models/WhatsAppLog');
const EmailLog = require('../models/EmailLog');
const User = require('../models/User');

// @desc    Get dashboard summary stats
//          Admin sees CRM-wide numbers or filtered by telecallerId; telecallers see only their own scope.
// @route   GET /api/dashboard/stats?telecallerId=
// @access  Private
const getStats = asyncHandler(async (req, res) => {
  const isTelecaller = req.user.role === 'telecaller';
  let customerFilter = {};
  let leadFilter = {};
  let followUpFilter = {};
  let logFilter = {};

  if (isTelecaller) {
    customerFilter = {
      $or: [{ telecallerId: req.user._id }, { assignedTelecaller: req.user.name }],
    };
    leadFilter = { telecallerId: req.user._id };
    followUpFilter = { createdBy: req.user._id };
    logFilter = { sentBy: req.user._id };
  } else {
    // Admin CANNOT access contacts assigned to callers! Admin only sees unassigned items
    customerFilter = {
      $or: [
        { telecallerId: null },
        { telecallerId: { $exists: false } },
        { assignedTelecaller: 'Unassigned' },
        { assignedTelecaller: '' },
        { assignedTelecaller: null },
      ],
    };
    leadFilter = {
      $or: [{ telecallerId: null }, { telecallerId: { $exists: false } }],
    };
    followUpFilter = { createdBy: req.user._id };
    logFilter = { sentBy: req.user._id };
  }

  const today = new Date().toISOString().split('T')[0];

  const [
    totalCustomers,
    totalLeads,
    todayFollowUps,
    pendingFollowUps,
    completedFollowUps,
    whatsappCount,
    emailCount,
    unassignedCustomers,
    unassignedLeads,
    pendingApprovals,
  ] = await Promise.all([
    Customer.countDocuments(customerFilter),
    Lead.countDocuments(leadFilter),
    FollowUp.countDocuments({ ...followUpFilter, date: today }),
    FollowUp.countDocuments({ ...followUpFilter, status: 'pending' }),
    FollowUp.countDocuments({ ...followUpFilter, status: 'completed' }),
    WhatsAppLog.countDocuments(logFilter),
    EmailLog.countDocuments(logFilter),
    Customer.countDocuments({
      $or: [
        { telecallerId: null, assignedTelecaller: null },
        { telecallerId: { $exists: false }, assignedTelecaller: { $exists: false } },
        { assignedTelecaller: '' },
        { assignedTelecaller: 'Unassigned' },
      ],
    }),
    Lead.countDocuments({
      $or: [{ telecallerId: null }, { telecallerId: { $exists: false } }],
    }),
    User.countDocuments({
      $or: [{ status: 'pending' }, { isApproved: false }],
    }),
  ]);

  res.json({
    success: true,
    stats: {
      totalCustomers,
      totalLeads,
      todayFollowUps,
      pendingFollowUps,
      completedFollowUps,
      totalWhatsAppSent: whatsappCount,
      totalEmailsSent: emailCount,
      pendingApprovals,
    },
    unassignedCount: {
      customers: unassignedCustomers,
      leads: unassignedLeads,
    },
  });
});

module.exports = { getStats };
