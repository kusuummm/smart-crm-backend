const asyncHandler = require('express-async-handler');
const CallHistory = require('../models/CallHistory');
const Customer = require('../models/Customer');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
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

  if (req.user.role === 'telecaller') {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only log calls for customers assigned to you');
    }
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
    calledByName: req.user.name,
  });

  res.status(201).json({ success: true, call });
});

// @desc    Get call history (filter by status/date/customer, pagination)
// @route   GET /api/calls?status=&date=&customerId=&page=&limit=
// @access  Private
const getCalls = asyncHandler(async (req, res) => {
  const { status, date, customerId, page = 1, limit = 10 } = req.query;
  const conditions = [];

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    conditions.push({
      $or: [
        { calledBy: req.user._id },
        { customerId: { $in: customerIds } },
      ],
    });
  } else if (req.query.telecallerId && req.query.telecallerId !== 'all') {
    conditions.push({ calledBy: req.query.telecallerId });
  }

  if (status) conditions.push({ status });
  if (date) conditions.push({ date });
  if (customerId) conditions.push({ customerId });

  const filter = conditions.length > 0 ? { $and: conditions } : {};

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
  const call = await CallHistory.findById(req.params.id);

  if (!call) {
    res.status(404);
    throw new Error('Call record not found');
  }

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    const hasAccess = String(call.calledBy) === String(req.user._id) ||
                      customerIds.some(id => String(id) === String(call.customerId));
    if (!hasAccess) {
      res.status(403);
      throw new Error('Access denied to update this call record');
    }
  }

  Object.assign(call, req.body);
  await call.save();

  res.json({ success: true, call });
});

// @desc    Delete a call record
// @route   DELETE /api/calls/:id
// @access  Private/Admin
const deleteCall = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Only administrators can delete call history records');
  }

  const call = await CallHistory.findById(req.params.id);

  if (!call) {
    res.status(404);
    throw new Error('Call record not found');
  }

  await call.deleteOne();
  res.json({ success: true, message: 'Call record deleted successfully' });
});

module.exports = { createCall, getCalls, updateCall, deleteCall };
