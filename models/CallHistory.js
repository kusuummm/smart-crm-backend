const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, default: '' },
    callType: { type: String, default: 'Outgoing' },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    duration: { type: String, default: '0 mins' },
    status: { type: String, default: 'connected' },
    remarks: { type: String, default: '' },
    calledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    calledByName: { type: String, default: '' },
    recordingUrl: { type: String, default: '' },
    recordingDuration: { type: String, default: '' },
    recordingSize: { type: String, default: '' },
    waveform: [{ type: Number }],
    transcript: [
      {
        speaker: { type: String },
        role: { type: String, default: 'agent' },
        time: { type: String },
        text: { type: String },
      },
    ],
    aiSummary: {
      sentiment: { type: String, default: 'Neutral' },
      score: { type: Number, default: 85 },
      summary: { type: String, default: '' },
      keyPoints: [{ type: String }],
      followUps: [{ type: String }],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CallHistory', callHistorySchema);
