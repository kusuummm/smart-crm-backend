const asyncHandler = require('express-async-handler');
const FollowUp = require('../models/FollowUp');
const Customer = require('../models/Customer');
const User = require('../models/User');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// @desc    Create a follow-up
// @route   POST /api/followups
// @access  Private
const createFollowUp = asyncHandler(async (req, res) => {
  const { customerId, date, time, remarks, nextFollowUp, assignedTo } = req.body;

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
      throw new Error('You can only schedule follow-ups for customers assigned to you');
    }
  }

  let createdBy = req.user._id;
  let createdByName = req.user.name;
  if (req.user.role === 'admin' && assignedTo) {
    const assignedUser = await User.findById(assignedTo);
    if (assignedUser) {
      createdBy = assignedUser._id;
      createdByName = assignedUser.name;
    }
  }

  const followUp = await FollowUp.create({
    customerId,
    customerName: customer.name,
    date,
    time,
    remarks,
    nextFollowUp,
    status: 'pending',
    createdBy,
    createdByName,
  });

  res.status(201).json({ success: true, followUp });
});

// @desc    Get follow-ups (filter by status/date, pagination)
// @route   GET /api/followups?status=&date=&page=1&limit=10&telecallerId=
// @access  Private
const getFollowUps = asyncHandler(async (req, res) => {
  const { status, date, page = 1, limit = 10, telecallerId } = req.query;
  const conditions = [];

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    conditions.push({
      $or: [
        { createdBy: req.user._id },
        { customerId: { $in: customerIds } },
      ],
    });
  } else if (telecallerId && telecallerId !== 'all') {
    if (telecallerId === 'unassigned') {
      const unassignedCustIds = await Customer.find({
        $or: [
          { telecallerId: null, assignedTelecaller: null },
          { telecallerId: { $exists: false }, assignedTelecaller: { $exists: false } },
          { assignedTelecaller: '' },
          { assignedTelecaller: 'Unassigned' },
        ],
      }).distinct('_id');
      conditions.push({ customerId: { $in: unassignedCustIds } });
    } else {
      const targetUser = await User.findById(telecallerId);
      const orConditions = [{ telecallerId }];
      if (targetUser?.name) orConditions.push({ assignedTelecaller: targetUser.name });
      const customerIds = await Customer.find({ $or: orConditions }).distinct('_id');
      conditions.push({
        $or: [
          { createdBy: telecallerId },
          { customerId: { $in: customerIds } },
        ],
      });
    }
  }

  if (status) conditions.push({ status });
  if (date) conditions.push({ date });

  const filter = conditions.length > 0 ? { $and: conditions } : {};

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
// @route   GET /api/followups/today?telecallerId=
// @access  Private
const getTodayFollowUps = asyncHandler(async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const conditions = [{ date: today, status: 'pending' }];

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    conditions.push({
      $or: [
        { createdBy: req.user._id },
        { customerId: { $in: customerIds } },
      ],
    });
  } else if (req.query.telecallerId && req.query.telecallerId !== 'all') {
    if (req.query.telecallerId === 'unassigned') {
      const unassignedCustIds = await Customer.find({
        $or: [
          { telecallerId: null, assignedTelecaller: null },
          { telecallerId: { $exists: false }, assignedTelecaller: { $exists: false } },
          { assignedTelecaller: '' },
          { assignedTelecaller: 'Unassigned' },
        ],
      }).distinct('_id');
      conditions.push({ customerId: { $in: unassignedCustIds } });
    } else {
      const targetUser = await User.findById(req.query.telecallerId);
      const orConditions = [{ telecallerId: req.query.telecallerId }];
      if (targetUser?.name) orConditions.push({ assignedTelecaller: targetUser.name });
      const customerIds = await Customer.find({ $or: orConditions }).distinct('_id');
      conditions.push({
        $or: [
          { createdBy: req.query.telecallerId },
          { customerId: { $in: customerIds } },
        ],
      });
    }
  }

  const filter = { $and: conditions };

  const followUps = await FollowUp.find(filter).sort({ time: 1 });
  res.json({ success: true, count: followUps.length, followUps });
});

// @desc    Update a follow-up (mark complete, edit remarks, reschedule, etc.)
// @route   PUT /api/followups/:id
// @access  Private
const updateFollowUp = asyncHandler(async (req, res) => {
  const followUp = await FollowUp.findById(req.params.id);

  if (!followUp) {
    res.status(404);
    throw new Error('Follow-up not found');
  }

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    const hasAccess = String(followUp.createdBy) === String(req.user._id) ||
                      customerIds.some(id => String(id) === String(followUp.customerId));
    if (!hasAccess) {
      res.status(403);
      throw new Error('Access denied to update this follow-up');
    }
  }

  if (req.user.role === 'admin' && req.body.assignedTo) {
    const assignedUser = await User.findById(req.body.assignedTo);
    if (assignedUser) {
      followUp.createdBy = assignedUser._id;
      followUp.createdByName = assignedUser.name;
    }
  }

  Object.assign(followUp, req.body);
  await followUp.save();

  res.json({ success: true, followUp });
});

// @desc    Delete a follow-up
// @route   DELETE /api/followups/:id
// @access  Private
const deleteFollowUp = asyncHandler(async (req, res) => {
  const followUp = await FollowUp.findById(req.params.id);

  if (!followUp) {
    res.status(404);
    throw new Error('Follow-up not found');
  }

  if (req.user.role !== 'admin' && String(followUp.createdBy) !== String(req.user._id)) {
    res.status(403);
    throw new Error('You can only delete follow-ups you created');
  }

  await followUp.deleteOne();
  res.json({ success: true, message: 'Follow-up deleted successfully' });
});

module.exports = { createFollowUp, getFollowUps, getTodayFollowUps, updateFollowUp, deleteFollowUp };
