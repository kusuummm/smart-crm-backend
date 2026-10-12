const asyncHandler = require('express-async-handler');
const Wallet = require('../models/Wallet');

// @desc    Get user's wallet and balance
// @route   GET /api/wallet
// @access  Private
const getWallet = asyncHandler(async (req, res) => {
  let wallet = await Wallet.findOne({ userId: req.user._id });

  if (!wallet) {
    wallet = await Wallet.create({
      userId: req.user._id,
      balance: 0.0,
      currency: 'INR',
      transactions: [],
    });
  }

  res.json({
    success: true,
    wallet,
    balance: wallet.balance,
  });
});

// @desc    Recharge wallet / record transaction
// @route   POST /api/wallet/recharge
// @access  Private
const rechargeWallet = asyncHandler(async (req, res) => {
  const { amount, paymentMethod = 'UPI / Razorpay', paymentId = `pay_${Date.now()}` } = req.body;
  const numAmount = parseFloat(amount);

  if (!numAmount || numAmount <= 0) {
    res.status(400);
    throw new Error('Valid recharge amount is required');
  }

  let wallet = await Wallet.findOne({ userId: req.user._id });
  if (!wallet) {
    wallet = new Wallet({ userId: req.user._id, balance: 0.0, transactions: [] });
  }

  wallet.balance += numAmount;
  wallet.transactions.unshift({
    amount: numAmount,
    type: 'credit',
    description: `Wallet top-up via ${paymentMethod}`,
    paymentId,
    status: 'completed',
    date: `${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  });

  await wallet.save();

  res.json({
    success: true,
    balance: wallet.balance,
    message: `₹${numAmount.toLocaleString()} added to your CRM wallet successfully!`,
    wallet,
  });
});

module.exports = {
  getWallet,
  rechargeWallet,
};
