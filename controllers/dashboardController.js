const isAdminOrOwner = (user) => {
  const r = (user?.role || '').toLowerCase();
  return r === 'admin' || r === 'owner';
};

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
  const isAgent = !isAdminOrOwner(req.user);
  let customerFilter = {};
  let leadFilter = {};
  let followUpFilter = {};
  let logFilter = {};

  if (isAgent) {
    const customerIds = await Customer.find({
      $or: [{ telecallerId: req.user._id }, { assignedTelecaller: req.user.name }],
    }).distinct('_id');

    const leadCustomerIds = await Lead.distinct('customerId').catch(() => []);
    const leadCustomerIdStrings = new Set(leadCustomerIds.map(String));
    const distinctClientIds = customerIds.filter((id) => !leadCustomerIdStrings.has(String(id)));

    // Clients count strictly counts clients, excluding pipeline leads
    customerFilter = { _id: { $in: distinctClientIds } };
    leadFilter = {
      $or: [{ telecallerId: req.user._id }, { customerId: { $in: customerIds } }],
    };
    followUpFilter = {
      $or: [
        { createdBy: req.user._id },
        { assignedTo: req.user._id },
        { customerId: { $in: customerIds } },
      ],
    };
    logFilter = { sentBy: req.user._id };
  } else if (req.query.telecallerId && req.query.telecallerId !== 'all') {
    if (req.query.telecallerId === 'unassigned') {
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
    } else {
      customerFilter = { telecallerId: req.query.telecallerId };
      leadFilter = { telecallerId: req.query.telecallerId };
    }
    followUpFilter = { assignedTo: req.query.telecallerId };
    logFilter = { sentBy: req.query.telecallerId };
  } else {
    // Admin CRM-wide overview: counts all customers, leads, and CRM activities
    customerFilter = {};
    leadFilter = {};
    followUpFilter = {};
    logFilter = {};
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
