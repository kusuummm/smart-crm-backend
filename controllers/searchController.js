const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const { escapeRegex } = require('../utils/regexHelper');

// @desc    Global search across customers by name, mobile, email, company, city
// @route   GET /api/search?q=keyword
// @access  Private
const globalSearch = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || !q.trim()) {
    return res.json({ success: true, count: 0, results: [] });
  }

  const regex = new RegExp(escapeRegex(q.trim()), 'i');
  const searchCondition = {
    $or: [
      { name: regex },
      { mobile: regex },
      { phone: regex },
      { alternateNumber: regex },
      { email: regex },
      { company: regex },
      { city: regex },
    ],
  };

  let filter;
  const callerRole = (req.user?.role || '').toLowerCase();
  const isAdminOrOwner = callerRole === 'admin' || callerRole === 'owner';
  const isManager = callerRole === 'manager';

  if (isAdminOrOwner) {
    // Admin/Owner searches unassigned contacts for assignment & distribution
    filter = {
      $and: [
        searchCondition,
        {
          $or: [
            { telecallerId: null },
            { telecallerId: { $exists: false } },
            { assignedTelecaller: 'Unassigned' },
            { assignedTelecaller: '' },
            { assignedTelecaller: null },
          ],
        },
      ],
    };
  } else if (isManager) {
    // Managers can search across all contacts to supervise pipelines
    filter = searchCondition;
  } else {
    // Telecaller / Staff searches contacts assigned to their account
    filter = {
      $and: [
        searchCondition,
        {
          $or: [
            { telecallerId: req.user._id },
            { assignedTelecaller: req.user.name },
          ],
        },
      ],
    };
  }

  const results = await Customer.find(filter).limit(20);
  res.json({ success: true, count: results.length, results });
});

module.exports = { globalSearch };
