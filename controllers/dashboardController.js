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
  const telecallerId = isTelecaller ? req.user._id : req.query.telecallerId;
  let customerFilter = {};
  let leadFilter = {};
  let followUpFilter = {};
  let logFilter = {};

  if (telecallerId && telecallerId !== 'all') {
    if (telecallerId === 'unassigned') {
      customerFilter = {
        $or: [
          { telecallerId: null, assignedTelecaller: null },
          { telecallerId: { $exists: false }, assignedTelecaller: { $exists: false } },
          { assignedTelecaller: '' },
          { assignedTelecaller: 'Unassigned' },
        ],
      };
      const unassignedCustIds = await Customer.find(customerFilter).distinct('_id');
      leadFilter = {
        $or: [
          { telecallerId: null },
          { telecallerId: { $exists: false } },
          { customerId: { $in: unassignedCustIds } },
        ],
      };
      followUpFilter = { customerId: { $in: unassignedCustIds } };
      logFilter = { customerId: { $in: unassignedCustIds } };
    } else {
      const targetUser = await User.findById(telecallerId);
      const orConditions = [{ telecallerId }];
      if (targetUser && targetUser.name) {
        orConditions.push({ assignedTelecaller: targetUser.name });
      }

      const customerIds = await Customer.find({ $or: orConditions }).distinct('_id');

      customerFilter = { $or: orConditions };
      leadFilter = {
        $or: [{ telecallerId }, { customerId: { $in: customerIds } }],
      };
      followUpFilter = {
        $or: [{ createdBy: telecallerId }, { customerId: { $in: customerIds } }],
      };
      logFilter = {
        $or: [{ sentBy: telecallerId }, { customerId: { $in: customerIds } }],
      };
    }
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
    },
    unassignedCount: {
      customers: unassignedCustomers,
      leads: unassignedLeads,
    },
  });
});

module.exports = { getStats };
