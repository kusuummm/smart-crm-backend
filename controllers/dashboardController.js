const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const WhatsAppLog = require('../models/WhatsAppLog');
const EmailLog = require('../models/EmailLog');

// @desc    Get dashboard summary stats
//          Admin sees CRM-wide numbers; telecallers see only their own scope.
// @route   GET /api/dashboard/stats
// @access  Private
const getStats = asyncHandler(async (req, res) => {
  const isTelecaller = req.user.role === 'telecaller';
  const customerFilter = isTelecaller ? { telecallerId: req.user._id } : {};
  const leadFilter = isTelecaller ? { telecallerId: req.user._id } : {};
  const followUpFilter = isTelecaller ? { createdBy: req.user._id } : {};
  const logFilter = isTelecaller ? { sentBy: req.user._id } : {};

  const today = new Date().toISOString().split('T')[0];

  const [
    totalCustomers,
    totalLeads,
    todayFollowUps,
    pendingFollowUps,
    completedFollowUps,
    whatsappCount,
    emailCount,
  ] = await Promise.all([
    Customer.countDocuments(customerFilter),
    Lead.countDocuments(leadFilter),
    FollowUp.countDocuments({ ...followUpFilter, date: today }),
    FollowUp.countDocuments({ ...followUpFilter, status: 'pending' }),
    FollowUp.countDocuments({ ...followUpFilter, status: 'completed' }),
    WhatsAppLog.countDocuments(logFilter),
    EmailLog.countDocuments(logFilter),
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
  });
});

module.exports = { getStats };
