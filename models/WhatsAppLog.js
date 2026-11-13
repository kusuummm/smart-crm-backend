const mongoose = require('mongoose');

const whatsAppLogSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, default: 'Customer' },
    phone: { type: String, required: true },
    mobile: { type: String, default: '' },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['template', 'follow-up', 'offer', 'meeting-reminder', 'broadcast', 'system', 'general', 'application'],
      default: 'template',
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed', 'logged', 'queued'],
      default: 'sent',
    },
    error: { type: String, default: '' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentByName: { type: String, default: 'System Automated' },
    providerMessageId: { type: String, default: '' }, // Meta WhatsApp message id for delivery tracking
  },
  { timestamps: true }
);

// Pre-validate hook: keep phone and mobile synchronized
whatsAppLogSchema.pre('validate', function (next) {
  if (!this.phone && this.mobile) {
    this.phone = this.mobile;
  }
  if (!this.mobile && this.phone) {
    this.mobile = this.phone;
  }
  next();
});

whatsAppLogSchema.index({ phone: 1, createdAt: -1 });
whatsAppLogSchema.index({ customerId: 1, createdAt: -1 });
whatsAppLogSchema.index({ sentBy: 1, createdAt: -1 });
whatsAppLogSchema.index({ status: 1 });
whatsAppLogSchema.index({ type: 1 });
whatsAppLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WhatsAppLog', whatsAppLogSchema);
