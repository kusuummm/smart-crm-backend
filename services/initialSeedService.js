const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const Application = require('../models/Application');
const FollowUp = require('../models/FollowUp');
const CallHistory = require('../models/CallHistory');
const WhatsAppLog = require('../models/WhatsAppLog');
const Wallet = require('../models/Wallet');

/**
 * Automatically seeds starter clients, leads, applications, and team members
 * if the database currently has 0 customers.
 * 
 * Safely preserves any existing Admin or registered user accounts.
 */
const seedInitialDataIfEmpty = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      console.log('[InitialSeedService] Production environment detected: Auto-seeding default credentials disabled.');
      return { seeded: false, reason: 'Auto-seeding default credentials disabled in production' };
    }

    const customerCount = await Customer.countDocuments();
    if (customerCount > 0) {
      // Database already has customers - no need to auto-seed
      return { seeded: false, count: customerCount };
    }

    console.log('[InitialSeedService] Database has 0 customers. Populating starter clients, leads, and applications...');
    return await seedDemoData();
  } catch (err) {
    console.error('[InitialSeedService] Error during auto-seeding:', err.message);
    return { seeded: false, error: err.message };
  }
};

/**
 * Seeds comprehensive, high-quality CRM demo data (Clients, Leads, Applications, Members)
 * without deleting or touching any existing admin accounts.
 */
