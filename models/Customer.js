const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    alternateNumber: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },
    company: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    leadSource: {
      type: String,
      enum: ['Website', 'Referral', 'Social Media', 'Email Campaign', 'Cold Call', 'Trade Show', 'Other'],
      default: 'Other',
    },
    interestedProduct: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    assignedTelecaller: { type: String, default: '' }, // denormalized name for quick display
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

// Support global search by name, mobile, email, company, city
customerSchema.index({ name: 'text', mobile: 'text', email: 'text', company: 'text', city: 'text' });

module.exports = mongoose.model('Customer', customerSchema);
