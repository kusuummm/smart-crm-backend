const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const res = await User.updateMany(
    { email: { $in: ['admin@crm.com', 'caller@crm.com'] } },
    { $set: { isApproved: true, status: 'active' } }
  );
  console.log('Update result:', res);
  const users = await User.find({}, 'name email role status isApproved');
  console.log('Users now:', users);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
