const emailNotificationService = require('../services/emailNotificationService');
const asyncHandler = require('express-async-handler');
const path = require('path');
const fs = require('fs');
const Application = require('../models/Application');
const Customer = require('../models/Customer');

// Helper to generate application number
const generateApplicationNumber = async () => {
  const year = new Date().getFullYear();
  const count = await Application.countDocuments();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `APP-${year}-${String(count + 1).padStart(4, '0')}-${randomSuffix}`;
};

// @desc    Get Admin Panel Application & Customer Statistics
// @route   GET /api/applications/stats
// @access  Private (Admin / Manager)
const getStats = asyncHandler(async (req, res) => {
  const [
    totalCustomers,
    totalApplications,
    newApplications,
    pendingDocuments,
    documentsUnderReview,
    approvedApplications,
    rejectedApplications,
    resubmissionRequired,
    paymentPending,
    paymentCompleted,
  ] = await Promise.all([
    Customer.countDocuments(),
    Application.countDocuments(),
    Application.countDocuments({ status: 'new' }),
    Application.countDocuments({ status: 'pending_documents' }),
    Application.countDocuments({ status: 'under_review' }),
    Application.countDocuments({ status: 'approved' }),
    Application.countDocuments({ status: 'rejected' }),
    Application.countDocuments({ status: 'resubmission_required' }),
    Application.countDocuments({ paymentStatus: 'pending' }),
    Application.countDocuments({ paymentStatus: 'completed' }),
  ]);

  res.json({
    success: true,
    stats: {
      totalCustomers,
      totalApplications,
      newApplications,
      pendingDocuments,
      documentsUnderReview,
      approvedApplications,
      rejectedApplications,
      resubmissionRequired,
      rejectedOrResubmission: rejectedApplications + resubmissionRequired,
      paymentPending,
      paymentCompleted,
    },
  });
});

