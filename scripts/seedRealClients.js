const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    alternateNumber: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },
    company: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    leadSource: { type: String, default: 'Other' },
    interestedProduct: { type: String, default: '' },
    status: { type: String, default: 'active' },
    assignedTelecaller: { type: String, default: '' },
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

const leadSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    status: { type: String, default: 'new' },
    telecallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    history: { type: Array, default: [] },
  },
  { timestamps: true }
);

const callHistorySchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, default: '' },
    date: { type: String, required: true },
    time: { type: String, required: true },
    duration: { type: String, default: '0 mins' },
    status: { type: String, default: 'connected' },
    remarks: { type: String, default: '' },
    calledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    calledByName: { type: String, default: '' },
    recordingUrl: { type: String, default: '' },
    recordingDuration: { type: String, default: '' },
    recordingSize: { type: String, default: '' },
    waveform: [{ type: Number }],
    transcript: [{ type: Object }],
    aiSummary: { type: Object, default: {} },
  },
  { timestamps: true }
);

const followUpSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    remarks: { type: String, default: '' },
    nextFollowUp: { type: String, default: '' },
    status: { type: String, default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const Customer = mongoose.model('Customer', customerSchema);
  const Lead = mongoose.model('Lead', leadSchema);
  const CallHistory = mongoose.model('CallHistory', callHistorySchema);
  const FollowUp = mongoose.model('FollowUp', followUpSchema);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  // Find active telecallers
  const telecallers = await User.find({ role: 'telecaller', status: 'active' });
  console.log('Found telecallers:', telecallers.map(t => `${t.name} (${t._id})`));

  if (telecallers.length === 0) {
    console.log('No telecallers found.');
    process.exit(1);
  }

  const caller1 = telecallers[0]; // e.g. Caller Agent
  const caller2 = telecallers.length > 1 ? telecallers[1] : telecallers[0]; // e.g. Kusum Rathore

  // 1. Delete legacy test records with 'Private Client'
  const delCust = await Customer.deleteMany({ name: { $regex: /private client/i } });
  const delLead = await Lead.deleteMany({ customerName: { $regex: /private client/i } });
  console.log(`Deleted ${delCust.deletedCount} legacy test customers and ${delLead.deletedCount} legacy test leads.`);

  // 2. Real clients data
  const realClients = [
    {
      name: 'Rahul Sharma',
      mobile: '9876543210',
      alternateNumber: '9876543211',
      email: 'rahul.sharma@techinnovations.in',
      company: 'Tech Innovations Pvt Ltd',
      city: 'Mumbai',
      state: 'Maharashtra',
      leadSource: 'Website',
      interestedProduct: 'Enterprise CRM Suite',
      status: 'active',
      telecaller: caller1,
      remarks: 'Interested in CRM for 25 sales reps. Demo scheduled.',
      leadStatus: 'interested',
    },
    {
      name: 'Priya Patel',
      mobile: '9876543212',
      alternateNumber: '9876543213',
      email: 'priya.patel@horizonlogistics.com',
      company: 'Horizon Logistics Ltd',
      city: 'Ahmedabad',
      state: 'Gujarat',
      leadSource: 'Referral',
      interestedProduct: 'Cloud Telephony & IVR',
      status: 'active',
      telecaller: caller1,
      remarks: 'Needs IVR call routing and automated SMS notifications.',
      leadStatus: 'contacted',
    },
    {
      name: 'Vikram Malhotra',
      mobile: '9876543214',
      alternateNumber: '9876543215',
      email: 'vikram.malhotra@apexrealestate.in',
      company: 'Apex Real Estate Hub',
      city: 'New Delhi',
      state: 'Delhi',
      leadSource: 'Cold Call',
      interestedProduct: 'Lead Management & WhatsApp API',
      status: 'active',
      telecaller: caller1,
      remarks: 'High potential real estate broker. Proposal shared.',
      leadStatus: 'follow-up',
    },
    {
      name: 'Sneha Reddy',
      mobile: '9876543216',
      alternateNumber: '9876543217',
      email: 'sneha.reddy@cloudscale.io',
      company: 'CloudScale Technologies',
      city: 'Hyderabad',
      state: 'Telangana',
      leadSource: 'Email Campaign',
      interestedProduct: 'Team Dialer & Auto Recording',
      status: 'active',
      telecaller: caller1,
      remarks: 'Budget approved for annual tier. Ready to onboard.',
      leadStatus: 'converted',
    },
    {
      name: 'Amit Verma',
      mobile: '9876543218',
      alternateNumber: '9876543219',
      email: 'amit.verma@nextgensolutions.in',
      company: 'NextGen Solutions',
      city: 'Bangalore',
      state: 'Karnataka',
      leadSource: 'Website',
      interestedProduct: 'Smart CRM Starter Package',
      status: 'active',
      telecaller: caller2,
      remarks: 'Requested custom trial credentials for 5 agent seats.',
      leadStatus: 'interested',
    },
    {
      name: 'Neha Gupta',
      mobile: '9876543220',
      alternateNumber: '9876543221',
      email: 'neha.gupta@bluestarpharma.com',
      company: 'BlueStar Healthcare Pvt Ltd',
      city: 'Pune',
      state: 'Maharashtra',
      leadSource: 'Trade Show',
      interestedProduct: 'Enterprise CRM Suite',
      status: 'active',
      telecaller: caller2,
      remarks: 'Met at Pharma Summit. High priority enterprise account.',
      leadStatus: 'new',
    },
    {
      name: 'Rajesh Nair',
      mobile: '9876543222',
      alternateNumber: '9876543223',
      email: 'rajesh.nair@omniecommerce.in',
      company: 'Omni Retail Solutions',
      city: 'Chennai',
      state: 'Tamil Nadu',
      leadSource: 'Social Media',
      interestedProduct: 'WhatsApp Broadcast & AI Bot',
      status: 'active',
      telecaller: caller2,
      remarks: 'Interested in abandoned cart recovery and WhatsApp CRM.',
      leadStatus: 'contacted',
    },
    {
      name: 'Ananya Sen',
      mobile: '9876543224',
      alternateNumber: '9876543225',
      email: 'ananya.sen@stellarfinance.in',
      company: 'Stellar Wealth & Finance',
      city: 'Kolkata',
      state: 'West Bengal',
      leadSource: 'Referral',
      interestedProduct: 'Compliance Call Recording & CRM',
      status: 'active',
      telecaller: caller2,
      remarks: 'Mandatory 100% call recording required by audit team.',
      leadStatus: 'follow-up',
    },
  ];

  for (const client of realClients) {
    let cust = await Customer.findOne({ mobile: client.mobile });
    if (!cust) {
      cust = await Customer.create({
        name: client.name,
        mobile: client.mobile,
        alternateNumber: client.alternateNumber,
        email: client.email,
        company: client.company,
        city: client.city,
        state: client.state,
        leadSource: client.leadSource,
        interestedProduct: client.interestedProduct,
        status: client.status,
        assignedTelecaller: client.telecaller.name,
        telecallerId: client.telecaller._id,
        remarks: client.remarks,
      });
      console.log(`Created customer: ${cust.name} (${cust.mobile}) assigned to ${cust.assignedTelecaller}`);
    } else {
      cust.name = client.name;
      cust.email = client.email;
      cust.company = client.company;
      cust.assignedTelecaller = client.telecaller.name;
      cust.telecallerId = client.telecaller._id;
      cust.remarks = client.remarks;
      await cust.save();
      console.log(`Updated customer: ${cust.name} (${cust.mobile})`);
    }

    // Ensure Lead exists
    let lead = await Lead.findOne({ customerId: cust._id });
    if (!lead) {
      lead = await Lead.create({
        customerId: cust._id,
        customerName: cust.name,
        status: client.leadStatus,
        telecallerId: client.telecaller._id,
        history: [
          {
            status: 'new',
            date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            remark: 'Lead created via ' + client.leadSource,
            updatedBy: client.telecaller._id,
          },
          {
            status: client.leadStatus,
            date: new Date(),
            remark: client.remarks,
            updatedBy: client.telecaller._id,
          },
        ],
      });
      console.log(`Created lead for ${cust.name} with stage ${client.leadStatus}`);
    } else {
      lead.customerName = cust.name;
      lead.telecallerId = client.telecaller._id;
      lead.status = client.leadStatus;
      await lead.save();
    }

    // Create a realistic Call History record
    const existingCall = await CallHistory.findOne({ customerId: cust._id });
    if (!existingCall) {
      await CallHistory.create({
        customerId: cust._id,
        customerName: cust.name,
        customerPhone: cust.mobile,
        date: new Date().toISOString().split('T')[0],
        time: '11:30',
        duration: '4m 12s',
        status: 'connected',
        remarks: `Discussed ${client.interestedProduct} requirements. Client is positive.`,
        calledBy: client.telecaller._id,
        calledByName: client.telecaller.name,
        recordingDuration: '4m 12s',
        waveform: [20, 45, 60, 30, 80, 95, 40, 50, 75, 60, 30, 40, 85, 90, 35, 60, 40, 30, 50, 80],
        transcript: [
          { speaker: client.telecaller.name, role: 'agent', time: '00:02', text: `Hello Mr./Ms. ${cust.name}, this is ${client.telecaller.name} from Smart CRM.` },
          { speaker: cust.name, role: 'customer', time: '00:10', text: `Hi! Yes, I was looking for ${client.interestedProduct}. Can you explain how it works?` },
          { speaker: client.telecaller.name, role: 'agent', time: '00:25', text: `Absolutely, our platform integrates automated dialers, WhatsApp notifications, and lead tracking in real time.` },
        ],
        aiSummary: {
          sentiment: 'Positive',
          score: 91,
          summary: `Call completed with ${cust.name}. Highly interested in ${client.interestedProduct}.`,
          keyPoints: ['Enterprise solution inquiry', 'Needs multi-agent support', 'Follow-up requested'],
        },
      });
      console.log(`Created call history for ${cust.name}`);
    }

    // Create Follow-up
    const existingFollowUp = await FollowUp.findOne({ customerId: cust._id });
    if (!existingFollowUp) {
      await FollowUp.create({
        customerId: cust._id,
        customerName: cust.name,
        date: new Date().toISOString().split('T')[0],
        time: '15:00',
        remarks: `Follow up on proposal sent for ${client.interestedProduct}`,
        nextFollowUp: 'Tomorrow, 11:00 AM',
        status: 'pending',
        createdBy: client.telecaller._id,
        createdByName: client.telecaller.name,
      });
      console.log(`Created follow-up for ${cust.name}`);
    }
  }

  const finalCustCount = await Customer.countDocuments();
  const finalLeadCount = await Lead.countDocuments();
  const finalCallCount = await CallHistory.countDocuments();
  console.log(`\nMigration completed successfully!`);
  console.log(`Total Customers in DB: ${finalCustCount}`);
  console.log(`Total Leads in DB: ${finalLeadCount}`);
  console.log(`Total Call Histories in DB: ${finalCallCount}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
