const mongoose = require('mongoose');

const automationLogSchema = new mongoose.Schema(
  {
    automationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Automation',
      required: false,
    },
    automationKey: {
      type: String,
      default: '',
    },
    automationName: {
      type: String,
      required: true,
    },
    channel: {
      type: String,
      default: 'whatsapp',
    },
    action: {
      type: String,
      default: 'SEND MESSAGE',
    },
    trigger: {
      type: String,
      default: 'missed_call',
    },
    targetPerson: {
      type: String,
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    status: {
      type: String,
      enum: ['Success', 'Failed'],
      default: 'Success',
    },
    error: {
      type: String,
      default: '',
    },
    details: {
      type: String,
      default: '',
    },
    date: {
      type: String,
      default: () =>
        new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
    },
    time: {
      type: String,
      default: () =>
        new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).toLowerCase(),
    },
  },
  { timestamps: true }
);

automationLogSchema.index({ automationId: 1, createdAt: -1 });
automationLogSchema.index({ automationKey: 1, createdAt: -1 });
automationLogSchema.index({ status: 1 });
automationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AutomationLog', automationLogSchema);
