const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const FollowUp = require('../models/FollowUp');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { sendFollowUpScheduleEmails } = require('../services/followUpEmailService');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// @desc    Create a follow-up
// @route   POST /api/followups
// @access  Private
const createFollowUp = asyncHandler(async (req, res) => {
  const { customerId, date, time, remarks, nextFollowUp, assignedTo, customerName, phone, type } = req.body;

  if (!date || !time) {
    res.status(400);
    throw new Error('date and time are required');
  }

  let customer = null;
  if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
    customer = await Customer.findById(customerId);
  }

  if (!customer && (phone || customerName)) {
    const targetPhone = phone || '';
    const cleanPhone = String(targetPhone).replace(/\D/g, '').slice(-10);
    if (targetPhone) {
      customer = await Customer.findOne({
        $or: [
          { mobile: targetPhone },
          { phone: targetPhone },
          { alternateNumber: targetPhone },
          ...(cleanPhone ? [{ mobile: new RegExp(cleanPhone + '$') }, { phone: new RegExp(cleanPhone + '$') }] : []),
        ],
      });
    }
    if (!customer) {
      customer = await Customer.create({
        name: customerName || 'Customer',
        mobile: targetPhone || '0000000000',
        phone: targetPhone || '0000000000',
        telecallerId: req.user._id,
        assignedTelecaller: req.user.name,
        status: 'customer',
      });
    }
  }

  if (!customer) {
    res.status(400);
    throw new Error('Valid customerId or customer details (phone, customerName) are required');
  }

  if (req.user.role === 'telecaller') {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned && customerId) {
      res.status(403);
      throw new Error('You can only schedule follow-ups for customers assigned to you');
    }
  }

  let createdBy = req.user._id;
  let createdByName = req.user.name;
  let targetAssignedTo = req.user._id;
  let targetAssignedToName = req.user.name;

  if (assignedTo) {
    const assignedUser = await User.findById(assignedTo);
    if (assignedUser) {
      targetAssignedTo = assignedUser._id;
      targetAssignedToName = assignedUser.name;
      createdBy = assignedUser._id;
      createdByName = assignedUser.name;
    }
  }

  const followUp = await FollowUp.create({
    customerId: customer._id,
    customerName: customer.name,
    phone: phone || customer.mobile || customer.phone || '',
    type: type || 'CALL',
    date,
    time,
    remarks: remarks || '',
    nextFollowUp: nextFollowUp || '',
    status: 'pending',
    createdBy,
    createdByName,
    assignedTo: targetAssignedTo,
    assignedToName: targetAssignedToName,
    priority: req.body.priority || 'medium',
  });

  // Send email to both customer and telecaller
  sendFollowUpScheduleEmails({ followUp, actionType: 'scheduled', updatedByUser: req.user })
    .catch((err) => console.error('[createFollowUp] Email error:', err.message));

  res.status(201).json({ success: true, followUp });
});

// @desc    Get follow-ups (filter by status/date, pagination)
// @route   GET /api/followups?status=&date=&page=1&limit=10&telecallerId=&customerId=&phone=
// @access  Private
const getFollowUps = asyncHandler(async (req, res) => {
  const { status, date, page = 1, limit = 10, telecallerId, customerId, phone } = req.query;
  const conditions = [];

  if (req.user.role === 'telecaller') {
    conditions.push({
      $or: [
        { createdBy: req.user._id },
        { createdByName: req.user.name },
        { assignedTo: req.user._id },
      ],
    });
  } else if (req.user.role === 'admin' && telecallerId && telecallerId !== 'all') {
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
      conditions.push({
        $or: [
          { createdBy: telecallerId },
          { assignedTo: telecallerId },
        ],
      });
    }
  }

  if (status) conditions.push({ status });
  if (date) conditions.push({ date });
  if (customerId && mongoose.Types.ObjectId.isValid(customerId)) conditions.push({ customerId });
  if (phone) {
    const cleanP = String(phone).replace(/\D/g, '').slice(-10);
    conditions.push({
      $or: [
        { phone },
        ...(cleanP ? [{ phone: new RegExp(cleanP + '$') }] : []),
      ],
    });
  }

  const filter = conditions.length > 0 ? { $and: conditions } : {};

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const [followUps, total] = await Promise.all([
    FollowUp.find(filter)
      .populate('customerId', 'name mobile phone email company city')
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

  if (req.body.assignedTo) {
    const assignedUser = await User.findById(req.body.assignedTo);
    if (assignedUser) {
      followUp.createdBy = assignedUser._id;
      followUp.createdByName = assignedUser.name;
      followUp.assignedTo = assignedUser._id;
      followUp.assignedToName = assignedUser.name;
    }
  }

  Object.assign(followUp, req.body);
  await followUp.save();

  // Send email to both customer and telecaller on update/reschedule
  sendFollowUpScheduleEmails({ followUp, actionType: 'rescheduled', updatedByUser: req.user })
    .catch((err) => console.error('[updateFollowUp] Email error:', err.message));

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
