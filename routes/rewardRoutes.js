const express = require('express');
const router = express.Router();
const {
  getCoupons,
  validateCouponEndpoint,
  redeemCouponEndpoint,
  getReferralCode,
  claimReferral,
  getLoyalty,
  redeemLoyalty,
  getRedemptionHistory,
} = require('../controllers/rewardController');
const { protect } = require('../middleware/auth');

router.use(protect);

// Coupons
router.get('/coupons', getCoupons);
router.post('/coupons/validate', validateCouponEndpoint);
router.post('/coupons/redeem', redeemCouponEndpoint);

// Referrals
router.get('/referral/code', getReferralCode);
router.post('/referral/claim', claimReferral);

// Loyalty & Rewards
router.get('/loyalty', getLoyalty);
router.post('/loyalty/redeem', redeemLoyalty);

// History
router.get('/history', getRedemptionHistory);

module.exports = router;
