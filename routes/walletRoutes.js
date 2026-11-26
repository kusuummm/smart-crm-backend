const express = require('express');
const router = express.Router();
const {
  getPricingCatalog,
  calculatePricing,
  getWallet,
  createOrder,
  rechargeWallet,
  payWithWallet,
  getOrders,
  getTransactions,
  handleRazorpayWebhook,
} = require('../controllers/walletController');
const { protect } = require('../middleware/auth');

// Public Gateway Webhooks (Verified via x-razorpay-signature HMAC)
router.post('/webhook/razorpay', handleRazorpayWebhook);

// Protected Wallet & Checkout Endpoints
router.use(protect);

// Trusted Pricing & Calculation Endpoints
router.get('/pricing/catalog', getPricingCatalog);
router.post('/calculate-pricing', calculatePricing);

// Wallet & Checkout Endpoints
router.get('/', getWallet);
router.post('/create-order', createOrder);
router.post('/recharge', rechargeWallet);
router.post('/pay-with-wallet', payWithWallet);
router.get('/orders', getOrders);
router.get('/transactions', getTransactions);

module.exports = router;
