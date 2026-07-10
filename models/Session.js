const mongoose = require('mongoose');

// One document per active login (one per device/browser). The JWT carries
// a matching `sid` claim, so we can tell which row is "this device" and can
// revoke a specific session by deleting its row - protect() checks this
// collection on every request, so a revoked session actually stops working
// immediately rather than just disappearing from the UI.
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenId: { type: String, required: true, unique: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true } // createdAt = login time
);

module.exports = mongoose.model('Session', sessionSchema);
