const asyncHandler = require('express-async-handler');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { escapeRegex } = require('../utils/regexHelper');
const { sendFollowUpStatusChangeEmails, sendNewCustomerLeadEmails } = require('../services/followUpEmailService');

const getTelecallerCustomerIds = async (user) => {
  return await Customer.find({
    $or: [{ telecallerId: user._id }, { assignedTelecaller: user.name }],
  }).distinct('_id');
};

// @desc    Assign customer to lead pipeline
// @route   POST /api/leads
// @access  Private
const createLead = asyncHandler(async (req, res) => {
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

  let assignedTelecallerId;
  if (req.user.role === 'telecaller') {
    assignedTelecallerId = req.user._id;
  } else {
    assignedTelecallerId = telecallerId || customer.telecallerId || null;
  }

  // Check if lead already exists for this customer
  let existingLead = await Lead.findOne({ customerId });
  if (existingLead) {
    // If already exists, update status and assigned telecaller instead of duplicating
    existingLead.status = status;
    if (assignedTelecallerId !== undefined) {
      existingLead.telecallerId = assignedTelecallerId || null;
    }
    existingLead.history.push({
      status,
      date: new Date(),
      remark: remark || `Lead updated/assigned by ${req.user.name || 'User'}`,
      updatedBy: req.user._id,
    });
    await existingLead.save();

    const populatedLead = await Lead.findById(existingLead._id)
      .populate('customerId', 'name mobile alternateNumber email company city status leadSource');

    // Send email to both customer and lead owner
    sendNewCustomerLeadEmails({
      customer,
      lead: populatedLead,
      remark: remark || `Lead updated/assigned by ${req.user.name || 'User'}`,
      updatedByUser: req.user,
    }).catch((err) => console.error('[createLead/existing] Email error:', err.message));

    return res.status(200).json({ success: true, lead: populatedLead, message: 'Existing lead updated' });
  }

  const lead = await Lead.create({
    customerId,
    customerName: customer.name,
    status,
    telecallerId: assignedTelecallerId,
    history: [
      {
        status,
        date: new Date(),
        remark: remark || `Customer assigned to lead pipeline by ${req.user.name || 'User'}`,
        updatedBy: req.user._id,
      },
    ],
  });

  const populatedLead = await Lead.findById(lead._id)
    .populate('customerId', 'name mobile alternateNumber email company city status leadSource');

  // If customer didn't have telecaller assigned, update customer record too
  if (assignedTelecallerId && !customer.telecallerId) {
    customer.telecallerId = assignedTelecallerId;
    if (req.user.role === 'telecaller') {
      customer.assignedTelecaller = req.user.name;
    }
    await customer.save().catch(() => {});
  }

  // Send automated email notification to both customer and lead/telecaller
  sendNewCustomerLeadEmails({
    customer,
    lead: populatedLead,
    remark: remark || `Customer assigned to lead pipeline by ${req.user.name || 'User'}`,
    updatedByUser: req.user,
  }).catch((err) => console.error('[createLead] Email dispatch error:', err.message));

  res.status(201).json({ success: true, lead: populatedLead });
});

