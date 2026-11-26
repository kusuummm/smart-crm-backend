const asyncHandler = require('express-async-handler');
const Coupon = require('../models/Coupon');
const Redemption = require('../models/Redemption');
const User = require('../models/User');
const {
  validateCoupon,
  redeemCouponAtomically,
  claimReferralAtomically,
  getLoyaltyAccount,
  redeemLoyaltyPointsAtomically,
} = require('../services/rewardService');

// @desc    Get all active public promotional coupons
// @route   GET /api/rewards/coupons
// @access  Private
const getCoupons = asyncHandler(async (req, res) => {
  const now = new Date();
  const coupons = await Coupon.find({
    isActive: true,
    validUntil: { $gte: now },
  }).sort({ discountValue: -1 });

  res.json({
    success: true,
    coupons,
  });
});

// @desc    Validate coupon code and compute authorized discount
// @route   POST /api/rewards/coupons/validate
// @access  Private
const validateCouponEndpoint = asyncHandler(async (req, res) => {
  const { code, amount } = req.body;

  try {
    const result = await validateCoupon({
      code,
      userId: req.user._id,
      orderAmount: amount,
    });

    res.json({
      success: true,
      valid: true,
      coupon: {
        code: result.coupon.code,
        description: result.coupon.description,
        discountType: result.coupon.discountType,
        discountValue: result.coupon.discountValue,
        minOrderAmount: result.coupon.minOrderAmount,
      },
      discount: result.discount,
      finalAmount: Math.max(0, parseFloat(amount || 0) - result.discount),
    });
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

// @desc    Atomically redeem coupon code on an order
// @route   POST /api/rewards/coupons/redeem
// @access  Private
const redeemCouponEndpoint = asyncHandler(async (req, res) => {
  const { code, orderId, amount } = req.body;

  try {
    const result = await redeemCouponAtomically({
      code,
      userId: req.user._id,
      orderId,
      orderAmount: amount,
    });

    res.json({
      success: true,
      message: `Coupon "${result.coupon.code}" redeemed successfully!`,
      discount: result.discount,
      redemption: result.redemption,
    });
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

// @desc    Get user's personal referral code & partner stats
// @route   GET /api/rewards/referral/code
// @access  Private
const getReferralCode = asyncHandler(async (req, res) => {
  let user = await User.findById(req.user._id);

  if (!user.referralCode) {
    const cleanPrefix = (user.name || 'USER').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    user.referralCode = `REF-${cleanPrefix}-${rand}`;
    await user.save();
  }

  // Count successful referrals
  const successfulReferrals = await Redemption.countDocuments({
    referrerId: user._id,
    type: 'referral',
    status: 'completed',
  });

  const referralEarnings = successfulReferrals * 200; // ₹200 per referral

  res.json({
    success: true,
    referralCode: user.referralCode,
    successfulReferrals,
    referralEarnings,
    rewardPerReferral: 200,
    refereeBonus: 100,
  });
});

// @desc    Atomically claim a referral code
// @route   POST /api/rewards/referral/claim
// @access  Private
const claimReferral = asyncHandler(async (req, res) => {
  const { referralCode } = req.body;

  try {
    const result = await claimReferralAtomically({
      refereeUserId: req.user._id,
      referralCode,
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

// @desc    Get user's loyalty rewards account & points history
// @route   GET /api/rewards/loyalty
// @access  Private
const getLoyalty = asyncHandler(async (req, res) => {
  const account = await getLoyaltyAccount(req.user._id);

  // Available rewards redemption tiers:
  // 500 points = ₹100 wallet credit
  // 1000 points = ₹250 wallet credit
  // 2000 points = ₹600 wallet credit
  const catalog = [
    { id: 'reward_100', points: 500, credit: 100, name: '₹100 CRM Wallet Credit' },
    { id: 'reward_250', points: 1000, credit: 250, name: '₹250 CRM Wallet Credit' },
    { id: 'reward_600', points: 2000, credit: 600, name: '₹600 CRM Wallet Credit' },
  ];

  res.json({
    success: true,
    account: {
      points: account.points,
      tier: account.tier,
      lifetimeEarned: account.lifetimeEarned,
      lifetimeRedeemed: account.lifetimeRedeemed,
      history: account.history.slice(-20).reverse(),
    },
    rewardsCatalog: catalog,
  });
});

// @desc    Atomically redeem loyalty points for wallet balance
// @route   POST /api/rewards/loyalty/redeem
// @access  Private
const redeemLoyalty = asyncHandler(async (req, res) => {
  const { rewardId } = req.body;

  const catalog = {
    reward_100: { points: 500, credit: 100 },
    reward_250: { points: 1000, credit: 250 },
    reward_600: { points: 2000, credit: 600 },
  };

  const selected = catalog[rewardId];
  if (!selected) {
    res.status(400);
    throw new Error('Invalid reward identifier selected');
  }

  try {
    const result = await redeemLoyaltyPointsAtomically({
      userId: req.user._id,
      pointsToRedeem: selected.points,
      creditAmount: selected.credit,
      description: `Redeemed ${selected.points} loyalty points for ₹${selected.credit} CRM balance`,
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

// @desc    Get user's complete reward & redemption history
// @route   GET /api/rewards/history
// @access  Private
const getRedemptionHistory = asyncHandler(async (req, res) => {
  const redemptions = await Redemption.find({ userId: req.user._id })
    .sort({ redeemedAt: -1 })
    .limit(50);

  res.json({
    success: true,
    redemptions,
  });
});

module.exports = {
  getCoupons,
  validateCouponEndpoint,
  redeemCouponEndpoint,
  getReferralCode,
  claimReferral,
  getLoyalty,
  redeemLoyalty,
  getRedemptionHistory,
};