// @desc    Get Applications list with filtering and search
// @route   GET /api/applications
// @access  Private
const getApplications = asyncHandler(async (req, res) => {
  const {
    status,
    paymentStatus,
    customerId,
    search,
    type,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const query = {};

  if (status && status !== 'all') {
    if (status === 'rejected_or_resubmission') {
      query.status = { $in: ['rejected', 'resubmission_required'] };
    } else {
      query.status = status;
    }
  }

  if (paymentStatus && paymentStatus !== 'all') {
    query.paymentStatus = paymentStatus;
  }

  if (type && type !== 'all') {
    query.applicationType = type;
  }

  if (customerId) {
    query.customerId = customerId;
  }

  if (search && search.trim()) {
    const term = search.trim();
    query.$or = [
      { applicationNumber: { $regex: term, $options: 'i' } },
      { customerName: { $regex: term, $options: 'i' } },
      { customerMobile: { $regex: term, $options: 'i' } },
      { customerEmail: { $regex: term, $options: 'i' } },
      { 'finalCertificate.certificateNumber': { $regex: term, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  const [applications, total] = await Promise.all([
    Application.find(query)
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('customerId', 'name mobile email company city state')
      .populate('assignedTo', 'name email role'),
    Application.countDocuments(query),
  ]);

  res.json({
    success: true,
    count: applications.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    applications,
  });
});

// @desc    Get Single Application Details
// @route   GET /api/applications/:id
// @access  Private
const getApplicationById = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id)
    .populate('customerId')
    .populate('assignedTo', 'name email role')
    .populate('finalCertificate.uploadedBy', 'name email');

  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  res.json({
    success: true,
    application,
  });
});

// @desc    Create New Application
// @route   POST /api/applications
// @access  Private
const createApplication = asyncHandler(async (req, res) => {
  const {
    customerId,
    applicationType = 'membership',
    paymentAmount = 0,
    paymentStatus = 'pending',
    paymentReference = '',
    remarks = '',
  } = req.body;

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const applicationNumber = await generateApplicationNumber();

  const application = await Application.create({
    applicationNumber,
    customerId: customer._id,
    customerName: customer.name,
    customerMobile: customer.mobile || customer.phone,
    customerEmail: customer.email || '',
    applicationType,
    status: 'new',
    paymentStatus,
    paymentAmount: Number(paymentAmount) || 0,
    paymentReference,
    paymentDate: paymentStatus === 'completed' ? new Date() : null,
    remarks,
    assignedTo: req.user._id,
    assignedToName: req.user.name,
    history: [
      {
        action: 'Application Created',
        performedBy: req.user._id,
        performedByName: req.user.name,
        notes: `Application initiated with type ${applicationType}.`,
        date: new Date(),
      },
    ],
  });

  // Automatic Email: Application Submitted
  emailNotificationService.sendApplicationSubmittedEmail({
    customerId: customer._id,
    customerName: customer.name,
    customerEmail: customer.email,
    applicationNumber: application.applicationNumber,
    applicationType: application.applicationType,
    feeAmount: application.paymentAmount,
    paymentStatus: application.paymentStatus,
    remarks,
  }).catch((err) => console.warn('[Email Error] Application Submitted:', err.message));

  if (application.paymentStatus === 'completed') {
    emailNotificationService.sendPaymentConfirmationEmail({
      customerId: customer._id,
      customerName: customer.name,
      customerEmail: customer.email,
      applicationNumber: application.applicationNumber,
      paymentAmount: application.paymentAmount,
      paymentReference: application.paymentReference,
      paymentDate: new Date(),
    }).catch((err) => console.warn('[Email Error] Payment Confirmation:', err.message));
  }

  res.status(201).json({
    success: true,
    message: 'Application created successfully',
    application,
  });
});

// @desc    Update Application Status (approve, reject, request resubmission, under review, etc.)
// @route   PATCH /api/applications/:id/status
// @access  Private (Admin / Manager)
const updateStatus = asyncHandler(async (req, res) => {
  const { status, rejectionReason, resubmissionNotes, remarks } = req.body;

  const validStatuses = [
    'new',
    'pending_documents',
    'under_review',
    'approved',
    'rejected',
    'resubmission_required',
  ];

  if (!validStatuses.includes(status)) {
    res.status(400);
    throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  const application = await Application.findById(req.params.id);
  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  const prevStatus = application.status;
  application.status = status;

  if (rejectionReason) application.rejectionReason = rejectionReason;
  if (resubmissionNotes) application.resubmissionNotes = resubmissionNotes;
  if (remarks) application.remarks = remarks;

  application.history.unshift({
    action: `Status changed from ${prevStatus} to ${status}`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    notes: rejectionReason || resubmissionNotes || remarks || '',
    date: new Date(),
  });

  await application.save();

  // Automatic Email: Application Status Update
  emailNotificationService.sendApplicationStatusUpdateEmail({
    customerId: application.customerId,
    customerName: application.customerName,
    customerEmail: application.customerEmail,
    applicationNumber: application.applicationNumber,
    oldStatus: prevStatus,
    newStatus: status,
    remarks: rejectionReason || resubmissionNotes || remarks,
  }).catch((err) => console.warn('[Email Error] Status Update:', err.message));

  if (status === 'pending_documents' || status === 'resubmission_required') {
    emailNotificationService.sendDocumentsPendingEmail({
      customerId: application.customerId,
      customerName: application.customerName,
      customerEmail: application.customerEmail,
      applicationNumber: application.applicationNumber,
      resubmissionNotes: rejectionReason || resubmissionNotes,
    }).catch((err) => console.warn('[Email Error] Documents Pending:', err.message));
  }

  res.json({
    success: true,
    message: `Application status updated to ${status}`,
    application,
  });
});

// @desc    Update Payment Status
// @route   PATCH /api/applications/:id/payment
// @access  Private
const updatePayment = asyncHandler(async (req, res) => {
  const { paymentStatus, paymentAmount, paymentReference, paymentDate } = req.body;

  const application = await Application.findById(req.params.id);
  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  if (paymentStatus) application.paymentStatus = paymentStatus;
  if (paymentAmount !== undefined) application.paymentAmount = Number(paymentAmount) || 0;
  if (paymentReference !== undefined) application.paymentReference = paymentReference;
  if (paymentDate) {
    application.paymentDate = new Date(paymentDate);
  } else if (paymentStatus === 'completed' && !application.paymentDate) {
    application.paymentDate = new Date();
  }

  application.history.unshift({
    action: `Payment status updated to ${paymentStatus || application.paymentStatus}`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    notes: `Amount: ₹${application.paymentAmount}, Ref: ${application.paymentReference || 'N/A'}`,
    date: new Date(),
  });

  await application.save();

  if (application.paymentStatus === 'completed') {
    emailNotificationService.sendPaymentConfirmationEmail({
      customerId: application.customerId,
      customerName: application.customerName,
      customerEmail: application.customerEmail,
      applicationNumber: application.applicationNumber,
      paymentAmount: application.paymentAmount,
      paymentReference: application.paymentReference,
      paymentDate: application.paymentDate || new Date(),
    }).catch((err) => console.warn('[Email Error] Payment Confirmation:', err.message));
  }

  res.json({
    success: true,
    message: 'Payment information updated',
    application,
  });
});

// @desc    Upload document to Application Folder
// @route   POST /api/applications/:id/documents
// @access  Private
const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No document file was uploaded');
  }

  const { name = 'Uploaded Document', type = 'other', remarks = '' } = req.body;

  const application = await Application.findById(req.params.id);
  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  // Construct accessible relative URL path
  const fileUrl = `/uploads/documents/${req.file.filename}`;

  const documentItem = {
    name,
    type,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    fileMime: req.file.mimetype,
    status: 'submitted',
    remarks,
    uploadedAt: new Date(),
  };

  application.documents.push(documentItem);

  // If application was in pending_documents, advance it to under_review automatically
  if (application.status === 'pending_documents' || application.status === 'new') {
    application.status = 'under_review';
  }

  application.history.unshift({
    action: `Document uploaded: ${name}`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    notes: `File: ${req.file.originalname} (${Math.round(req.file.size / 1024)} KB)`,
    date: new Date(),
  });

  await application.save();

  res.status(201).json({
    success: true,
    message: 'Document uploaded to application folder',
    document: application.documents[application.documents.length - 1],
    application,
  });
});

