const express = require('express');
const router = express.Router();
const { getWallet, rechargeWallet } = require('../controllers/walletController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getWallet);
router.post('/recharge', rechargeWallet);

module.exports = router;
