const mongoose = require('mongoose');

const LEAD_STATUSES = ['new', 'contacted', 'interested', 'follow-up', 'converted', 'not-interested', 'closed'];

const historyEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: LEAD_STATUSES, required: true },
    date: { type: Date, default: Date.now },
    remark: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true }, // denormalized for quick list display
    status: { type: String, enum: LEAD_STATUSES, default: 'new' },
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true }
);

leadSchema.statics.STATUSES = LEAD_STATUSES;

module.exports = mongoose.model('Lead', leadSchema);
