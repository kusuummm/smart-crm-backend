const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const Wallet = require('../models/Wallet');
const User = require('../models/User');

// @desc    Get user's wallet, real balance, and transaction history
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

  // Sort transactions newest first
  if (Array.isArray(wallet.transactions)) {
    wallet.transactions.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
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

// @desc    Create Razorpay Order & Generate Dynamic UPI QR Code for instant recharge
// @route   POST /api/wallet/create-order
// @access  Private
const createOrder = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const numAmount = parseFloat(amount);

  if (!numAmount || numAmount <= 0) {
    res.status(400);
    throw new Error('Valid recharge amount is required');
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  let razorpayOrder = null;
  const simulatedOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;

  // 1. If live Razorpay credentials exist, create order via Razorpay REST API
  if (keyId && keySecret) {
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const orderRes = await axios.post(
        'https://api.razorpay.com/v1/orders',
        {
          amount: Math.round(numAmount * 100), // in paise
          currency: 'INR',
          receipt: `rcpt_${Date.now()}`,
          notes: {
            userId: String(req.user._id),
            userName: req.user.name,
            email: req.user.email,
          },
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          timeout: 6000,
        }
      );
      razorpayOrder = orderRes.data;
    } catch (err) {
      console.warn('[Razorpay order creation fallback]:', err.message);
    }
  }

  const effectiveOrderId = razorpayOrder ? razorpayOrder.id : simulatedOrderId;

  // 2. Generate Real Dynamic UPI Intent URL & High-Resolution QR Code
  // Supported by all Indian UPI apps: Google Pay, PhonePe, Paytm, BHIM, Cred, Navi
  const upiId = process.env.MERCHANT_UPI_ID || 'paymanent@upi';
  const payeeName = 'Smart CRM';
  const transactionNote = `Smart CRM Recharge ${numAmount.toFixed(0)}`;
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${numAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(transactionNote)}&tr=${effectiveOrderId}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(upiUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  } catch (err) {
    console.error('[QRCode Generation Error]:', err.message);
  }

  res.json({
    success: true,
    order: razorpayOrder || {
      id: effectiveOrderId,
      amount: Math.round(numAmount * 100),
      currency: 'INR',
      status: 'created',
    },
    upi: {
      url: upiUrl,
      qrCode: qrCodeDataUrl,
      vpa: upiId,
      payeeName,
      amount: numAmount,
    },
    keyId: keyId || null,
  });
});

// @desc    Recharge wallet / record transaction with gateway verification
// @route   POST /api/wallet/recharge
// @access  Private
const rechargeWallet = asyncHandler(async (req, res) => {
  const {
    amount,
    paymentMethod = 'UPI / Razorpay',
    paymentId,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    utrNumber,
  } = req.body;

  const numAmount = parseFloat(amount);

  if (!numAmount || numAmount <= 0) {
    res.status(400);
    throw new Error('Valid recharge amount is required');
  }

  // Prevent accidental massive numbers in non-production
  if (numAmount > 100000 && process.env.NODE_ENV !== 'production') {
    res.status(400);
    throw new Error('Maximum allowed single top-up is ₹100,000');
  }

  // Gateway HMAC Verification when live Razorpay secret is present
  const effectivePaymentId = razorpay_payment_id || utrNumber || paymentId || `pay_${Date.now()}`;
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

  const now = new Date();
  const dateStr = `${now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const newTx = {
    amount: numAmount,
    type: 'credit',
    description: `Wallet top-up via ${paymentMethod}`,
    paymentId: effectivePaymentId,
    status: 'completed',
    date: dateStr,
    createdAt: now,
  };

  wallet.balance += numAmount;
  wallet.transactions.unshift(newTx);

  await wallet.save();

  // Keep User model balance in sync with Wallet model
  await User.findByIdAndUpdate(req.user._id, {
    balance: `₹${wallet.balance.toFixed(1)}`,
  }).catch(() => {});

  res.json({
    success: true,
    balance: wallet.balance,
    message: `₹${numAmount.toLocaleString()} credited to your CRM wallet successfully!`,
    transaction: newTx,
    wallet,
  });
});

// @desc    Get real wallet transactions ledger with filtering and search
// @route   GET /api/wallet/transactions
// @access  Private
const getTransactions = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ userId: req.user._id });

  if (!wallet) {
    return res.json({ success: true, transactions: [], balance: 0.0 });
  }

  let txs = [...(wallet.transactions || [])];
  const { type, search } = req.query;

  if (type && type !== 'all') {
    txs = txs.filter((t) => t.type === type);
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    txs = txs.filter(
      (t) =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.paymentId || '').toLowerCase().includes(q) ||
        String(t.amount).includes(q)
    );
  }

  txs.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));

  res.json({
    success: true,
    transactions: txs,
    balance: wallet.balance,
  });
});

module.exports = {
  getWallet,
  createOrder,
  rechargeWallet,
  getTransactions,
};
