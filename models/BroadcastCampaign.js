const mongoose = require('mongoose');

const recipientSchema = new mongoose.Schema({
  name: { type: String, default: 'Customer' },
  phone: { type: String, required: true },
  status: {
    type: String,
    enum: ['Queued', 'Sent', 'Delivered', 'Read', 'Replied', 'Answered', 'Failed'],
    default: 'Sent',
  },
  time: { type: String, default: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
  error: { type: String, default: '' },
});

const broadcastCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    channel: {
      type: String,
      enum: ['whatsapp', 'voice', 'sms'],
      default: 'whatsapp',
    },
    org: { type: String, default: 'Main Organization' },
    audience: { type: String, default: 'All Contacts' },
    audienceCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 },
    repliedCount: { type: Number, default: 0 },
    deliveredRate: { type: String, default: '100%' },
    readRate: { type: String, default: '0%' },
    status: {
      type: String,
      enum: ['Draft', 'Sending', 'Completed', 'Paused', 'Failed'],
      default: 'Completed',
    },
    date: {
      type: String,
      default: () => new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    },
    messagePreview: { type: String, default: '' },
    recipients: [recipientSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdByName: { type: String, default: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BroadcastCampaign', broadcastCampaignSchema);
