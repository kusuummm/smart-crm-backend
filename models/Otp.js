const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
      trim: true,
    },
    purpose: {
      type: String,
      enum: ['register', 'forgot_password', 'change_password'],
      required: true,
      index: true,
    },
    metadata: {
      name: { type: String, trim: true },
      password: { type: String },
      phone: { type: String, default: '' },
      role: { type: String, default: 'telecaller' },
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  },
  { timestamps: true }
);

// Expire document automatically when expiresAt timestamp is reached
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