const seedDemoData = async () => {
  // 1. Ensure Team Member Users exist
  let john = await User.findOne({ email: 'john@crm.com' });
  if (!john) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('john123', salt);
    john = await User.create({
      name: 'John Smith',
      email: 'john@crm.com',
      password: hash,
      role: 'member',
      status: 'active',
      isApproved: true,
      phone: '9876500001',
    });
  }

  let sarah = await User.findOne({ email: 'sarah@crm.com' });
  if (!sarah) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('sarah123', salt);
    sarah = await User.create({
      name: 'Sarah Wilson',
      email: 'sarah@crm.com',
      password: hash,
      role: 'member',
      status: 'active',
      isApproved: true,
      phone: '9876500002',
    });
  }

  // Find any existing admin user to associate admin activities
  let admin = await User.findOne({ role: { $in: ['admin', 'owner'] } });
  if (!admin) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('admin123', salt);
    admin = await User.create({
      name: 'Admin User',
      email: 'admin@crm.com',
      password: hash,
      role: 'admin',
      status: 'active',
      isApproved: true,
      phone: '9876500000',
    });
  }

  // Ensure Admin Wallet has balance
  if (admin) {
    await Wallet.findOneAndUpdate(
      { userId: admin._id },
      { $setOnInsert: { userId: admin._id, balance: 600 } },
      { upsert: true }
    ).catch(() => {});
  }

  // 2. Starter Customers (Diverse business & individual clients across India)
  const starterCustomers = [
    {
      name: 'Rahul Sharma',
      mobile: '9876543210',
      alternateNumber: '9876543211',
      email: 'rahul.sharma@example.com',
      company: 'Tech Solutions Pvt Ltd',
      city: 'Mumbai',
      state: 'Maharashtra',
      leadSource: 'Website',
      interestedProduct: 'CRM Software',
      status: 'active',
      isApproved: true,
      assignedTelecaller: john.name,
      telecallerId: john._id,
      remarks: 'Very interested in society membership & loan facility',
    },
    {
      name: 'Priya Patel',
      mobile: '9876543212',
      alternateNumber: '9876543213',
      email: 'priya.patel@example.com',
      company: 'Digital Marketing Hub',
      city: 'Ahmedabad',
      state: 'Gujarat',
      leadSource: 'Referral',
      interestedProduct: 'Fixed Deposit',
      status: 'active',
      isApproved: true,
      assignedTelecaller: sarah.name,
      telecallerId: sarah._id,
      remarks: 'Submitted initial membership form and KYC documents',
    },
    {
      name: 'Amit Kumar',
      mobile: '9876543214',
      alternateNumber: '9876543215',
      email: 'amit.kumar@example.com',
      company: 'StartupX Logistics',
      city: 'Bangalore',
      state: 'Karnataka',
      leadSource: 'Social Media',
      interestedProduct: 'Cooperative Loan',
      status: 'active',
      isApproved: true,
      assignedTelecaller: john.name,
      telecallerId: john._id,
      remarks: 'Looking for society registration and fleet financing',
    },
    {
      name: 'Sneha Gupta',
      mobile: '9876543216',
      alternateNumber: '9876543217',
      email: 'sneha.gupta@example.com',
      company: 'Gupta Handicrafts',
      city: 'Jaipur',
      state: 'Rajasthan',
      leadSource: 'Campaign',
      interestedProduct: 'Micro Finance',
      status: 'active',
      isApproved: true,
      assignedTelecaller: sarah.name,
      telecallerId: sarah._id,
      remarks: 'Requested urgent callback for MSME artisan loan',
    },
    {
      name: 'Vikram Malhotra',
      mobile: '9876543218',
      alternateNumber: '9876543219',
      email: 'vikram.m@example.com',
      company: 'Malhotra Enterprises',
      city: 'Delhi',
      state: 'Delhi',
      leadSource: 'Google Search',
      interestedProduct: 'Permanent Membership',
      status: 'active',
      isApproved: true,
      assignedTelecaller: john.name,
      telecallerId: john._id,
      remarks: 'Corporate membership application with complete documents',
    },
    {
      name: 'Ananya Das',
      mobile: '9876543220',
      alternateNumber: '9876543221',
      email: 'ananya.das@example.com',
      company: 'Bengal Silk Weavers',
      city: 'Kolkata',
      state: 'West Bengal',
      leadSource: 'Walk In',
      interestedProduct: 'Society Registration',
      status: 'active',
      isApproved: true,
      assignedTelecaller: sarah.name,
      telecallerId: sarah._id,
      remarks: 'Verified Aadhaar and trade license details',
    },
  ];

  const createdCustomers = [];
  for (const cData of starterCustomers) {
    const existing = await Customer.findOne({ mobile: cData.mobile });
    if (!existing) {
      const doc = await Customer.create(cData);
      createdCustomers.push(doc);
    } else {
      createdCustomers.push(existing);
    }
  }

  // 3. Corresponding Pipeline Leads
  const leadStatuses = ['converted', 'interested', 'contacted', 'new', 'negotiation', 'new'];
  for (let i = 0; i < createdCustomers.length; i++) {
    const cust = createdCustomers[i];
    const existingLead = await Lead.findOne({ customerId: cust._id });
    if (!existingLead) {
      await Lead.create({
        customerId: cust._id,
        customerName: cust.name,
        status: leadStatuses[i % leadStatuses.length],
        telecallerId: cust.telecallerId || null,
        history: [
          { status: 'new', date: new Date(Date.now() - 5 * 86400000), remark: 'Lead created from ' + cust.leadSource },
          { status: leadStatuses[i % leadStatuses.length], date: new Date(), remark: cust.remarks },
        ],
      });
    }
  }

  // 4. Starter Applications (Matching Admin Applications & Docs Table)
  if (createdCustomers.length >= 4) {
    const starterApps = [
      {
        applicationNumber: 'APP-2026-0001-8472',
        customerId: createdCustomers[0]._id,
        customerName: createdCustomers[0].name,
        customerMobile: createdCustomers[0].mobile,
        customerEmail: createdCustomers[0].email,
        applicationType: 'membership',
        status: 'approved',
        paymentStatus: 'completed',
        paymentAmount: 1100,
        paymentReference: 'UPI/20260312/98234',
        paymentDate: new Date('2026-03-12'),
        documents: [
          {
            name: 'Aadhaar Card Front & Back',
            type: 'aadhaar',
            fileUrl: '/uploads/documents/sample_aadhaar.pdf',
            fileName: 'aadhaar_rahul_sharma.pdf',
            fileSize: 420000,
            status: 'verified',
            remarks: 'Verified against UIDAI database',
          },
          {
            name: 'PAN Card Copy',
            type: 'pan',
            fileUrl: '/uploads/documents/sample_pan.pdf',
            fileName: 'pan_card_rahul.pdf',
            fileSize: 280000,
            status: 'verified',
          },
        ],
        finalCertificate: {
          certificateNumber: 'CERT-JINL-2026-00109',
          title: 'PeYug Society Permanent Membership Certificate',
          fileUrl: '/uploads/certificates/membership_cert_00109.pdf',
          fileName: 'membership_certificate_rahul_sharma.pdf',
          issuedDate: new Date('2026-03-15'),
          uploadedAt: new Date('2026-03-15'),
          uploadedBy: admin._id,
          uploadedByName: admin.name,
        },
        assignedTo: admin._id,
        assignedToName: admin.name,
        history: [
          { action: 'Application Created', performedByName: 'System', date: new Date('2026-03-10') },
          { action: 'Documents Verified', performedByName: admin.name, date: new Date('2026-03-14') },
          { action: 'Final Certificate Issued', performedByName: admin.name, date: new Date('2026-03-15') },
        ],
      },
      {
        applicationNumber: 'APP-2026-0002-3918',
        customerId: createdCustomers[1]._id,
        customerName: createdCustomers[1].name,
        customerMobile: createdCustomers[1].mobile,
        customerEmail: createdCustomers[1].email,
        applicationType: 'fixed_deposit',
        status: 'under_review',
        paymentStatus: 'pending',
        paymentAmount: 5000,
        documents: [
          {
            name: 'KYC Document Set',
            type: 'address_proof',
            fileUrl: '/uploads/documents/kyc_priya.pdf',
            fileName: 'kyc_proof.pdf',
            fileSize: 310000,
            status: 'submitted',
          },
        ],
        assignedTo: sarah._id,
        assignedToName: sarah.name,
        history: [
          { action: 'Application Created', performedByName: sarah.name, date: new Date('2026-03-11') },
          { action: 'Status changed to under_review', performedByName: admin.name, date: new Date('2026-03-12') },
        ],
      },
      {
        applicationNumber: 'APP-2026-0003-7124',
        customerId: createdCustomers[2]._id,
        customerName: createdCustomers[2].name,
        customerMobile: createdCustomers[2].mobile,
        customerEmail: createdCustomers[2].email,
        applicationType: 'cooperative_loan',
        status: 'pending_documents',
        paymentStatus: 'pending',
        paymentAmount: 2500,
        documents: [],
        remarks: 'Waiting for Bank Statement and Salary Slip upload',
        assignedTo: john._id,
        assignedToName: john.name,
        history: [
          { action: 'Application Created', performedByName: john.name, date: new Date('2026-03-12') },
        ],
      },
      {
        applicationNumber: 'APP-2026-0004-9218',
        customerId: createdCustomers[3]._id,
        customerName: createdCustomers[3].name,
        customerMobile: createdCustomers[3].mobile,
        customerEmail: createdCustomers[3].email,
        applicationType: 'society_registration',
        status: 'new',
        paymentStatus: 'pending',
        paymentAmount: 1500,
        documents: [],
        remarks: 'New society registration submission',
        assignedTo: sarah._id,
        assignedToName: sarah.name,
        history: [
          { action: 'Application Created', performedByName: 'Online Portal', date: new Date() },
        ],
      },
    ];

    for (const appData of starterApps) {
      const exists = await Application.findOne({ applicationNumber: appData.applicationNumber });
      if (!exists) {
        await Application.create(appData);
      }
    }
  }

  // 5. Follow-ups & Task Schedules
  const today = new Date().toISOString().split('T')[0];
  if (createdCustomers.length > 0) {
    const existingFup = await FollowUp.findOne({ customerId: createdCustomers[0]._id });
    if (!existingFup) {
      await FollowUp.create({
        customerId: createdCustomers[0]._id,
        customerName: createdCustomers[0].name,
        date: today,
        time: '14:30',
        remarks: 'Conduct membership onboarding call and verify address proof',
        nextFollowUp: '',
        status: 'pending',
        priority: 'high',
        createdBy: john._id,
        createdByName: john.name,
      });
    }
  }

  console.log(`[InitialSeedService] Successfully seeded demo data: ${createdCustomers.length} clients, ${createdCustomers.length} leads!`);
  return {
    seeded: true,
    totalClients: await Customer.countDocuments(),
    totalLeads: await Lead.countDocuments(),
    totalApplications: await Application.countDocuments(),
  };
};

module.exports = {
  seedInitialDataIfEmpty,
  seedDemoData,
};
