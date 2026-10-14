const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    alternateNumber: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },
    company: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    leadSource: {
      type: String,
      default: 'Other',
      trim: true,
    },
    interestedProduct: { type: String, default: '' },
    status: { type: String, default: 'active', trim: true },
    assignedTelecaller: { type: String, default: '' }, // denormalized name for quick display
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

// Pre-validate hook: keep mobile and phone synchronized
customerSchema.pre('validate', function (next) {
  if (!this.mobile && this.phone) {
    this.mobile = this.phone;
  }
  if (!this.phone && this.mobile) {
    this.phone = this.mobile;
  }
  next();
});

// Support fast deduplication and lookup by mobile and phone
customerSchema.index({ mobile: 1 });
customerSchema.index({ phone: 1 });
customerSchema.index({ telecallerId: 1, createdAt: -1 });
customerSchema.index({ assignedTelecaller: 1 });
customerSchema.index({ status: 1 });
customerSchema.index({ createdAt: -1 });
// Support global search by name, mobile, email, company, city
customerSchema.index({ name: 'text', mobile: 'text', email: 'text', company: 'text', city: 'text' });

module.exports = mongoose.model('Customer', customerSchema);
