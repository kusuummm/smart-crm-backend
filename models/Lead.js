const mongoose = require('mongoose');

const historyEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true, trim: true },
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
    status: { type: String, default: 'new', trim: true },
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true }
);

leadSchema.index({ customerId: 1 });
leadSchema.index({ telecallerId: 1, status: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ 'history.date': -1 });

module.exports = mongoose.model('Lead', leadSchema);
