const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    teamName: { type: String, default: 'Main Team' },
    sfNumber: { type: String, default: '+91 99999 88888' },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
    },
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CallHistory',
    },
    dateOfCreation: {
      type: String,
      default: () =>
        `${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    },
    noteShort: { type: String, default: '' },
    noteFull: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdByName: { type: String, default: 'Agent' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Note', noteSchema);
