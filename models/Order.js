const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    basePrice: { type: Number, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

const orderPricingSchema = new mongoose.Schema(
  {
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    promoCode: { type: String, default: null },
    taxableAmount: { type: Number, required: true },
    taxRate: { type: Number, default: 0.18 }, // Standard India GST 18%
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['wallet_recharge', 'plan_subscription', 'addon_purchase', 'application_fee'],
      default: 'wallet_recharge',
      index: true,
    },
    items: [orderItemSchema],
    pricing: {
      type: orderPricingSchema,
      required: true,
    },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'cancelled'],
      default: 'created',
      index: true,
    },
    paymentDetails: {
      paymentMethod: { type: String, default: '' },
      paymentId: { type: String, default: '' },
      razorpayOrderId: { type: String, default: '' },
      razorpayPaymentId: { type: String, default: '' },
      razorpaySignature: { type: String, default: '' },
      paidAt: { type: Date, default: null },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