// @desc    Update Document Status (Verify, Reject, Resubmit)
// @route   PATCH /api/applications/:id/documents/:docId/status
// @access  Private (Admin / Manager)
const updateDocumentStatus = asyncHandler(async (req, res) => {
  const { status, remarks = '' } = req.body;
  const { id, docId } = req.params;

  const validDocStatuses = ['pending', 'submitted', 'verified', 'rejected', 'resubmission_required'];
  if (!validDocStatuses.includes(status)) {
    res.status(400);
    throw new Error(`Invalid status: ${status}. Must be one of: ${validDocStatuses.join(', ')}`);
  }

  const application = await Application.findById(id);
  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  const doc = application.documents.id(docId);
  if (!doc) {
    res.status(404);
    throw new Error('Document not found in application folder');
  }

  const prevStatus = doc.status;
  doc.status = status;
  if (remarks) doc.remarks = remarks;

  application.history.unshift({
    action: `Document '${doc.name}' status changed: ${prevStatus} -> ${status}`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    notes: remarks || '',
    date: new Date(),
  });

  // If any document is rejected or marked for resubmission, reflect in application status
  if (status === 'resubmission_required' || status === 'rejected') {
    application.status = status;
    application.resubmissionNotes = remarks || `Resubmission required for ${doc.name}`;
  }

  await application.save();

  if (status === 'verified') {
    emailNotificationService.sendDocumentsApprovedEmail({
      customerId: application.customerId,
      customerName: application.customerName,
      customerEmail: application.customerEmail,
      applicationNumber: application.applicationNumber,
      documentName: doc.name,
    }).catch((err) => console.warn('[Email Error] Documents Approved:', err.message));
  } else if (status === 'resubmission_required' || status === 'rejected') {
    emailNotificationService.sendDocumentsPendingEmail({
      customerId: application.customerId,
      customerName: application.customerName,
      customerEmail: application.customerEmail,
      applicationNumber: application.applicationNumber,
      missingDocuments: [doc.name],
      resubmissionNotes: remarks,
    }).catch((err) => console.warn('[Email Error] Document Resubmit:', err.message));
  }

  res.json({
    success: true,
    message: `Document status marked as ${status}`,
    document: doc,
    application,
  });
});

