const mongoose = require('mongoose');

const documentItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['aadhaar', 'pan', 'photo', 'signature', 'address_proof', 'income_proof', 'bank_statement', 'other'],
      default: 'other',
    },
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    fileMime: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'submitted', 'verified', 'rejected', 'resubmission_required'],
      default: 'submitted',
    },
    remarks: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const finalCertificateSchema = new mongoose.Schema(
  {
    certificateNumber: { type: String, default: '' },
    title: { type: String, default: 'Society Membership Certificate' },
    fileUrl: { type: String, default: '' },
    fileName: { type: String, default: '' },
    issuedDate: { type: Date, default: null },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedByName: { type: String, default: '' },
  },
  { _id: false }
);

const applicationHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    performedByName: { type: String, default: 'System' },
    notes: { type: String, default: '' },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const applicationSchema = new mongoose.Schema(
  {
    applicationNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    customerName: { type: String, required: true, trim: true },
    customerMobile: { type: String, required: true, trim: true },
    customerEmail: { type: String, default: '', trim: true },
    applicationType: {
      type: String,
      enum: [
        'membership',
        'cooperative_loan',
        'fixed_deposit',
        'recurring_deposit',
        'society_registration',
        'certificate_issue',
        'general_service',
      ],
      default: 'membership',
    },
    status: {
      type: String,
      enum: [
        'new',
        'pending_documents',
        'under_review',
        'approved',
        'rejected',
        'resubmission_required',
      ],
      default: 'new',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending',
      index: true,
    },
    paymentAmount: { type: Number, default: 0 },
    paymentReference: { type: String, default: '' },
    paymentDate: { type: Date, default: null },
    documents: [documentItemSchema],
    finalCertificate: { type: finalCertificateSchema, default: () => ({}) },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedToName: { type: String, default: '' },
    remarks: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    resubmissionNotes: { type: String, default: '' },
    history: [applicationHistorySchema],
  },
  { timestamps: true }
);

// Indexes for fast administrative filtering & reporting
applicationSchema.index({ status: 1, paymentStatus: 1 });
applicationSchema.index({ customerId: 1, createdAt: -1 });
applicationSchema.index({ createdAt: -1 });
applicationSchema.index({
  applicationNumber: 'text',
  customerName: 'text',
  customerMobile: 'text',
});

module.exports = mongoose.model('Application', applicationSchema);
