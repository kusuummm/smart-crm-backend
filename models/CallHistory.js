const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    duration: { type: String, default: '0 mins' },
    status: { type: String, enum: ['connected', 'missed', 'busy'], default: 'connected' },
    remarks: { type: String, default: '' },
    calledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CallHistory', callHistorySchema);
