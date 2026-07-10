const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');

// @desc    Global search across customers by name, mobile, email, company, city
// @route   GET /api/search?q=keyword
// @access  Private
const globalSearch = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || !q.trim()) {
    return res.json({ success: true, count: 0, results: [] });
  }

  const regex = new RegExp(q.trim(), 'i');
  const filter = {
    $or: [{ name: regex }, { mobile: regex }, { email: regex }, { company: regex }, { city: regex }],
  };

  if (req.user.role === 'telecaller') {
    filter.telecallerId = req.user._id;
  }

  const results = await Customer.find(filter).limit(20);
  res.json({ success: true, count: results.length, results });
});

module.exports = { globalSearch };
