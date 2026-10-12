const asyncHandler = require('express-async-handler');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const { escapeRegex } = require('../utils/regexHelper');
const { sendFollowUpStatusChangeEmails } = require('../services/followUpEmailService');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// @desc    Assign customer to lead pipeline (ADMIN ONLY)
// @route   POST /api/leads
// @access  Private/Admin
const createLead = asyncHandler(async (req, res) => {
  // STRICT RULE: Only administrators can assign customers to leads
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Only administrators can assign a customer to a lead');
  }

  const { customerId, telecallerId, status = 'new', remark } = req.body;

  if (!customerId) {
    res.status(400);
    throw new Error('Customer ID is required to assign to lead pipeline');
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  // Check if lead already exists for this customer
  let existingLead = await Lead.findOne({ customerId });
  if (existingLead) {
    // If already exists, update status and assigned telecaller instead of duplicating
    existingLead.status = status;
    if (telecallerId !== undefined) {
      existingLead.telecallerId = telecallerId || null;
    }
    existingLead.history.push({
      status,
      date: new Date(),
      remark: remark || 'Lead reassigned/updated by Admin',
      updatedBy: req.user._id,
    });
    await existingLead.save();

    const populatedLead = await Lead.findById(existingLead._id)
      .populate('customerId', 'name mobile alternateNumber email company city status leadSource');

    // Send email to both customer and telecaller on follow-up update
    sendFollowUpStatusChangeEmails({
      lead: populatedLead,
      newStatus: status,
      remark: remark || 'Lead reassigned/updated by Admin',
      updatedByUser: req.user,
    }).catch((err) => console.error('[createLead/existing] Email error:', err.message));

    return res.status(200).json({ success: true, lead: populatedLead, message: 'Existing lead updated' });
  }

  const assignedTelecallerId = telecallerId || customer.telecallerId || null;

  const lead = await Lead.create({
    customerId,
    customerName: customer.name,
    status,
    telecallerId: assignedTelecallerId,
    history: [
      {
        status,
        date: new Date(),
        remark: remark || 'Customer assigned to lead pipeline by Admin',
        updatedBy: req.user._id,
      },
    ],
  });

  const populatedLead = await Lead.findById(lead._id)
    .populate('customerId', 'name mobile alternateNumber email company city status leadSource');

  // If customer didn't have telecaller assigned, update customer record too
  if (assignedTelecallerId && !customer.telecallerId) {
    customer.telecallerId = assignedTelecallerId;
    await customer.save().catch(() => {});
  }

  // Send automated email notification to both customer and lead/telecaller
  sendFollowUpStatusChangeEmails({
    lead: populatedLead,
    newStatus: status,
    remark: remark || 'Customer assigned to lead pipeline by Admin',
    updatedByUser: req.user,
  }).catch((err) => console.error('[createLead] Email dispatch error:', err.message));

  res.status(201).json({ success: true, lead: populatedLead });
});

// @desc    Get leads (filter by status, customer name search, pagination)
// @route   GET /api/leads?status=&search=&page=1&limit=10
// @access  Private
const getLeads = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 10 } = req.query;
  const conditions = [];

  if (req.user.role === 'telecaller') {
    // Caller strictly gets only their own assigned leads
    conditions.push({ telecallerId: req.user._id });
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
      .populate('customerId', 'name mobile alternateNumber email company city status leadSource')
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
  const lead = await Lead.findById(req.params.id)
    .populate('customerId', 'name mobile alternateNumber email company city status leadSource');

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  if (req.user.role === 'telecaller') {
    const customerIds = await getTelecallerCustomerIds(req.user);
    const isOwner = (lead.telecallerId && String(lead.telecallerId) === String(req.user._id)) ||
                    customerIds.some(id => String(id) === String(lead.customerId?._id || lead.customerId));
    if (!isOwner) {
      res.status(403);
      throw new Error('Access denied to lead not assigned to your accounts');
    }
  }

  res.json({ success: true, lead });
});

// @desc    Update lead follow-up status - appends to history & dispatches email to both lead and customer
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

  const populatedLead = await Lead.findById(lead._id)
    .populate('customerId', 'name mobile alternateNumber email company city status leadSource');

  // Trigger emails to both lead and customer whenever follow-up status changes
  const emailResult = await sendFollowUpStatusChangeEmails({
    lead: populatedLead,
    newStatus: status,
    remark: remark || '',
    updatedByUser: req.user,
  });

  res.json({ success: true, lead: populatedLead, emailResult });
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
