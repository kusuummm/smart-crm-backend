const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const CallHistory = require('../models/CallHistory');
const WhatsAppLog = require('../models/WhatsAppLog');
const EmailLog = require('../models/EmailLog');
const Note = require('../models/Note');
const Application = require('../models/Application');
const { escapeRegex } = require('../utils/regexHelper');
const { sendNewCustomerLeadEmails } = require('../services/followUpEmailService');

const isAdminOrOwner = (user) => {
  const r = (user?.role || '').toLowerCase();
  return r === 'admin' || r === 'owner';
};

const isManagerOrAbove = (user) => {
  const r = (user?.role || '').toLowerCase();
  return r === 'admin' || r === 'owner' || r === 'manager';
};

// Strict Data Isolation:
// - Callers can ONLY see contacts assigned to their account. Callers cannot see other callers' contacts.
// - Admin/Owner CANNOT access contacts assigned to callers! Admin/Owner can only see unassigned contacts for distribution.
const scopeToRole = (req, filter = {}) => {
  if (!isAdminOrOwner(req.user)) {
    filter.$or = [
      { telecallerId: req.user._id },
      { assignedTelecaller: req.user.name },
    ];
  } else {
    // Admin/Owner cannot access contacts assigned to callers
    filter.$or = [
      { telecallerId: null },
      { telecallerId: { $exists: false } },
      { assignedTelecaller: 'Unassigned' },
      { assignedTelecaller: '' },
      { assignedTelecaller: null },
    ];
  }
  return filter;
};

const sanitizeCustomerPayload = (payload) => {
  const cleaned = { ...payload };
  if (!cleaned.mobile && cleaned.phone) cleaned.mobile = cleaned.phone;
  if (cleaned.telecallerId === '') delete cleaned.telecallerId;
  if (cleaned.leadSource === '') delete cleaned.leadSource;
  return cleaned;
};