// @desc    Delete Document from Application Folder
// @route   DELETE /api/applications/:id/documents/:docId
// @access  Private (Admin)
const deleteDocument = asyncHandler(async (req, res) => {
  const { id, docId } = req.params;

  const application = await Application.findById(id);
  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  const doc = application.documents.id(docId);
  if (!doc) {
    res.status(404);
    throw new Error('Document not found');
  }

  // Remove file from disk safely
  if (doc.fileUrl && doc.fileUrl.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', doc.fileUrl);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('Could not remove file from disk:', err.message);
      }
    }
  }

  application.documents.pull(docId);

  application.history.unshift({
    action: `Document deleted: ${doc.name}`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    notes: `File ${doc.fileName} was removed.`,
    date: new Date(),
  });

  await application.save();

  res.json({
    success: true,
    message: 'Document deleted from folder',
    application,
  });
});

// @desc    Upload Final Certificate
// @route   POST /api/applications/:id/certificate
// @access  Private (Admin / Manager)
const uploadCertificate = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No certificate file was uploaded');
  }

  const {
    certificateNumber,
    title = 'PeYug Society Membership Certificate',
    issuedDate,
  } = req.body;

  const application = await Application.findById(req.params.id);
  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  const fileUrl = `/uploads/certificates/${req.file.filename}`;

  const certNum =
    certificateNumber?.trim() ||
    `CERT-JINL-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

  application.finalCertificate = {
    certificateNumber: certNum,
    title,
    fileUrl,
    fileName: req.file.originalname,
    issuedDate: issuedDate ? new Date(issuedDate) : new Date(),
    uploadedAt: new Date(),
    uploadedBy: req.user._id,
    uploadedByName: req.user.name,
  };

  // Uploading final certificate approves the application
  application.status = 'approved';

  application.history.unshift({
    action: `Final Certificate Issued: ${certNum}`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    notes: `Certificate '${title}' uploaded (${req.file.originalname}). Application marked Approved.`,
    date: new Date(),
  });

  await application.save();

  // Automatic Email: Registration Completed & Final Certificate Ready
  emailNotificationService.sendRegistrationCompletedEmail({
    customerId: application.customerId,
    customerName: application.customerName,
    customerEmail: application.customerEmail,
    applicationNumber: application.applicationNumber,
    certificateNumber: certNum,
    certificateTitle: title,
    downloadUrl: application.finalCertificate.fileUrl,
  }).catch((err) => console.warn('[Email Error] Registration Completed:', err.message));

  res.status(201).json({
    success: true,
    message: 'Final Certificate uploaded and issued successfully',
    finalCertificate: application.finalCertificate,
    application,
  });
});

// @desc    Remove Final Certificate
// @route   DELETE /api/applications/:id/certificate
// @access  Private (Admin)
const deleteCertificate = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) {
    res.status(404);
    throw new Error('Application not found');
  }

  if (application.finalCertificate?.fileUrl) {
    const filePath = path.join(__dirname, '..', application.finalCertificate.fileUrl);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('Could not remove certificate file:', err.message);
      }
    }
  }

  application.finalCertificate = {};

  application.history.unshift({
    action: 'Final Certificate removed',
    performedBy: req.user._id,
    performedByName: req.user.name,
    date: new Date(),
  });

  await application.save();

  res.json({
    success: true,
    message: 'Final Certificate removed',
    application,
  });
});

module.exports = {
  getStats,
  getApplications,
  getApplicationById,
  createApplication,
  updateStatus,
  updatePayment,
  uploadDocument,
  updateDocumentStatus,
  deleteDocument,
  uploadCertificate,
  deleteCertificate,
};
