const mongoose = require('mongoose');

const automationSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    channel: {
      type: String,
      enum: ['whatsapp', 'email', 'task', 'system'],
      default: 'whatsapp',
    },
    actionTitle: {
      type: String,
      default: 'SEND MESSAGE',
      trim: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Paused'],
      default: 'Active',
    },
    sendTo: {
      type: String,
      default: 'Customer',
      trim: true,
    },
    trigger: {
      type: String,
      required: true,
      trim: true,
    },
    messageText: {
      type: String,
      required: true,
    },
    successCount: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    lastTriggeredAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

automationSchema.index({ status: 1 });
automationSchema.index({ trigger: 1 });

module.exports = mongoose.model('Automation', automationSchema);