// @desc    Create a customer
// @route   POST /api/customers
// @access  Private
const createCustomer = asyncHandler(async (req, res) => {
  const name = req.body.name;
  const mobile = req.body.mobile || req.body.phone;
  if (!name || !mobile) {
    res.status(400);
    throw new Error('Customer name and mobile number are required');
  }

  const payload = sanitizeCustomerPayload({ ...req.body, mobile });

  if (!isAdminOrOwner(req.user)) {
    payload.telecallerId = req.user._id;
    payload.assignedTelecaller = req.user.name;
  } else if (payload.telecallerId) {
    const tc = await User.findById(payload.telecallerId);
    if (tc) payload.assignedTelecaller = tc.name;
  }

  const customer = await Customer.create(payload);

  const lead = await Lead.create({
    customerId: customer._id,
    customerName: customer.name,
    status: 'new',
    telecallerId: customer.telecallerId || null,
    history: [{ status: 'new', date: new Date(), remark: 'Lead created', updatedBy: req.user._id }],
  });

  // Automatically dispatch notification emails to both Customer and Lead Owner
  sendNewCustomerLeadEmails({
    customer,
    lead,
    remark: payload.remarks || payload.remark || 'New customer registered and added to lead pipeline',
    updatedByUser: req.user,
  }).catch((err) => {
    console.error('[createCustomer] Error dispatching new customer lead emails:', err.message);
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
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const conditions = [];

  if (!isAdminOrOwner(req.user)) {
    // Telecaller / Member can ONLY access their own assigned contacts
    conditions.push({
      $or: [
        { telecallerId: req.user._id },
        { assignedTelecaller: req.user.name },
      ],
    });
  } else if (req.query.unassigned === 'true') {
    // Admin explicitly filtering for unassigned contacts
    conditions.push({
      $or: [
        { telecallerId: null },
        { telecallerId: { $exists: false } },
        { assignedTelecaller: 'Unassigned' },
        { assignedTelecaller: '' },
        { assignedTelecaller: null },
      ],
    });
  }

  if (city) conditions.push({ city: new RegExp(escapeRegex(city.trim()), 'i') });
  if (source) conditions.push({ leadSource: source });
  if (status) conditions.push({ status });

  if (search) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i');
    conditions.push({
      $or: [
        { name: regex },
        { mobile: regex },
        { phone: regex },
        { alternateNumber: regex },
        { email: regex },
        { company: regex },
        { city: regex },
      ],
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
      .limit(limitNum)
      .lean(),
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
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  if (isAdminOrOwner(req.user)) {
    const isAssigned = customer.telecallerId || (customer.assignedTelecaller && customer.assignedTelecaller !== 'Unassigned');
    if (isAssigned) {
      res.status(403);
      throw new Error('Access denied: Administrators cannot access contacts assigned to telecallers');
    }
  } else {
    const isAssignedToMe = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                           customer.assignedTelecaller === req.user.name;
    if (!isAssignedToMe) {
      res.status(403);
      throw new Error('Access denied: You can only access contacts assigned to your account');
    }
  }

  res.json({ success: true, customer });
});

// @desc    Update a customer
// @route   PUT /api/customers/:id
// @access  Private
const updateCustomer = asyncHandler(async (req, res) => {
  let customer;
  if (isAdminOrOwner(req.user)) {
    customer = await Customer.findById(req.params.id);
  } else {
    customer = await Customer.findOne({
      _id: req.params.id,
      $or: [
        { telecallerId: req.user._id },
        { assignedTelecaller: req.user.name },
      ],
    });
  }

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found or not assigned to your account');
  }

  const updates = sanitizeCustomerPayload(req.body);

  if (updates.telecallerId !== undefined || req.body.unassign === true) {
    if (updates.telecallerId && updates.telecallerId !== 'unassigned') {
      const tc = await User.findById(updates.telecallerId);
      if (tc) {
        updates.telecallerId = tc._id;
        updates.assignedTelecaller = tc.name;
      }
    } else {
      updates.telecallerId = null;
      updates.assignedTelecaller = 'Unassigned';
    }

    await Lead.updateMany(
      { customerId: customer._id },
      {
        $set: { telecallerId: updates.telecallerId },
        $push: {
          history: {
            status: updates.status || customer.status || 'new',
            date: new Date(),
            remark: `Assigned lead changed to ${updates.assignedTelecaller} by ${req.user.name || 'User'}`,
            updatedBy: req.user._id,
          },
        },
      }
    ).catch(() => {});
  }

  if (updates.status) {
    await Lead.updateMany(
      { customerId: customer._id },
      {
        $set: { status: updates.status },
        $push: {
          history: {
            status: updates.status,
            date: new Date(),
            remark: updates.remarks || updates.remark || `Status synced from customer update (${updates.status})`,
            updatedBy: req.user._id,
          },
        },
      }
    ).catch(() => {});
  }

  Object.assign(customer, updates);
  await customer.save();

  res.json({ success: true, customer });
});

// @desc    Delete a customer
// @route   DELETE /api/customers/:id
// @access  Private/Admin/Telecaller
const deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  // Non-admins can only delete their own assigned contacts
  if (!isAdminOrOwner(req.user)) {
    const isAssigned = (customer.telecallerId && String(customer.telecallerId) === String(req.user._id)) ||
                       customer.assignedTelecaller === req.user.name;
    if (!isAssigned) {
      res.status(403);
      throw new Error('Access denied: You can only delete contacts assigned to your account');
    }
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
// @access  Private/Admin/Manager
const bulkAssignCustomers = asyncHandler(async (req, res) => {
  if (!isManagerOrAbove(req.user)) {
    res.status(403);
    throw new Error('Only administrators and managers can bulk assign customers');
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
      throw new Error('Target lead agent user not found');
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
// @access  Private/Admin/Telecaller
const bulkDeleteCustomers = asyncHandler(async (req, res) => {
  const { customerIds } = req.body;

  if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
    res.status(400);
    throw new Error('customerIds array is required');
  }

  const deleteFilter = { _id: { $in: customerIds } };
  if (!isAdminOrOwner(req.user)) {
    deleteFilter.$or = [
      { telecallerId: req.user._id },
      { assignedTelecaller: req.user.name },
    ];
  }

  const matchingCustomers = await Customer.find(deleteFilter).select('_id').lean();
  const matchingIds = matchingCustomers.map((c) => c._id);

  if (matchingIds.length === 0) {
    return res.json({
      success: true,
      message: 'No matching authorized customer records found to delete',
      deletedCount: 0,
    });
  }

  const [customerResult] = await Promise.all([
    Customer.deleteMany({ _id: { $in: matchingIds } }),
    Lead.deleteMany({ customerId: { $in: matchingIds } }),
    FollowUp.deleteMany({ customerId: { $in: matchingIds } }),
    CallHistory.deleteMany({ customerId: { $in: matchingIds } }),
  ]);

  res.json({
    success: true,
    message: `Successfully deleted ${customerResult.deletedCount} customer(s) and associated records`,
    deletedCount: customerResult.deletedCount,
  });
});

// @desc    Get complete unified communication history for a customer
// @route   GET /api/customers/:id/communication-history
// @access  Private
const getCustomerCommunicationHistory = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const phoneNumbers = [customer.mobile, customer.phone, customer.alternateNumber].filter(Boolean);
  const emails = [customer.email].filter(Boolean);

  const [calls, whatsappLogs, emailLogs, notes, applications] = await Promise.all([
    CallHistory.find({
      $or: [{ customerId: customer._id }, { contactNumber: { $in: phoneNumbers } }],
    }).sort({ createdAt: -1 }),
    WhatsAppLog.find({
      $or: [{ customerId: customer._id }, { phone: { $in: phoneNumbers } }],
    }).sort({ createdAt: -1 }),
    EmailLog.find({
      $or: [{ customerId: customer._id }, { to: { $in: emails } }],
    }).sort({ createdAt: -1 }),
    Note.find({ customerId: customer._id }).sort({ createdAt: -1 }),
    Application.find({ customerId: customer._id }).sort({ createdAt: -1 }),
  ]);

  const timeline = [];

  calls.forEach((c) => {
    timeline.push({
      id: c._id,
      type: 'call',
      title: `Call (${c.callType || 'Outbound'})`,
      timestamp: c.createdAt,
      status: c.status,
      details: {
        duration: c.duration,
        caller: c.callerName || c.callerNumber,
        notes: c.notes,
        recordingUrl: c.recordingUrl,
      },
      actor: c.callerName || 'Agent',
    });
  });

  whatsappLogs.forEach((w) => {
    timeline.push({
      id: w._id,
      type: 'whatsapp',
      title: `WhatsApp Message (${w.type || 'Template'})`,
      timestamp: w.createdAt,
      status: w.status,
      details: {
        message: w.message,
        phone: w.phone,
        providerMessageId: w.providerMessageId,
      },
      actor: w.sentByName || 'System',
    });
  });

  emailLogs.forEach((e) => {
    timeline.push({
      id: e._id,
      type: 'email',
      title: `Email: ${e.subject || 'Follow-up Email'}`,
      timestamp: e.createdAt,
      status: e.status,
      details: {
        to: e.to,
        subject: e.subject,
        preview: e.bodySnippet,
      },
      actor: e.sentByName || 'System',
    });
  });

  notes.forEach((n) => {
    timeline.push({
      id: n._id,
      type: 'note',
      title: `Internal Note (${n.tag || 'General'})`,
      timestamp: n.createdAt,
      status: 'saved',
      details: {
        content: n.content,
      },
      actor: n.createdByName || 'Agent',
    });
  });

  applications.forEach((a) => {
    timeline.push({
      id: a._id,
      type: 'application',
      title: `Application ${a.applicationNumber} (${a.applicationType})`,
      timestamp: a.createdAt,
      status: a.status,
      details: {
        applicationNumber: a.applicationNumber,
        paymentStatus: a.paymentStatus,
        paymentAmount: a.paymentAmount,
        documentCount: a.documents?.length || 0,
        certificate: a.finalCertificate?.certificateNumber || null,
      },
      actor: a.assignedToName || 'Admin',
    });

    (a.history || []).forEach((h, idx) => {
      timeline.push({
        id: `${a._id}-h-${idx}`,
        type: 'application_event',
        title: `${a.applicationNumber}: ${h.action}`,
        timestamp: h.date,
        status: a.status,
        details: {
          notes: h.notes,
        },
        actor: h.performedByName || 'Admin',
      });
    });
  });

  timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({
    success: true,
    customer,
    timeline,
    counts: {
      calls: calls.length,
      whatsapp: whatsappLogs.length,
      emails: emailLogs.length,
      notes: notes.length,
      applications: applications.length,
      total: timeline.length,
    },
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
  getCustomerCommunicationHistory,
};
