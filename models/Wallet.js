const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  type: {
    type: String,
    enum: ['credit', 'debit', 'refund'],
    default: 'credit',
  },
  description: { type: String, required: true },
  paymentId: { type: String, default: '' },
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed',
  },
  date: {
    type: String,
    default: () =>
      `${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  },
  createdAt: { type: Date, default: Date.now },
});

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    balance: { type: Number, default: 0.0 },
    currency: { type: String, default: 'INR' },
    transactions: [transactionSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
