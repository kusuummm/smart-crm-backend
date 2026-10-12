const mongoose = require('mongoose');
require('dotenv').config();

const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const CallHistory = require('../models/CallHistory');
const Meeting = require('../models/Meeting');
const EmailLog = require('../models/EmailLog');
const WhatsAppLog = require('../models/WhatsAppLog');
const Note = require('../models/Note');
const Event = require('../models/Event');
const BroadcastCampaign = require('../models/BroadcastCampaign');
const Session = require('../models/Session');
const Otp = require('../models/Otp');
const User = require('../models/User');
const Wallet = require('../models/Wallet');

async function purgeData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB for purging dummy data...');

    // Delete dummy collections
    const delCustomers = await Customer.deleteMany({});
    console.log(`Deleted Customers: ${delCustomers.deletedCount}`);

    const delLeads = await Lead.deleteMany({});
    console.log(`Deleted Leads: ${delLeads.deletedCount}`);

    const delFollowUps = await FollowUp.deleteMany({});
    console.log(`Deleted FollowUps: ${delFollowUps.deletedCount}`);

    const delCallHistory = await CallHistory.deleteMany({});
    console.log(`Deleted CallHistories: ${delCallHistory.deletedCount}`);

    const delMeetings = await Meeting.deleteMany({});
    console.log(`Deleted Meetings: ${delMeetings.deletedCount}`);

    const delEmailLogs = await EmailLog.deleteMany({});
    console.log(`Deleted EmailLogs: ${delEmailLogs.deletedCount}`);

    const delWhatsAppLogs = await WhatsAppLog.deleteMany({});
    console.log(`Deleted WhatsAppLogs: ${delWhatsAppLogs.deletedCount}`);

    const delNotes = await Note.deleteMany({});
    console.log(`Deleted Notes: ${delNotes.deletedCount}`);

    const delEvents = await Event.deleteMany({});
    console.log(`Deleted Events: ${delEvents.deletedCount}`);

    const delCampaigns = await BroadcastCampaign.deleteMany({});
    console.log(`Deleted BroadcastCampaigns: ${delCampaigns.deletedCount}`);

    const delSessions = await Session.deleteMany({});
    console.log(`Deleted Sessions: ${delSessions.deletedCount}`);

    const delOtps = await Otp.deleteMany({});
    console.log(`Deleted Otps: ${delOtps.deletedCount}`);

    // Remove dummy caller agent, preserve admin and real user Kusum Rathore
    const delUsers = await User.deleteMany({ email: 'caller@crm.com' });
    console.log(`Deleted Dummy Users (caller@crm.com): ${delUsers.deletedCount}`);

    // Verify remaining users
    const remainingUsers = await User.find({}, 'name email role isApproved');
    console.log('Remaining Users:', remainingUsers);

    // Verify / Reset admin wallet
    const admin = await User.findOne({ email: 'admin@crm.com' });
    if (admin) {
      await Wallet.findOneAndUpdate(
        { userId: admin._id },
        { balance: 0.0, transactions: [] },
        { upsert: true, new: true }
      );
      console.log('Admin wallet verified/reset with balance 0.0');
    }

    console.log('--- PURGE COMPLETE ---');
    process.exit(0);
  } catch (error) {
    console.error('Error during purge:', error);
    process.exit(1);
  }
}

purgeData();
