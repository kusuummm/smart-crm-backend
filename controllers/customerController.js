const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const CallHistory = require('../models/CallHistory');
const { escapeRegex } = require('../utils/regexHelper');

// Standard users only see customers assigned to them; admins see everything.
const scopeToRole = (req, filter = {}) => {
  if (req.user.role !== 'admin') {
    filter.$or = [
      { telecallerId: req.user._id },
      { assignedTelecaller: req.user.name },
    ];
  }
  return filter;
};

const sanitizeCustomerPayload = (payload) => {
  const cleaned = { ...payload };
  if (cleaned.telecallerId === '') delete cleaned.telecallerId;
  if (cleaned.leadSource === '') delete cleaned.leadSource;
  return cleaned;
};

// @desc    Create a customer
// @route   POST /api/customers
// @access  Private
const createCustomer = asyncHandler(async (req, res) => {
  const { name, mobile } = req.body;
  if (!name || !mobile) {
    res.status(400);
    throw new Error('Customer name and mobile number are required');
  }

  const payload = sanitizeCustomerPayload(req.body);

  if (req.user.role !== 'admin') {
    payload.telecallerId = req.user._id;
    payload.assignedTelecaller = req.user.name;
  } else if (payload.telecallerId) {
    const tc = await User.findById(payload.telecallerId);
    if (tc) payload.assignedTelecaller = tc.name;
  }

  const customer = await Customer.create(payload);

  await Lead.create({
    customerId: customer._id,
    customerName: customer.name,
    status: 'new',
    telecallerId: customer.telecallerId || null,
    history: [{ status: 'new', date: new Date(), remark: 'Lead created', updatedBy: req.user._id }],
  });

  res.status(201).json({ success: true, customer });
});

// @desc    Get customers with search, filter, sorting, pagination
// @route   GET /api/customers
// @access  Private
const getCustomers = asyncHandler(async (req, res) => {
  const {
    search,
    city,
    source,
    status,
    telecallerId,
    assignedTelecaller,
    unassigned,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const conditions = [];

  if (req.user.role !== 'admin') {
    conditions.push({
      $or: [
        { telecallerId: req.user._id },
        { assignedTelecaller: req.user.name },
      ],
    });
  } else {
    // Admin filtering controls
    if (unassigned === 'true' || telecallerId === 'unassigned') {
      conditions.push({
        $or: [
          { telecallerId: null },
          { telecallerId: { $exists: false } },
          { assignedTelecaller: 'Unassigned' },
          { assignedTelecaller: '' },
          { assignedTelecaller: null },
        ],
      });
    } else if (telecallerId) {
      conditions.push({ telecallerId });
    } else if (assignedTelecaller) {
      conditions.push({ assignedTelecaller });
    }
  }

  if (city) conditions.push({ city: new RegExp(escapeRegex(city.trim()), 'i') });
  if (source) conditions.push({ leadSource: source });
  if (status) conditions.push({ status });

  if (search) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i');
    conditions.push({
      $or: [{ name: regex }, { mobile: regex }, { email: regex }, { company: regex }, { city: regex }],
    });
  }

  const filter = conditions.length > 0 ? { $and: conditions } : {};

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .sort(sort)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Customer.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: customers.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    customers,
  });
});

// @desc    Get single customer
// @route   GET /api/customers/:id
// @access  Private
const getCustomerById = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const customer = await Customer.findOne(filter);

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found or not assigned to your account');
  }
  res.json({ success: true, customer });
});

// @desc    Update a customer
// @route   PUT /api/customers/:id
// @access  Private
const updateCustomer = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const customer = await Customer.findOne(filter);

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found or not assigned to your account');
  }

  const updates = sanitizeCustomerPayload(req.body);

  if (req.user.role !== 'admin') {
    delete updates.telecallerId;
    delete updates.assignedTelecaller;
  } else if (updates.telecallerId) {
    const tc = await User.findById(updates.telecallerId);
    if (tc) updates.assignedTelecaller = tc.name;
    await Lead.updateMany({ customerId: customer._id }, { telecallerId: updates.telecallerId });
  } else if (updates.telecallerId === null || req.body.unassign === true) {
    updates.telecallerId = null;
    updates.assignedTelecaller = 'Unassigned';
    await Lead.updateMany({ customerId: customer._id }, { telecallerId: null });
  }

  Object.assign(customer, updates);
  await customer.save();

  res.json({ success: true, customer });
});

// @desc    Delete a customer
// @route   DELETE /api/customers/:id
// @access  Private/Admin
const deleteCustomer = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Only administrators can delete customer records');
  }

  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  await customer.deleteOne();
  await Promise.all([
    Lead.deleteMany({ customerId: customer._id }),
    FollowUp.deleteMany({ customerId: customer._id }),
    CallHistory.deleteMany({ customerId: customer._id }),
  ]);
  res.json({ success: true, message: 'Customer and associated records deleted successfully' });
});

// @desc    Bulk assign multiple customers
// @route   POST /api/customers/bulk-assign
// @access  Private/Admin
const bulkAssignCustomers = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Only administrators can bulk assign customers');
  }

  const { customerIds, telecallerId } = req.body;

  if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
    res.status(400);
    throw new Error('customerIds array is required');
  }

  let assignedTelecaller = 'Unassigned';
  let targetUserId = null;

  if (telecallerId && telecallerId !== 'unassigned') {
    const targetUser = await User.findById(telecallerId);
    if (!targetUser) {
      res.status(404);
      throw new Error('Target telecaller user not found');
    }
    assignedTelecaller = targetUser.name;
    targetUserId = targetUser._id;
  }

  const [customerResult, leadResult] = await Promise.all([
    Customer.updateMany(
      { _id: { $in: customerIds } },
      { $set: { telecallerId: targetUserId, assignedTelecaller } }
    ),
    Lead.updateMany(
      { customerId: { $in: customerIds } },
      { $set: { telecallerId: targetUserId } }
    ),
  ]);

  res.json({
    success: true,
    message: `Assigned ${customerResult.modifiedCount} customer(s) to ${assignedTelecaller}`,
    modifiedCustomers: customerResult.modifiedCount,
    modifiedLeads: leadResult.modifiedCount,
  });
});

// @desc    Bulk delete multiple customers
// @route   POST /api/customers/bulk-delete
// @access  Private/Admin
const bulkDeleteCustomers = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Only administrators can bulk delete customers');
  }

  const { customerIds } = req.body;

  if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
    res.status(400);
    throw new Error('customerIds array is required');
  }

  const [customerResult] = await Promise.all([
    Customer.deleteMany({ _id: { $in: customerIds } }),
    Lead.deleteMany({ customerId: { $in: customerIds } }),
    FollowUp.deleteMany({ customerId: { $in: customerIds } }),
    CallHistory.deleteMany({ customerId: { $in: customerIds } }),
  ]);

  res.json({
    success: true,
    message: `Successfully deleted ${customerResult.deletedCount} customer(s) and associated records`,
    deletedCount: customerResult.deletedCount,
  });
});

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  bulkAssignCustomers,
  bulkDeleteCustomers,
};
