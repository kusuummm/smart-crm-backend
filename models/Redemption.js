const mongoose = require('mongoose');

const redemptionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['coupon', 'referral', 'loyalty'],
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      default: null,
      index: true,
    },
    couponCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },
    orderId: {
      type: String,
      default: null,
      index: true,
    },
    referralCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    pointsSpent: {
      type: Number,
      default: 0,
    },
    rewardAmount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['completed', 'cancelled', 'refunded'],
      default: 'completed',
    },
    redeemedAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Compound Unique Indexes for Guaranteed Concurrency Safety
// 1. Referral: A user can only ever claim ONE referral reward
redemptionSchema.index(
  { userId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'referral' },
  }
);

// 2. Coupon on Order: Prevent double-applying the same coupon to the same order
redemptionSchema.index(
  { couponCode: 1, orderId: 1 },
  {
    unique: true,
    partialFilterExpression: { orderId: { $type: 'string' } },
  }
);

module.exports = mongoose.model('Redemption', redemptionSchema);
