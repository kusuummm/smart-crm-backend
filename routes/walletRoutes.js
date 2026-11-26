const express = require('express');
const router = express.Router();
const {
  getPricingCatalog,
  calculatePricing,
  getWallet,
  createOrder,
  rechargeWallet,
  getTransactions,
} = require('../controllers/walletController');
const { protect } = require('../middleware/auth');

router.use(protect);

// Trusted Pricing & Calculation Endpoints
router.get('/pricing/catalog', getPricingCatalog);
router.post('/calculate-pricing', calculatePricing);

// Wallet & Checkout Endpoints
router.get('/', getWallet);
router.post('/create-order', createOrder);
router.post('/recharge', rechargeWallet);
router.get('/transactions', getTransactions);

module.exports = router;
