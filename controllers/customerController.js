const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Lead = require('../models/Lead');

// Telecallers only see customers assigned to them; admins see everything.
const scopeToRole = (req, filter = {}) => {
  if (req.user.role === 'telecaller') {
    filter.telecallerId = req.user._id;
  }
  return filter;
};

// The frontend form leaves optional dropdowns (leadSource, telecallerId) as an
// empty string ('') until the user picks a value. An empty string is not a
// valid ObjectId and not a valid enum value, so sending it straight to
// Mongoose throws a ValidationError and the customer never gets saved.
// Strip those out here so "left blank" is treated as "not set" and the
// schema defaults (Other / null) kick in instead.
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

  // If a telecaller is creating the customer, auto-assign to themselves.
  if (req.user.role === 'telecaller') {
    payload.telecallerId = req.user._id;
    payload.assignedTelecaller = req.user.name;
  } else if (payload.telecallerId) {
    const tc = await User.findById(payload.telecallerId);
    if (tc) payload.assignedTelecaller = tc.name;
  }

  const customer = await Customer.create(payload);

  // Every new customer starts a lead in the pipeline (status 'new'), so the
  // Leads module always has something to track without a separate manual step.
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
// @route   GET /api/customers?search=&city=&source=&status=&page=1&limit=10&sortBy=name&sortOrder=asc
// @access  Private
const getCustomers = asyncHandler(async (req, res) => {
  const { search, city, source, status, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

  const filter = scopeToRole(req);

  if (city) filter.city = new RegExp(city, 'i');
  if (source) filter.leadSource = source;
  if (status) filter.status = status;

  if (search) {
    const regex = new RegExp(search, 'i');
    filter.$or = [{ name: regex }, { mobile: regex }, { email: regex }, { company: regex }, { city: regex }];
  }

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
    throw new Error('Customer not found');
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
    throw new Error('Customer not found');
  }

  const updates = sanitizeCustomerPayload(req.body);

  // If admin reassigns the telecaller, keep the denormalized name in sync.
  if (updates.telecallerId) {
    const tc = await User.findById(updates.telecallerId);
    if (tc) updates.assignedTelecaller = tc.name;
  }

  Object.assign(customer, updates);
  await customer.save();

  res.json({ success: true, customer });
});

// @desc    Delete a customer
// @route   DELETE /api/customers/:id
// @access  Private
const deleteCustomer = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const customer = await Customer.findOne(filter);

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  await customer.deleteOne();
  res.json({ success: true, message: 'Customer deleted successfully' });
});

module.exports = { createCustomer, getCustomers, getCustomerById, updateCustomer, deleteCustomer };
