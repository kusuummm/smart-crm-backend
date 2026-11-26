/**
 * Reward, Coupon, Referral & Loyalty Service
 * 
 * Provides:
 * 1. Atomic coupon redemption with global & per-user usage limits and expiration checks
 * 2. Concurrency-safe referral claims with self-referral prevention and uniqueness constraints
 * 3. Atomic loyalty point deductions preventing race conditions and double-spending
 */
const Coupon = require('../models/Coupon');
const Redemption = require('../models/Redemption');
const LoyaltyAccount = require('../models/LoyaltyAccount');
const Wallet = require('../models/Wallet');
const User = require('../models/User');

/**
 * Seed initial coupons into database if empty
 */
async function seedCoupons() {
  const count = await Coupon.countDocuments();
  if (count > 0) return;

  const now = new Date();
  const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const defaultCoupons = [
    {
      code: 'WELCOME10',
      description: '10% off for new customers up to ₹1,500',
      discountType: 'percentage',
      discountValue: 10,
      maxDiscount: 1500,
      minOrderAmount: 1000,
      usageLimit: 1000,
      perUserLimit: 1,
      validFrom: now,
      validUntil: oneYearLater,
      isActive: true,
    },
    {
      code: 'ANNUAL20',
      description: '20% off on annual plans up to ₹3,000',
      discountType: 'percentage',
      discountValue: 20,
      maxDiscount: 3000,
      minOrderAmount: 10000,
      usageLimit: 500,
      perUserLimit: 1,
      validFrom: now,
      validUntil: oneYearLater,
      isActive: true,
    },
    {
      code: 'FESTIVE500',
      description: 'Flat ₹500 discount on orders above ₹2,000',
      discountType: 'flat',
      discountValue: 500,
      maxDiscount: 500,
      minOrderAmount: 2000,
      usageLimit: 200,
      perUserLimit: 1,
      validFrom: now,
      validUntil: oneYearLater,
      isActive: true,
    },
    {
      code: 'LIMITED50',
      description: 'Flash sale ₹50 discount with strict 5-user limit',
      discountType: 'flat',
      discountValue: 50,
      maxDiscount: 50,
      minOrderAmount: 200,
      usageLimit: 5,
      perUserLimit: 1,
      validFrom: now,
      validUntil: oneYearLater,
      isActive: true,
    },
  ];

  await Coupon.insertMany(defaultCoupons).catch(() => {});
}

/**
 * Validates coupon eligibility, limits, and expiration without redeeming.
 */
