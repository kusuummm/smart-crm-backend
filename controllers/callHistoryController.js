const asyncHandler = require('express-async-handler');
const CallHistory = require('../models/CallHistory');
const Customer = require('../models/Customer');

const scopeToRole = (req, filter = {}) => {
  if (req.user.role === 'telecaller') {
    filter.calledBy = req.user._id;
  }
  return filter;
};

// @desc    Log a call record
// @route   POST /api/calls
// @access  Private
const createCall = asyncHandler(async (req, res) => {
  const { customerId, date, time, duration, status, remarks } = req.body;

  if (!customerId || !date || !time) {
    res.status(400);
    throw new Error('customerId, date and time are required');
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const call = await CallHistory.create({
    customerId,
    customerName: customer.name,
    date,
    time,
    duration,
    status,
    remarks,
    calledBy: req.user._id,
  });

  res.status(201).json({ success: true, call });
});

// @desc    Get call history (filter by status/date/customer, pagination)
// @route   GET /api/calls?status=&date=&customerId=&page=&limit=
// @access  Private
const getCalls = asyncHandler(async (req, res) => {
  const { status, date, customerId, page = 1, limit = 10 } = req.query;
  const filter = scopeToRole(req);

  if (status) filter.status = status;
  if (date) filter.date = date;
  if (customerId) filter.customerId = customerId;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const [calls, total] = await Promise.all([
    CallHistory.find(filter)
      .sort({ date: -1, time: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    CallHistory.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: calls.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    calls,
  });
});

// @desc    Update a call record
// @route   PUT /api/calls/:id
// @access  Private
const updateCall = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const call = await CallHistory.findOne(filter);

  if (!call) {
    res.status(404);
    throw new Error('Call record not found');
  }

  Object.assign(call, req.body);
  await call.save();

  res.json({ success: true, call });
});

// @desc    Delete a call record
// @route   DELETE /api/calls/:id
// @access  Private
const deleteCall = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const call = await CallHistory.findOne(filter);

  if (!call) {
    res.status(404);
    throw new Error('Call record not found');
  }

  await call.deleteOne();
  res.json({ success: true, message: 'Call record deleted successfully' });
});

module.exports = { createCall, getCalls, updateCall, deleteCall };
