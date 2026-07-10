const asyncHandler = require('express-async-handler');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');

const scopeToRole = (req, filter = {}) => {
  if (req.user.role === 'telecaller') {
    filter.telecallerId = req.user._id;
  }
  return filter;
};

// @desc    Create a lead for a customer
// @route   POST /api/leads
// @access  Private
const createLead = asyncHandler(async (req, res) => {
  const { customerId, remark } = req.body;

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const lead = await Lead.create({
    customerId,
    customerName: customer.name,
    status: 'new',
    telecallerId: req.user.role === 'telecaller' ? req.user._id : req.body.telecallerId || customer.telecallerId,
    history: [{ status: 'new', date: new Date(), remark: remark || 'Lead created', updatedBy: req.user._id }],
  });

  res.status(201).json({ success: true, lead });
});

// @desc    Get leads (filter by status, customer name search, pagination)
// @route   GET /api/leads?status=&search=&page=1&limit=10
// @access  Private
const getLeads = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 10 } = req.query;
  const filter = scopeToRole(req);

  if (status) filter.status = status;
  if (search) filter.customerName = new RegExp(search, 'i');

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Lead.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: leads.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    leads,
  });
});

// @desc    Get a single lead with full history
// @route   GET /api/leads/:id
// @access  Private
const getLeadById = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const lead = await Lead.findOne(filter);

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }
  res.json({ success: true, lead });
});

// @desc    Update lead status - appends to history, never overwrites it
// @route   PUT /api/leads/:id/status
// @access  Private
const updateLeadStatus = asyncHandler(async (req, res) => {
  const { status, remark } = req.body;
  if (!status) {
    res.status(400);
    throw new Error('Status is required');
  }

  const filter = scopeToRole(req, { _id: req.params.id });
  const lead = await Lead.findOne(filter);

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  lead.status = status;
  lead.history.push({ status, date: new Date(), remark: remark || '', updatedBy: req.user._id });
  await lead.save();

  res.json({ success: true, lead });
});

// @desc    Delete a lead
// @route   DELETE /api/leads/:id
// @access  Private
const deleteLead = asyncHandler(async (req, res) => {
  const filter = scopeToRole(req, { _id: req.params.id });
  const lead = await Lead.findOne(filter);

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  await lead.deleteOne();
  res.json({ success: true, message: 'Lead deleted successfully' });
});

module.exports = { createLead, getLeads, getLeadById, updateLeadStatus, deleteLead };
