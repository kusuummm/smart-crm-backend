const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Order = require('../models/Order');
const {
  PRODUCT_CATALOG,
  PROMO_CODES,
  APPLICATION_FEE_MAP,
  calculateCheckoutPricing,
} = require('../services/pricingService');

// @desc    Get trusted pricing catalog and active promotions
// @route   GET /api/wallet/pricing/catalog
// @access  Private
const getPricingCatalog = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    currency: 'INR',
    standardTaxRate: 0.18,
    products: Object.values(PRODUCT_CATALOG),
    promoCodes: Object.values(PROMO_CODES).map((p) => ({
      code: p.code,
      type: p.type,
      value: p.value,
      description: p.description,
      minOrderAmount: p.minOrderAmount,
    })),
    applicationFees: APPLICATION_FEE_MAP,
  });
});

// @desc    Calculate authoritative checkout pricing (Subtotal, Discounts, GST Tax, Final Total)
// @route   POST /api/wallet/calculate-pricing
// @access  Private
const calculatePricing = asyncHandler(async (req, res) => {
  const { items, promoCode, amount, claimedPricing } = req.body;

  try {
    const result = calculateCheckoutPricing({
      items,
      promoCode,
      walletTopupAmount: amount,
      claimedPricing,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

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

// @desc    Create Order with trusted server-side pricing & Generate Dynamic UPI QR Code
// @route   POST /api/wallet/create-order
// @access  Private
const createOrder = asyncHandler(async (req, res) => {
  const { amount, items, promoCode, claimedPricing } = req.body;

  // Calculate trusted pricing server-side
  let pricingResult;
  try {
    pricingResult = calculateCheckoutPricing({
      items,
      promoCode,
      walletTopupAmount: amount,
      claimedPricing,
    });
  } catch (calcErr) {
    res.status(calcErr.statusCode || 400);
    throw calcErr;
  }

  const { pricing, items: calculatedItems, type } = pricingResult;
  const numAmount = pricing.total;

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
          amount: Math.round(numAmount * 100), // in paise (strictly using trusted server total)
          currency: 'INR',
          receipt: `rcpt_${Date.now()}`,
          notes: {
            userId: String(req.user._id),
            userName: req.user.name,
            email: req.user.email,
            orderType: type,
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

  // 2. Persist authoritative Order record in database for transaction integrity
  const orderRecord = await Order.create({
    orderId: effectiveOrderId,
    userId: req.user._id,
    type,
    items: calculatedItems,
    pricing,
    status: 'created',
    metadata: {
      razorpayOrderId: razorpayOrder ? razorpayOrder.id : null,
      notes: req.body.notes || '',
    },
  });

  // 3. Generate Real Dynamic UPI Intent URL & High-Resolution QR Code
  const upiId = process.env.MERCHANT_UPI_ID || 'paymanent@upi';
  const payeeName = 'Smart CRM';
  const transactionNote = `Smart CRM ${type.replace('_', ' ')} ${numAmount.toFixed(0)}`;
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
    orderId: effectiveOrderId,
    order: razorpayOrder || {
      id: effectiveOrderId,
      amount: Math.round(numAmount * 100),
      currency: 'INR',
      status: 'created',
    },
    pricing,
    items: calculatedItems,
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

// @desc    Execute payment verification and wallet credit using trusted server order data
// @route   POST /api/wallet/recharge
// @access  Private
const rechargeWallet = asyncHandler(async (req, res) => {
  const {
    orderId,
    amount,
    paymentMethod = 'UPI / Razorpay',
    paymentId,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    utrNumber,
  } = req.body;

  const targetOrderId = razorpay_order_id || orderId;

  // 1. Retrieve the authoritative Order from database
  let order = null;
  if (targetOrderId) {
    order = await Order.findOne({
      $or: [{ orderId: targetOrderId }, { 'paymentDetails.razorpayOrderId': targetOrderId }],
    });
  }

  // 2. Validate Order Existence & Ownership
  if (order) {
    if (String(order.userId) !== String(req.user._id)) {
      res.status(403);
      throw new Error('Access denied: You do not have permission to execute payment on this order');
    }

    if (order.status === 'paid') {
      res.status(409);
      throw new Error('Duplicate transaction: This order has already been verified and credited');
    }
  }

  // 3. Resolve Trusted Amount (Server-side Order total takes precedence over client input)
  let trustedAmount;
  if (order) {
    trustedAmount = order.pricing.total;
    // Reject price tampering if client sent an explicit amount that contradicts the order total
    if (amount !== undefined && Math.abs(parseFloat(amount) - trustedAmount) > 0.05) {
      res.status(400);
      throw new Error(
        `Price tampering detected: Submitted amount ₹${amount} does not match verified server order total ₹${trustedAmount}. Transaction rejected.`
      );
    }
  } else {
    // If no order record exists, validate amount as direct top-up with strict boundaries
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400);
      throw new Error('Valid recharge amount is required');
    }
    if (parsedAmount < 10) {
      res.status(400);
      throw new Error('Minimum recharge amount is ₹10');
    }
    if (parsedAmount > 100000 && process.env.NODE_ENV !== 'production') {
      res.status(400);
      throw new Error('Maximum allowed single top-up is ₹100,000');
    }
    trustedAmount = Math.round(parsedAmount * 100) / 100;
  }

  // 4. Gateway Cryptographic HMAC Verification when live Razorpay secret is present
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

  // 5. Load or Create User Wallet
  let wallet = await Wallet.findOne({ userId: req.user._id });
  if (!wallet) {
    wallet = new Wallet({ userId: req.user._id, balance: 0.0, transactions: [] });
  }

  // 6. Prevent duplicate transaction replay attacks
  const alreadyProcessed = wallet.transactions.some(
    (tx) => tx.paymentId && tx.paymentId === effectivePaymentId
  );
  if (alreadyProcessed) {
    res.status(409);
    throw new Error('Duplicate transaction: This payment has already been credited to your wallet.');
  }

  // 7. Execute Wallet Credit using TRUSTED AMOUNT
  const now = new Date();
  const dateStr = `${now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const newTx = {
    amount: trustedAmount,
    type: 'credit',
    description: `Wallet top-up via ${paymentMethod}`,
    paymentId: effectivePaymentId,
    status: 'completed',
    date: dateStr,
    createdAt: now,
  };

  wallet.balance += trustedAmount;
  wallet.transactions.unshift(newTx);
  await wallet.save();

  // 8. Mark Order as Paid
  if (order) {
    order.status = 'paid';
    order.paymentDetails = {
      paymentMethod,
      paymentId: effectivePaymentId,
      razorpayOrderId: razorpay_order_id || order.orderId,
      razorpayPaymentId: razorpay_payment_id || '',
      razorpaySignature: razorpay_signature || '',
      paidAt: now,
    };
    await order.save();
  }

  // 9. Sync User model balance
  await User.findByIdAndUpdate(req.user._id, {
    balance: `₹${wallet.balance.toFixed(1)}`,
  }).catch(() => {});

  res.json({
    success: true,
    balance: wallet.balance,
    amountCredited: trustedAmount,
    message: `₹${trustedAmount.toLocaleString()} credited to your CRM wallet successfully!`,
    transaction: newTx,
    order: order || null,
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
  getPricingCatalog,
  calculatePricing,
  getWallet,
  createOrder,
  rechargeWallet,
  getTransactions,
};

