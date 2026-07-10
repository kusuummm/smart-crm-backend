const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    remarks: { type: String, default: '' },
    nextFollowUp: { type: String, default: '' }, // 'YYYY-MM-DD'
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FollowUp', followUpSchema);
