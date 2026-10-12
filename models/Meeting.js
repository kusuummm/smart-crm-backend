const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true },
    customerPhone: { type: String, default: '' },
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telecallerName: { type: String, required: true },
    telecallerEmail: { type: String, required: true, lowercase: true, trim: true },
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
      enum: ['scheduled', 'completed', 'cancelled', 'rescheduled'],
      default: 'scheduled',
    },
    reminderSent: { type: Boolean, default: false },
    reminderSentAt: { type: Date, default: null },
    confirmationSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Meeting', meetingSchema);