async function validateCoupon({ code, userId, orderAmount }) {
  if (!code || typeof code !== 'string') {
    const error = new Error('Coupon code is required');
    error.statusCode = 400;
    throw error;
  }

  const cleanCode = code.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code: cleanCode });

  if (!coupon) {
    const error = new Error(`Invalid coupon code: "${cleanCode}"`);
    error.statusCode = 400;
    throw error;
  }

  if (!coupon.isActive) {
    const error = new Error(`Coupon "${cleanCode}" is deactivated and can no longer be used`);
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();
  if (now < coupon.validFrom) {
    const error = new Error(`Coupon "${cleanCode}" promotion has not started yet`);
    error.statusCode = 400;
    throw error;
  }

  if (now > coupon.validUntil) {
    const error = new Error(`Coupon "${cleanCode}" expired on ${coupon.validUntil.toLocaleDateString()}`);
    error.statusCode = 400;
    throw error;
  }

  const numAmount = parseFloat(orderAmount) || 0;
  if (numAmount < coupon.minOrderAmount) {
    const error = new Error(
      `Coupon "${cleanCode}" requires a minimum order subtotal of ₹${coupon.minOrderAmount}. Current subtotal is ₹${numAmount.toFixed(2)}`
    );
    error.statusCode = 400;
    throw error;
  }

  // Global usage limit check
  if (coupon.usageLimit !== null && coupon.timesRedeemed >= coupon.usageLimit) {
    const error = new Error(`Coupon "${cleanCode}" has reached its maximum global redemption limit`);
    error.statusCode = 400;
    throw error;
  }

  // Per-user redemption limit check
  if (userId) {
    const userRedemptions = await Redemption.countDocuments({
      couponId: coupon._id,
      userId,
      status: 'completed',
    });

    if (userRedemptions >= coupon.perUserLimit) {
      const error = new Error(
        `You have already redeemed coupon "${cleanCode}" the maximum allowed times (${coupon.perUserLimit})`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  // Compute authorized discount
  let discount = 0;
  if (coupon.discountType === 'percentage') {
    discount = (numAmount * coupon.discountValue) / 100;
    if (coupon.maxDiscount !== null) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else if (coupon.discountType === 'flat') {
    discount = coupon.discountValue;
  }
  discount = Math.min(discount, numAmount);
  discount = Math.round(discount * 100) / 100;

  return {
    valid: true,
    coupon,
    discount,
  };
}

/**
 * Atomically redeems a coupon on an order, preventing concurrent over-redemption.
 */
async function redeemCouponAtomically({ code, userId, orderId, orderAmount }) {
  // 1. Initial Validation
  const validation = await validateCoupon({ code, userId, orderAmount });
  const { coupon, discount } = validation;
  const cleanCode = coupon.code;
  const now = new Date();

  // 2. ATOMIC CONDITIONAL UPDATE on Coupon collection
  // Only increments if timesRedeemed < usageLimit AND active AND not expired
  const query = {
    _id: coupon._id,
    isActive: true,
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    $or: [
      { usageLimit: null },
      { $expr: { $lt: ['$timesRedeemed', '$usageLimit'] } },
    ],
  };

  const updatedCoupon = await Coupon.findOneAndUpdate(
    query,
    { $inc: { timesRedeemed: 1 } },
    { new: true }
  );

  if (!updatedCoupon) {
    const error = new Error(
      `Coupon "${cleanCode}" redemption failed: Usage limit was reached or coupon expired concurrently.`
    );
    error.statusCode = 400;
    throw error;
  }

  // 3. ATOMIC PER-USER LIMIT & ORDER UNIQUENESS CHECK
  // Create Redemption record with unique index protection
  let redemption;
  try {
    redemption = await Redemption.create({
      type: 'coupon',
      userId,
      couponId: updatedCoupon._id,
      couponCode: updatedCoupon.code,
      orderId: orderId || `order_${Date.now()}`,
      rewardAmount: discount,
      status: 'completed',
    });
  } catch (err) {
    // Roll back global redemption counter if insertion fails
    await Coupon.findByIdAndUpdate(updatedCoupon._id, { $inc: { timesRedeemed: -1 } });

    if (err.code === 11000) {
      const error = new Error(`Coupon "${cleanCode}" has already been redeemed on order "${orderId}"`);
      error.statusCode = 409;
      throw error;
    }
    throw err;
  }

  return {
    success: true,
    coupon: updatedCoupon,
    discount,
    redemption,
  };
}

/**
 * Atomically claims a referral reward with uniqueness constraints and self-referral checks.
 */
async function claimReferralAtomically({ refereeUserId, referralCode }) {
  if (!referralCode || typeof referralCode !== 'string') {
    const error = new Error('Referral code is required');
    error.statusCode = 400;
    throw error;
  }

  const cleanCode = referralCode.trim().toUpperCase();

  // 1. Find Referrer
  const referrer = await User.findOne({ referralCode: cleanCode });
  if (!referrer) {
    const error = new Error(`Invalid referral code: "${cleanCode}"`);
    error.statusCode = 404;
    throw error;
  }

  // 2. Self-Referral Prevention
  if (String(referrer._id) === String(refereeUserId)) {
    const error = new Error('Self-referral is prohibited: You cannot claim your own referral code.');
    error.statusCode = 400;
    throw error;
  }

  // 3. Atomic Uniqueness Check via Compound Index { userId: 1, type: 'referral' }
  const refereeRewardAmount = 100; // ₹100 signup bonus for referee
  const referrerRewardAmount = 200; // ₹200 incentive for referrer

  let redemption;
  try {
    redemption = await Redemption.create({
      type: 'referral',
      userId: refereeUserId,
      referrerId: referrer._id,
      referralCode: cleanCode,
      rewardAmount: refereeRewardAmount,
      status: 'completed',
      metadata: {
        referrerRewardAmount,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      const error = new Error('Referral already claimed: Each account is only eligible to claim one referral reward.');
      error.statusCode = 409;
      throw error;
    }
    throw err;
  }

  // 4. Atomically Credit Referee Wallet
  let refereeWallet = await Wallet.findOne({ userId: refereeUserId });
  if (!refereeWallet) {
    refereeWallet = new Wallet({ userId: refereeUserId, balance: 0.0, transactions: [] });
  }
  const now = new Date();
  const dateStr = `${now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  refereeWallet.balance += refereeRewardAmount;
  refereeWallet.transactions.unshift({
    amount: refereeRewardAmount,
    type: 'credit',
    description: `Referral welcome bonus (Code: ${cleanCode})`,
    paymentId: `ref_referee_${Date.now()}`,
    status: 'completed',
    date: dateStr,
    createdAt: now,
  });
  await refereeWallet.save();
  await User.findByIdAndUpdate(refereeUserId, {
    balance: `₹${refereeWallet.balance.toFixed(1)}`,
    referredBy: referrer._id,
  }).catch(() => {});

  // 5. Atomically Credit Referrer Wallet
  let referrerWallet = await Wallet.findOne({ userId: referrer._id });
  if (!referrerWallet) {
    referrerWallet = new Wallet({ userId: referrer._id, balance: 0.0, transactions: [] });
  }
  referrerWallet.balance += referrerRewardAmount;
  referrerWallet.transactions.unshift({
    amount: referrerRewardAmount,
    type: 'credit',
    description: `Referral partner bonus for inviting new user`,
    paymentId: `ref_referrer_${Date.now()}`,
    status: 'completed',
    date: dateStr,
    createdAt: now,
  });
  await referrerWallet.save();
  await User.findByIdAndUpdate(referrer._id, {
    balance: `₹${referrerWallet.balance.toFixed(1)}`,
  }).catch(() => {});

  return {
    success: true,
    message: `Referral reward claimed successfully! ₹${refereeRewardAmount} credited to your wallet.`,
    refereeReward: refereeRewardAmount,
    referrerReward: referrerRewardAmount,
    referrerName: referrer.name,
    redemption,
  };
}

/**
 * Retrieves or initializes user's loyalty account.
 */
async function getLoyaltyAccount(userId) {
  let account = await LoyaltyAccount.findOne({ userId });
  if (!account) {
    account = await LoyaltyAccount.create({
      userId,
      points: 100, // 100 complimentary starter points
      lifetimeEarned: 100,
      lifetimeRedeemed: 0,
      tier: 'bronze',
      history: [
        {
          type: 'bonus',
          points: 100,
          balanceAfter: 100,
          description: 'Welcome loyalty bonus points',
        },
      ],
    });
  }
  return account;
}

/**
 * Earn loyalty points on eligible transactions.
 */
async function earnLoyaltyPoints({ userId, points, description, referenceId }) {
  const numPoints = parseInt(points, 10);
  if (!numPoints || numPoints <= 0) return null;

  const account = await LoyaltyAccount.findOneAndUpdate(
    { userId },
    {
      $inc: { points: numPoints, lifetimeEarned: numPoints },
      $push: {
        history: {
          type: 'earn',
          points: numPoints,
          balanceAfter: 0,
          description: description || `Earned ${numPoints} loyalty points`,
          referenceId: referenceId || '',
          createdAt: new Date(),
        },
      },
    },
    { upsert: true, new: true }
  );
  return account;
}

/**
 * Atomically redeems loyalty points for wallet cash balance.
 * Prevents race conditions and double-spending across concurrent requests.
 */
async function redeemLoyaltyPointsAtomically({ userId, pointsToRedeem, creditAmount, description }) {
  const points = parseInt(pointsToRedeem, 10);
  const credit = parseFloat(creditAmount);

  if (!points || points <= 0) {
    const error = new Error('Points to redeem must be greater than zero');
    error.statusCode = 400;
    throw error;
  }

  if (!credit || credit <= 0) {
    const error = new Error('Credit amount must be greater than zero');
    error.statusCode = 400;
    throw error;
  }

  // 1. ATOMIC CONDITIONAL UPDATE on LoyaltyAccount:
  // Strictly requires points >= pointsToRedeem
  const updatedAccount = await LoyaltyAccount.findOneAndUpdate(
    {
      userId,
      points: { $gte: points },
    },
    {
      $inc: {
        points: -points,
        lifetimeRedeemed: points,
      },
      $push: {
        history: {
          type: 'redeem',
          points: -points,
          balanceAfter: 0,
          description: description || `Redeemed ${points} points for ₹${credit.toFixed(2)} wallet credit`,
          referenceId: `loyalty_red_${Date.now()}`,
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!updatedAccount) {
    // Concurrency / balance failure
    const current = await LoyaltyAccount.findOne({ userId });
    const available = current ? current.points : 0;
    const error = new Error(
      `Insufficient loyalty points: Required ${points} points, but only ${available} available.`
    );
    error.statusCode = 400;
    throw error;
  }

  // 2. Credit User's Wallet
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    wallet = new Wallet({ userId, balance: 0.0, transactions: [] });
  }

  const now = new Date();
  const dateStr = `${now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const newTx = {
    amount: credit,
    type: 'credit',
    description: `Loyalty points redemption (${points} pts)`,
    paymentId: `loyalty_${Date.now()}`,
    status: 'completed',
    date: dateStr,
    createdAt: now,
  };

  wallet.balance += credit;
  wallet.transactions.unshift(newTx);
  await wallet.save();

  await User.findByIdAndUpdate(userId, {
    balance: `₹${wallet.balance.toFixed(1)}`,
  }).catch(() => {});

  // 3. Record in Redemption collection
  const redemption = await Redemption.create({
    type: 'loyalty',
    userId,
    pointsSpent: points,
    rewardAmount: credit,
    status: 'completed',
  });

  return {
    success: true,
    pointsRedeemed: points,
    creditAdded: credit,
    remainingPoints: updatedAccount.points,
    balance: wallet.balance,
    redemption,
  };
}

module.exports = {
  seedCoupons,
  validateCoupon,
  redeemCouponAtomically,
  claimReferralAtomically,
  getLoyaltyAccount,
  earnLoyaltyPoints,
  redeemLoyaltyPointsAtomically,
};
