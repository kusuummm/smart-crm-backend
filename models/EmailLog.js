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

module.exports = mongoose.model('EmailLog', emailLogSchema);
