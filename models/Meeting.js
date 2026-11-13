const mongoose = require('mongoose');

const reminderStageSchema = new mongoose.Schema(
  {
    stage: { type: String, required: true }, // '3h', '2h', '90m', '60m', '30m', '0m'
    label: { type: String, default: '' },
    sentAt: { type: Date, default: Date.now },
    emailSent: { type: Boolean, default: false },
    whatsappSent: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: '', lowercase: true, trim: true },
    customerPhone: { type: String, default: '' },
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telecallerName: { type: String, required: true },
    telecallerEmail: { type: String, default: '', lowercase: true, trim: true },
    title: { type: String, required: true, default: 'Client Consultation & Demo' },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    meetingTime: { type: Date, required: true }, // Exact combined Date object
    duration: { type: String, default: '30 mins' },
    meetingLink: { type: String, default: '' },
    location: { type: String, default: 'Google Meet / Online Conference' },
    agenda: { type: String, default: '' },
    status: {
      type: String,
      default: 'scheduled',
    },
    // Multi-stage Reminder Cadence: 3h -> 2h (after 1h) -> 90m (after 30m) -> 60m (after 30m) -> 30m (after 30m) -> 0m (starting now)
    reminderStagesSent: [reminderStageSchema],
    lastReminderStage: { type: String, default: '' },
    lastReminderSentAt: { type: Date, default: null },
    reminderSent: { type: Boolean, default: false }, // legacy backward compatibility
    reminderSentAt: { type: Date, default: null },
    confirmationSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// High-performance compound indexes for scheduler queries & timeline lookups
meetingSchema.index({ status: 1, meetingTime: 1 });
meetingSchema.index({ customerId: 1, meetingTime: -1 });
meetingSchema.index({ telecallerId: 1, meetingTime: -1 });
meetingSchema.index({ date: 1, time: 1 });
meetingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Meeting', meetingSchema);
