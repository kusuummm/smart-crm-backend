const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: false },
    customerName: { type: String, default: '' },
    email: { type: String, required: true },
    to: { type: String, default: '' }, // alias for email
    subject: { type: String, required: true },
    body: { type: String, default: '' },
    bodySnippet: { type: String, default: '' },
    type: {
      type: String,
      enum: [
        'welcome',
        'follow-up',
        'offer',
        'custom',
        'reminder',
        'general',
        'meeting-reminder',
        'meeting-confirmation',
        'lead',
        'lead-assignment',
        'verification',
        'application_submitted',
        'documents_pending',
        'documents_approved',
        'payment_confirmation',
        'status_update',
        'registration_completed',
        'password_reset',
        'login_verification',
      ],
      default: 'general',
    },
    status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
    error: { type: String, default: '' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentByName: { type: String, default: 'System Automated' },
  },
  { timestamps: true }
);

// Keep email and to in sync
emailLogSchema.pre('save', function (next) {
  if (!this.to && this.email) this.to = this.email;
  if (!this.email && this.to) this.email = this.to;
  if (!this.bodySnippet && this.body) this.bodySnippet = this.body.slice(0, 160);
  next();
});

emailLogSchema.index({ to: 1, createdAt: -1 });
emailLogSchema.index({ email: 1 });
emailLogSchema.index({ customerId: 1, createdAt: -1 });
emailLogSchema.index({ sentBy: 1, createdAt: -1 });
emailLogSchema.index({ status: 1 });
emailLogSchema.index({ type: 1 });
emailLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
