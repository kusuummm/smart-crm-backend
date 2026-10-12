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
    $or: [{ name: regex }, { mobile: regex }, { email: regex }, { company: regex }, { city: regex }],
  };

  let filter;
  if (req.user.role === 'telecaller') {
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
  } else {
    // Admin CANNOT access contacts assigned to callers! Admin only searches unassigned contacts.
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
  }

  const results = await Customer.find(filter).limit(20);
  res.json({ success: true, count: results.length, results });
});

module.exports = { globalSearch };
