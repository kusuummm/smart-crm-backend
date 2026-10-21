const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const CallHistory = require('../models/CallHistory');
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
  } else {
    // Admin CANNOT access contacts assigned to callers! Admin only sees unassigned contacts for assignment.
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

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  bulkAssignCustomers,
  bulkDeleteCustomers,
};
