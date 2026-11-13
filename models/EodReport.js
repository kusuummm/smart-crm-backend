const mongoose = require('mongoose');

const eodReportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userName: { type: String, required: true },
    userEmail: { type: String, default: '' },
    userRole: { type: String, default: 'member' },
    date: {
      type: String, // 'YYYY-MM-DD' format
      required: true,
      index: true,
    },
    // Daily Telephony & Performance Metrics
    callsMade: { type: Number, default: 0 },
    callsConnected: { type: Number, default: 0 },
    talkTime: { type: String, default: '0s' },
    leadsGenerated: { type: Number, default: 0 },
    dealsClosed: { type: Number, default: 0 },
    followUpsDone: { type: Number, default: 0 },
    meetingsScheduled: { type: Number, default: 0 },
    // Qualitative Reporting
    keyAchievements: { type: String, default: '' },
    challenges: { type: String, default: '' },
    planForTomorrow: { type: String, default: '' },
    // Status & Review
    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'draft'],
      default: 'submitted',
    },
    adminFeedback: { type: String, default: '' },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedByName: { type: String, default: '' },
    reviewedAt: { type: Date },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring one EOD submission per member per day
eodReportSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('EodReport', eodReportSchema);
