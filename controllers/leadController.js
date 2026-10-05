const asyncHandler = require('express-async-handler');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const { escapeRegex } = require('../utils/regexHelper');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
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

  if (req.user.role === 'telecaller') {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('You can only create leads for customers assigned to you');
    }
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
  const conditions = [];

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    conditions.push({
      $or: [
        { telecallerId: req.user._id },
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
      conditions.push({
        $or: [
          { telecallerId: null },
          { telecallerId: { $exists: false } },
          { customerId: { $in: unassignedCustIds } },
        ],
      });
    } else {
      const customerIds = await Customer.find({
        $or: [{ telecallerId: req.query.telecallerId }],
      }).distinct('_id');
      conditions.push({
        $or: [
          { telecallerId: req.query.telecallerId },
          { customerId: { $in: customerIds } },
        ],
      });
    }
  }

  if (status) conditions.push({ status });
  if (search) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i');
    conditions.push({ customerName: regex });
  }

  const filter = conditions.length > 0 ? { $and: conditions } : {};

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
  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    const isOwner = (lead.telecallerId && String(lead.telecallerId) === String(req.user._id)) ||
                    customerIds.some(id => String(id) === String(lead.customerId));
    if (!isOwner) {
      res.status(403);
      throw new Error('Access denied to lead not assigned to your accounts');
    }
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

  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    const isOwner = (lead.telecallerId && String(lead.telecallerId) === String(req.user._id)) ||
                    customerIds.some(id => String(id) === String(lead.customerId));
    if (!isOwner) {
      res.status(403);
      throw new Error('Access denied to lead not assigned to your accounts');
    }
  }

  lead.status = status;
  if (req.user.role === 'admin' && req.body.telecallerId !== undefined) {
    lead.telecallerId = req.body.telecallerId ? req.body.telecallerId : null;
  }
  lead.history.push({ status, date: new Date(), remark: remark || '', updatedBy: req.user._id });
  await lead.save();

  res.json({ success: true, lead });
});

// @desc    Delete a lead
// @route   DELETE /api/leads/:id
// @access  Private/Admin
const deleteLead = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Only administrators can delete leads');
  }

  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  await lead.deleteOne();
  res.json({ success: true, message: 'Lead deleted successfully' });
});

module.exports = { createLead, getLeads, getLeadById, updateLeadStatus, deleteLead };
