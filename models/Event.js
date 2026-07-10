const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    type: { type: String, enum: ['birthday', 'anniversary', 'emi', 'renewal'], required: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    description: { type: String, default: '' },
    reminder: { type: String, default: '1 day before' },
    status: { type: String, enum: ['upcoming', 'done', 'missed'], default: 'upcoming' },
    remindedVia: {
      dashboard: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Event', eventSchema);
