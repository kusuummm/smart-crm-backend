const mongoose = require('mongoose');

const whatsAppLogSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['template', 'follow-up', 'offer'], default: 'template' },
    status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentByName: { type: String, default: '' },
    providerMessageId: { type: String, default: '' }, // Meta WhatsApp message id, for delivery status tracking
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppLog', whatsAppLogSchema);
