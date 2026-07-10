const asyncHandler = require('express-async-handler');
const FollowUp = require('../models/FollowUp');
const Customer = require('../models/Customer');

const scopeToRole = (req, filter = {}) => {
  if (req.user.role === 'telecaller') {
    filter.createdBy = req.user._id;
  }
  return filter;
};

// @desc    Create a follow-up
// @route   POST /api/followups
// @access  Private
const createFollowUp = asyncHandler(async (req, res) => {
  const { customerId, date, time, remarks, nextFollowUp } = req.body;

  if (!customerId || !date || !time) {
    res.status(400);
    throw new Error('customerId, date and time are required');
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const followUp = await FollowUp.create({
    customerId,
    customerName: customer.name,
    date,
    time,
    remarks,
    nextFollowUp,
    status: 'pending',
    createdBy: req.user._id,
    createdByName: req.user.name,
  });

  res.status(201).json({ success: true, followUp });
});

// @desc    Get follow-ups (filter by status/date, pagination)
// @route   GET /api/followups?status=&date=&page=1&limit=10
// @access  Private
const getFollowUps = asyncHandler(async (req, res) => {
  const { status, date, page = 1, limit = 10 } = req.query;
  const filter = scopeToRole(req);

  if (status) filter.status = status;
  if (date) filter.date = date;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const [followUps, total] = await Promise.all([
    FollowUp.find(filter)
      .sort({ date: 1, time: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    FollowUp.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: followUps.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    followUps,
  });
});

// @desc    Get today's pending follow-ups (used by dashboard widget)
// @route   GET /api/followups/today
// @access  Private
const getTodayFollowUps = asyncHandler(async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const filter = scopeToRole(req, { date: today, status: 'pending' });

  const followUps = await FollowUp.find(filter).sort({ time: 1 });
  res.json({ success: true, count: followUps.length, followUps });
});

// @desc    Update a follow-up (mark complete, edit remarks, reschedule, etc.)
// @route   PUT /api/followups/:id
// @access  Private
const updateFollowUp = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const followUp = await FollowUp.findOne(filter);

  if (!followUp) {
    res.status(404);
    throw new Error('Follow-up not found');
  }

  Object.assign(followUp, req.body);
  await followUp.save();

  res.json({ success: true, followUp });
});

// @desc    Delete a follow-up
// @route   DELETE /api/followups/:id
// @access  Private
const deleteFollowUp = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const followUp = await FollowUp.findOne(filter);

  if (!followUp) {
    res.status(404);
    throw new Error('Follow-up not found');
  }

  await followUp.deleteOne();
  res.json({ success: true, message: 'Follow-up deleted successfully' });
});

module.exports = { createFollowUp, getFollowUps, getTodayFollowUps, updateFollowUp, deleteFollowUp };
