const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    company: { type: String, default: '' },
    type: { type: String, default: 'CALL' },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    remarks: { type: String, default: '' },
    nextFollowUp: { type: String, default: '' }, // 'YYYY-MM-DD'
    status: { type: String, default: 'pending', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedToName: { type: String, default: '' },
    priority: { type: String, default: 'medium' },
    leadStatus: { type: String, default: '' },
    dealValue: { type: Number, default: 0 },
    reminderBefore: { type: String, default: '15 mins before' },
    meetingLink: { type: String, default: '' },
    tags: [{ type: String }],
    checklist: [
      {
        text: { type: String, default: '' },
        completed: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('FollowUp', followUpSchema);
