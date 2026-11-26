const mongoose = require('mongoose');

// Schema for sensitive AI actions requiring explicit human confirmation
const aiActionConfirmationSchema = new mongoose.Schema(
  {
    actionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    toolName: {
      type: String,
      required: true,
    },
    parameters: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    authorizedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    confirmationToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    summary: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes TTL
    },
  },
  { timestamps: true }
);

// Auto-purge expired action confirmations
aiActionConfirmationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AiActionConfirmation', aiActionConfirmationSchema);
