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

// @desc    Execute payment verification and order fulfillment using trusted server order data
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

  // 1. Enforce Server Order Requirement: Direct, unverified top-ups without an authoritative Order are rejected
  if (!targetOrderId) {
    res.status(400);
    throw new Error('Transaction rejected: A verified server orderId is required to complete payment');
  }

  // 2. Retrieve the authoritative Order from database
  const order = await Order.findOne({
    $or: [{ orderId: targetOrderId }, { 'paymentDetails.razorpayOrderId': targetOrderId }],
  });

  if (!order) {
    res.status(404);
    throw new Error(`Order not found: Order '${targetOrderId}' does not exist or has expired`);
  }

  // 3. Validate Order Ownership & Lifecycle Status
  if (String(order.userId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Access denied: You do not have permission to execute payment on this order');
  }

  if (order.status === 'paid') {
    res.status(409);
    throw new Error('Duplicate transaction: This order has already been verified and settled');
  }

  // 4. Resolve Trusted Amount (Strictly from order.pricing.total)
  const trustedAmount = order.pricing.total;
  if (amount !== undefined && Math.abs(parseFloat(amount) - trustedAmount) > 0.05) {
    res.status(400);
    throw new Error(
      `Price tampering detected: Submitted amount ₹${amount} does not match verified server order total ₹${trustedAmount}. Transaction rejected.`
    );
  }

  // 5. Gateway Cryptographic HMAC Verification when live Razorpay secret is present
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

  // 6. Load or Create User Wallet
  let wallet = await Wallet.findOne({ userId: req.user._id });
  if (!wallet) {
    wallet = new Wallet({ userId: req.user._id, balance: 0.0, transactions: [] });
  }

  // 7. Prevent duplicate transaction replay attacks
  const alreadyProcessed = wallet.transactions.some(
    (tx) => tx.paymentId && tx.paymentId === effectivePaymentId
  );
  if (alreadyProcessed) {
    res.status(409);
    throw new Error('Duplicate transaction: This payment has already been credited to your wallet.');
  }

  const now = new Date();
  const dateStr = `${now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  let newTx = null;
  if (order.type === 'wallet_recharge') {
    newTx = {
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
  } else {
    // Product or plan checkout
    newTx = {
      amount: trustedAmount,
      type: 'purchase',
      description: `Payment for ${order.items.map((i) => i.name).join(', ') || 'CRM Products'}`,
      paymentId: effectivePaymentId,
      status: 'completed',
      date: dateStr,
      createdAt: now,
    };
    wallet.transactions.unshift(newTx);
    await wallet.save();
  }

  // 8. Mark Order as Paid
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

  // 9. Sync User model balance
  await User.findByIdAndUpdate(req.user._id, {
    balance: `₹${wallet.balance.toFixed(1)}`,
  }).catch(() => {});

  res.json({
    success: true,
    balance: wallet.balance,
    amountProcessed: trustedAmount,
    message:
      order.type === 'wallet_recharge'
        ? `₹${trustedAmount.toLocaleString()} credited to your CRM wallet successfully!`
        : `Payment of ₹${trustedAmount.toLocaleString()} verified for order '${order.orderId}'.`,
    transaction: newTx,
    order,
    wallet,
  });
});

// @desc    Pay for a checkout order using CRM Wallet Balance
// @route   POST /api/wallet/pay-with-wallet
// @access  Private
const payWithWallet = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    res.status(400);
    throw new Error('Order ID is required to process wallet payment');
  }

  const order = await Order.findOne({ orderId });
  if (!order) {
    res.status(404);
    throw new Error(`Order '${orderId}' not found`);
  }

  if (String(order.userId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Access denied: You do not own this order');
  }

  if (order.status === 'paid') {
    res.status(409);
    throw new Error('Order has already been paid and fulfilled');
  }

  const requiredAmount = order.pricing.total;

  let wallet = await Wallet.findOne({ userId: req.user._id });
  if (!wallet || wallet.balance < requiredAmount) {
    res.status(400);
    throw new Error(
      `Insufficient wallet balance: Order total is ₹${requiredAmount.toFixed(2)}, but available balance is ₹${(wallet?.balance || 0).toFixed(2)}`
    );
  }

  const now = new Date();
  const dateStr = `${now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // Deduct from wallet
  wallet.balance -= requiredAmount;
  const newTx = {
    amount: requiredAmount,
    type: 'debit',
    description: `Order payment: ${order.items.map((i) => i.name).join(', ') || order.type}`,
    paymentId: `wt_${order.orderId}`,
    status: 'completed',
    date: dateStr,
    createdAt: now,
  };
  wallet.transactions.unshift(newTx);
  await wallet.save();

  // Mark order paid
  order.status = 'paid';
  order.paymentDetails = {
    paymentMethod: 'Wallet Balance',
    paymentId: `wt_${order.orderId}`,
    paidAt: now,
  };
  await order.save();

  await User.findByIdAndUpdate(req.user._id, {
    balance: `₹${wallet.balance.toFixed(1)}`,
  }).catch(() => {});

  res.json({
    success: true,
    message: `Payment of ₹${requiredAmount.toFixed(2)} completed successfully using wallet balance!`,
    balance: wallet.balance,
    order,
    transaction: newTx,
  });
});

// @desc    Get user's order history with pricing details
// @route   GET /api/wallet/orders
// @access  Private
const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({
    success: true,
    orders,
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
  payWithWallet,
  getOrders,
  getTransactions,
};

