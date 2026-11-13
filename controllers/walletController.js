const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const Wallet = require('../models/Wallet');
const User = require('../models/User');

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

  // Keep User model balance in sync with Wallet model
  await User.findByIdAndUpdate(req.user._id, {
    balance: `₹${wallet.balance.toFixed(1)}`,
  }).catch(() => {});

  res.json({
    success: true,
    wallet,
    balance: wallet.balance,
  });
});

// @desc    Recharge wallet / record transaction with gateway verification
// @route   POST /api/wallet/recharge
// @access  Private
const rechargeWallet = asyncHandler(async (req, res) => {
  const {
    amount,
    paymentMethod = 'UPI / Razorpay',
    paymentId = `pay_${Date.now()}`,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  const numAmount = parseFloat(amount);

  if (!numAmount || numAmount <= 0) {
    res.status(400);
    throw new Error('Valid recharge amount is required');
  }

  // Sanity check to prevent accidental or malicious massive balance injections in non-production
  if (numAmount > 100000 && process.env.NODE_ENV !== 'production') {
    res.status(400);
    throw new Error('Sandbox limit exceeded: Maximum allowed single top-up is ₹100,000');
  }

  // Gateway HMAC Verification when live Razorpay secret is present
  const effectivePaymentId = razorpay_payment_id || paymentId;
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

  if (razorpaySecret && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
    const expectedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      res.status(400);
      throw new Error('Payment verification failed: Invalid cryptographic signature from payment gateway.');
    }
  }

  let wallet = await Wallet.findOne({ userId: req.user._id });
  if (!wallet) {
    wallet = new Wallet({ userId: req.user._id, balance: 0.0, transactions: [] });
  }

  // Prevent duplicate transaction replay attacks
  const alreadyProcessed = wallet.transactions.some(
    (tx) => tx.paymentId && tx.paymentId === effectivePaymentId
  );
  if (alreadyProcessed) {
    res.status(409);
    throw new Error('Duplicate transaction: This payment has already been credited to your wallet.');
  }

  wallet.balance += numAmount;
  wallet.transactions.unshift({
    amount: numAmount,
    type: 'credit',
    description: `Wallet top-up via ${paymentMethod}`,
    paymentId: effectivePaymentId,
    status: 'completed',
    date: `${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    createdAt: new Date(),
  });

  await wallet.save();

  // Keep User model balance in sync with Wallet model
  await User.findByIdAndUpdate(req.user._id, {
    balance: `₹${wallet.balance.toFixed(1)}`,
  }).catch(() => {});

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
