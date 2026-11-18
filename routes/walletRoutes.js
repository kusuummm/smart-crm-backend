const express = require('express');
const router = express.Router();
const {
  getWallet,
  createOrder,
  rechargeWallet,
  getTransactions,
} = require('../controllers/walletController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getWallet);
router.post('/create-order', createOrder);
router.post('/recharge', rechargeWallet);
router.get('/transactions', getTransactions);

module.exports = router;
