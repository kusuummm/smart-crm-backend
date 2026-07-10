const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    type: { type: String, enum: ['welcome', 'follow-up', 'offer'], default: 'follow-up' },
    status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentByName: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailLog', emailLogSchema);