// @desc    Get leads (filter by status, customer name search, pagination)
// @route   GET /api/leads?status=&search=&page=1&limit=10
// @access  Private
const getLeads = asyncHandler(async (req, res) => {
  const { status, search, telecallerId, page = 1, limit = 10 } = req.query;
  const conditions = [];

  if (req.user.role !== 'admin') {
    // Caller strictly gets only their own assigned leads
    conditions.push({ telecallerId: req.user._id });
  } else if (telecallerId && telecallerId !== 'all') {
    if (telecallerId === 'unassigned') {
      conditions.push({
        $or: [{ telecallerId: null }, { telecallerId: { $exists: false } }],
      });
    } else {
      conditions.push({ telecallerId });
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

  if (req.user.role !== 'admin') {
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

  if (req.user.role !== 'admin') {
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

  // Keep Customer status synchronized with Lead stage
  if (lead.customerId) {
    await Customer.findByIdAndUpdate(lead.customerId, { status }).catch(() => {});
  }

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
  res.json({ success: true, message: 'Lead removed' });
});

// @desc    High-performance chunked bulk import & assignment of leads from Excel/CSV (ADMIN ONLY)
// @route   POST /api/leads/bulk-import
// @access  Private/Admin
const bulkImportLeads = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Only administrators can import and assign leads');
  }

  const {
    batch = [],
    assignmentStrategy = 'unassigned', // 'round-robin' | 'direct' | 'unassigned'
    telecallerIds = [],
    skipDuplicates = true,
    batchName = '',
    roundRobinOffset = 0,
  } = req.body;

  if (!Array.isArray(batch) || batch.length === 0) {
    return res.json({
      success: true,
      processed: 0,
      imported: 0,
      duplicatesSkipped: 0,
      invalidCount: 0,
      callerBreakdown: {},
    });
  }

  // Load target telecallers if assigned
  let callers = [];
  if (['round-robin', 'direct'].includes(assignmentStrategy) && telecallerIds.length > 0) {
    callers = await User.find({
      _id: { $in: telecallerIds },
      isApproved: true,
      status: 'active',
    }).select('_id name email phone');
  }

  // 1. Sanitize & clean batch records
  const validRows = [];
  let invalidCount = 0;

  for (const row of batch) {
    const rawName = (row.name || row.customerName || '').toString().trim();
    let rawMobile = (row.mobile || row.phone || row.contactNumber || '').toString().replace(/\D/g, '');

    // Normalize Indian mobile numbers:
    // If 12 digits and starts with '91', strip '91'
    if (rawMobile.length === 12 && rawMobile.startsWith('91')) {
      rawMobile = rawMobile.substring(2);
    } else if (rawMobile.length === 11 && rawMobile.startsWith('0')) {
      rawMobile = rawMobile.substring(1);
    }

    if (!rawName || rawMobile.length < 10) {
      invalidCount++;
      continue;
    }

    // Keep standardized 10-digit mobile
    const cleanMobile = rawMobile.slice(-10);

    validRows.push({
      name: rawName,
      mobile: cleanMobile,
      alternateNumber: (row.alternateNumber || '').toString().trim(),
      email: (row.email || '').toString().trim().toLowerCase(),
      company: (row.company || '').toString().trim(),
      city: (row.city || '').toString().trim(),
      state: (row.state || '').toString().trim(),
      leadSource: row.leadSource || 'Other',
      interestedProduct: (row.interestedProduct || row.product || '').toString().trim(),
      remarks: (row.remarks || row.notes || '').toString().trim(),
    });
  }

  if (validRows.length === 0) {
    return res.json({
      success: true,
      processed: batch.length,
      imported: 0,
      duplicatesSkipped: 0,
      invalidCount,
      callerBreakdown: {},
    });
  }

  // 2. In-batch deduplication (first occurrence wins)
  const uniqueInBatch = [];
  const seenMobiles = new Set();
  let inBatchDuplicates = 0;

  for (const row of validRows) {
    if (seenMobiles.has(row.mobile)) {
      inBatchDuplicates++;
      continue;
    }
    seenMobiles.add(row.mobile);
    uniqueInBatch.push(row);
  }

  // 3. Database deduplication against existing customers
  let rowsToInsert = uniqueInBatch;
  let dbDuplicatesCount = 0;

  if (skipDuplicates) {
    const allMobiles = uniqueInBatch.map((r) => r.mobile);
    const existingCustomers = await Customer.find({ mobile: { $in: allMobiles } }).select('mobile');
    const existingMobileSet = new Set(existingCustomers.map((c) => c.mobile));

    rowsToInsert = uniqueInBatch.filter((r) => {
      if (existingMobileSet.has(r.mobile)) {
        dbDuplicatesCount++;
        return false;
      }
      return true;
    });
  }

  const totalDuplicatesSkipped = inBatchDuplicates + dbDuplicatesCount;

  if (rowsToInsert.length === 0) {
    return res.json({
      success: true,
      processed: batch.length,
      imported: 0,
      duplicatesSkipped: totalDuplicatesSkipped,
      invalidCount,
      callerBreakdown: {},
    });
  }

  // 4. Assign telecallers according to selected strategy
  const callerBreakdown = {};
  const customerDocs = [];

  for (let i = 0; i < rowsToInsert.length; i++) {
    const row = rowsToInsert[i];
    let assignedCaller = null;

    if (assignmentStrategy === 'round-robin' && callers.length > 0) {
      const idx = (roundRobinOffset + i) % callers.length;
      assignedCaller = callers[idx];
    } else if (assignmentStrategy === 'direct' && callers.length > 0) {
      assignedCaller = callers[0];
    }

    if (assignedCaller) {
      callerBreakdown[assignedCaller.name] = (callerBreakdown[assignedCaller.name] || 0) + 1;
    } else {
      callerBreakdown['Unassigned'] = (callerBreakdown['Unassigned'] || 0) + 1;
    }

    customerDocs.push({
      name: row.name,
      mobile: row.mobile,
      alternateNumber: row.alternateNumber,
      email: row.email,
      company: row.company,
      city: row.city,
      state: row.state,
      leadSource: row.leadSource,
      interestedProduct: row.interestedProduct,
      status: 'active',
      assignedTelecaller: assignedCaller ? assignedCaller.name : 'Unassigned',
      telecallerId: assignedCaller ? assignedCaller._id : null,
      remarks: row.remarks || (batchName ? `Imported: ${batchName}` : 'Excel Import'),
    });
  }

  // 5. High-speed bulk insertion of Customers
  const createdCustomers = await Customer.insertMany(customerDocs, { ordered: false });

  // 6. Automatically generate corresponding Lead pipeline documents
  const leadDocs = createdCustomers.map((c) => ({
    customerId: c._id,
    customerName: c.name,
    status: 'new',
    telecallerId: c.telecallerId,
    history: [
      {
        status: 'new',
        date: new Date(),
        remark: batchName ? `Imported via batch: ${batchName}` : 'Imported via Excel spreadsheet',
        updatedBy: req.user._id,
      },
    ],
  }));

  if (leadDocs.length > 0) {
    await Lead.insertMany(leadDocs, { ordered: false });
  }

  res.json({
    success: true,
    processed: batch.length,
    imported: createdCustomers.length,
    duplicatesSkipped: totalDuplicatesSkipped,
    invalidCount,
    callerBreakdown,
  });
});

module.exports = { createLead, getLeads, getLeadById, updateLeadStatus, deleteLead, bulkImportLeads };
