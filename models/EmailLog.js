const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: false },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: false },
    customerName: { type: String, default: '' },
    email: { type: String, required: true },
    to: { type: String, default: '' },
    from: { type: String, default: '' },
    direction: { type: String, enum: ['outgoing', 'incoming'], default: 'outgoing' },
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
        'incoming',
        'reply',
        'inquiry',
      ],
      default: 'general',
    },
    status: { type: String, enum: ['sent', 'delivered', 'read', 'failed', 'received'], default: 'sent' },
    isRead: { type: Boolean, default: false },
    receivedAt: { type: Date },
    error: { type: String, default: '' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentByName: { type: String, default: 'System Automated' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Keep email, to, and from in sync
emailLogSchema.pre('save', function (next) {
  if (this.direction === 'incoming') {
    if (!this.from && this.email) this.from = this.email;
    if (!this.email && this.from) this.email = this.from;
    if (!this.to) this.to = process.env.EMAIL_USER || 'crm@system.local';
    if (!this.receivedAt) this.receivedAt = new Date();
  } else {
    if (!this.to && this.email) this.to = this.email;
    if (!this.email && this.to) this.email = this.to;
    if (!this.from) this.from = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'crm@system.local';
  }
  if (!this.bodySnippet && this.body) this.bodySnippet = this.body.slice(0, 160);
  next();
});

emailLogSchema.index({ leadId: 1, createdAt: -1 });
emailLogSchema.index({ to: 1, createdAt: -1 });
emailLogSchema.index({ from: 1, createdAt: -1 });
emailLogSchema.index({ email: 1 });
emailLogSchema.index({ customerId: 1, createdAt: -1 });
emailLogSchema.index({ sentBy: 1, createdAt: -1 });
emailLogSchema.index({ direction: 1, createdAt: -1 });
emailLogSchema.index({ status: 1 });
emailLogSchema.index({ type: 1 });
emailLogSchema.index({ isRead: 1 });
emailLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
