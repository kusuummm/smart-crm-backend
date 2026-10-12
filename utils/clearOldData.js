require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User = require('../models/User');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const CallHistory = require('../models/CallHistory');
const EmailLog = require('../models/EmailLog');
const WhatsAppLog = require('../models/WhatsAppLog');
const Note = require('../models/Note');
const Event = require('../models/Event');
const BroadcastCampaign = require('../models/BroadcastCampaign');
const Session = require('../models/Session');
const Otp = require('../models/Otp');
const Wallet = require('../models/Wallet');

const clearAllOldData = async () => {
  await connectDB();
  console.log('--- PURGING OLD DATABASE DATA ---');

  const [
    custRes,
    leadRes,
    fuRes,
    callRes,
    emailRes,
    waRes,
    noteRes,
    eventRes,
    bcRes,
    sessRes,
    otpRes,
    walletRes,
    userRes
  ] = await Promise.all([
    Customer.deleteMany({}),
    Lead.deleteMany({}),
    FollowUp.deleteMany({}),
    CallHistory.deleteMany({}),
    EmailLog.deleteMany({}),
    WhatsAppLog.deleteMany({}),
    Note.deleteMany({}),
    Event.deleteMany({}),
    BroadcastCampaign.deleteMany({}),
    Session.deleteMany({}),
    Otp.deleteMany({}),
    Wallet.deleteMany({}),
    User.deleteMany({}),
  ]);

  console.log(`Deleted Customers: ${custRes.deletedCount}`);
  console.log(`Deleted Leads: ${leadRes.deletedCount}`);
  console.log(`Deleted FollowUps: ${fuRes.deletedCount}`);
  console.log(`Deleted Call Histories: ${callRes.deletedCount}`);
  console.log(`Deleted Email Logs: ${emailRes.deletedCount}`);
  console.log(`Deleted WhatsApp Logs: ${waRes.deletedCount}`);
  console.log(`Deleted Notes: ${noteRes.deletedCount}`);
  console.log(`Deleted Events: ${eventRes.deletedCount}`);
  console.log(`Deleted Broadcast Campaigns: ${bcRes.deletedCount}`);
  console.log(`Deleted Sessions: ${sessRes.deletedCount}`);
  console.log(`Deleted OTPs: ${otpRes.deletedCount}`);
  console.log(`Deleted Wallets: ${walletRes.deletedCount}`);
  console.log(`Deleted Users: ${userRes.deletedCount}`);

  // Create single fresh master Admin user so user can log in and add all new users/staff newly
  console.log('Creating fresh Master Admin user account...');
  const admin = await User.create({
    name: 'Admin User',
    email: 'admin@crm.com',
    password: 'admin123',
    role: 'admin',
    status: 'active',
    phone: '',
    balance: '₹0.0',
  });

  await Wallet.create({
    userId: admin._id,
    balance: 0.0,
    currency: 'INR',
    transactions: [],
  });

  console.log('--- DATABASE SUCCESSFULLY CLEARED ---');
  console.log(`Master Admin: admin@crm.com / admin123`);
  console.log('You can now log in and add all user data and team records newly.');

  await mongoose.connection.close();
  process.exit(0);
};

clearAllOldData().catch((err) => {
  console.error('Failed to clear old data:', err);
  process.exit(1);
});
