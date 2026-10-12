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
  const {
    customerId,
    date,
    time,
    duration,
    status,
    remarks,
    recordingUrl,
    recordingDuration,
    recordingSize,
    waveform,
    transcript,
    aiSummary,
    customerPhone,
    phone,
    customerName,
  } = req.body;

  const effectiveDate = date || new Date().toISOString().split('T')[0];
  const effectiveTime = time || new Date().toTimeString().slice(0, 5);
  const targetPhone = customerPhone || phone;

  let customer = null;
  if (customerId) {
    customer = await Customer.findById(customerId);
  } else if (targetPhone) {
    customer = await Customer.findOne({ phone: targetPhone });
    if (!customer) {
      customer = await Customer.create({
        name: customerName || 'Customer',
        phone: targetPhone,
        telecallerId: req.user._id,
        assignedTelecaller: req.user.name,
      });
    }
  }

  if (!customer) {
    res.status(400);
    throw new Error('customerId or customerPhone is required');
  }

  if (req.user.role === 'telecaller') {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned && customerId) {
      // Allow self-logging if created on the fly
      res.status(403);
      throw new Error('You can only log calls for customers assigned to you');
    }
  }

  const call = await CallHistory.create({
    customerId: customer._id,
    customerName: customer.name,
    date: effectiveDate,
    time: effectiveTime,
    duration: duration || '0s',
    status: status || 'connected',
    remarks,
    calledBy: req.user._id,
    calledByName: req.user.name,
    recordingUrl: recordingUrl || '',
    recordingDuration: recordingDuration || duration || '',
    recordingSize: recordingSize || '',
    waveform: waveform || [],
    transcript: transcript || [],
    aiSummary: aiSummary || {},
  });

  res.status(201).json({ success: true, call });
});

// @desc    Get call history (strictly isolated to the caller who made the call)
// @route   GET /api/calls?status=&date=&customerId=&page=&limit=
// @access  Private
const getCalls = asyncHandler(async (req, res) => {
  const { status, date, customerId, page = 1, limit = 10 } = req.query;
  const conditions = [];

  // Strict isolation: Telecaller only sees their own calls; Admin cannot access callers' calls or recordings!
  conditions.push({ calledBy: req.user._id });

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

// @desc    Get single call record (call recordings strictly isolated)
// @route   GET /api/calls/:id
// @access  Private
const getCallById = asyncHandler(async (req, res) => {
  const call = await CallHistory.findById(req.params.id);

  if (!call) {
    res.status(404);
    throw new Error('Call record not found');
  }

  if (String(call.calledBy) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Access denied: You cannot access calls or call recordings belonging to another user');
  }

  res.json({ success: true, call });
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

  if (String(call.calledBy) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Access denied: You can only update call records you initiated');
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

module.exports = { createCall, getCalls, getCallById, updateCall, deleteCall };
