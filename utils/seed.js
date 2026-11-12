// Seeds the local database with demo data matching the frontend's mockData.js
// Run with: npm run seed
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const Application = require('../models/Application');
const WhatsAppLog = require('../models/WhatsAppLog');
const CallHistory = require('../models/CallHistory');

const seed = async () => {
  await connectDB();

  console.log('Clearing existing data...');
  await Promise.all([
    User.deleteMany(),
    Customer.deleteMany(),
    Lead.deleteMany(),
    FollowUp.deleteMany(),
    Application.deleteMany(),
    WhatsAppLog.deleteMany(),
    CallHistory.deleteMany(),
  ]);

  console.log('Creating users...');
  const admin = await User.create({
    name: 'Admin User',
    email: 'admin@crm.com',
    password: 'admin123',
    role: 'admin',
    status: 'active',
    isApproved: true,
  });
  const john = await User.create({
    name: 'John Smith',
    email: 'john@crm.com',
    password: 'john123',
    role: 'telecaller',
    status: 'active',
    isApproved: true,
  });
  const sarah = await User.create({
    name: 'Sarah Wilson',
    email: 'sarah@crm.com',
    password: 'sarah123',
    role: 'telecaller',
    status: 'active',
    isApproved: true,
  });
  await User.create({
    name: 'Mike Johnson',
    email: 'mike@crm.com',
    password: 'mike123',
    role: 'telecaller',
    status: 'inactive',
  });

  console.log('Creating customers...');
  const customersData = [
    {
      name: 'Rahul Sharma',
      mobile: '9876543210',
      alternateNumber: '9876543211',
      email: 'rahul@example.com',
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
      email: 'priya@example.com',
      company: 'Digital Marketing Hub',
      city: 'Ahmedabad',
      state: 'Gujarat',
      leadSource: 'Referral',
      interestedProduct: 'Fixed Deposit',
      status: 'active',
    isApproved: true,
      assignedTelecaller: sarah.name,
      telecallerId: sarah._id,
      remarks: 'Submitted initial membership form',
    },
    {
      name: 'Amit Kumar',
      mobile: '9876543214',
      email: 'amit@example.com',
      company: 'StartupX',
      city: 'Bangalore',
      state: 'Karnataka',
      leadSource: 'Social Media',
      interestedProduct: 'Cooperative Loan',
      status: 'active',
    isApproved: true,
      assignedTelecaller: john.name,
      telecallerId: john._id,
      remarks: 'Looking for society registration',
    },
  ];
  const customers = await Customer.insertMany(customersData);

  console.log('Creating applications...');
  await Application.insertMany([
    {
      applicationNumber: 'APP-2026-0001-8472',
      customerId: customers[0]._id,
      customerName: customers[0].name,
      customerMobile: customers[0].mobile,
      customerEmail: customers[0].email,
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
          remarks: 'Verified against UIDAI details',
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
      customerId: customers[1]._id,
      customerName: customers[1].name,
      customerMobile: customers[1].mobile,
      customerEmail: customers[1].email,
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
      customerId: customers[2]._id,
      customerName: customers[2].name,
      customerMobile: customers[2].mobile,
      customerEmail: customers[2].email,
      applicationType: 'cooperative_loan',
      status: 'pending_documents',
      paymentStatus: 'pending',
      paymentAmount: 2500,
      documents: [],
      remarks: 'Waiting for Bank Statement and Salary Slip upload',
      assignedTo: john._id,
      assignedToName: john.name,
    },
    {
      applicationNumber: 'APP-2026-0004-9218',
      customerId: customers[0]._id,
      customerName: customers[0].name,
      customerMobile: customers[0].mobile,
      customerEmail: customers[0].email,
      applicationType: 'society_registration',
      status: 'resubmission_required',
      paymentStatus: 'completed',
      paymentAmount: 1500,
      paymentReference: 'UPI/20260314/11223',
      paymentDate: new Date('2026-03-14'),
      resubmissionNotes: 'Signature blur on the form. Please re-upload clear signed copy.',
      documents: [
        {
          name: 'Signed Application Form',
          type: 'signature',
          fileUrl: '/uploads/documents/signed_form.jpg',
          fileName: 'form_signed_blur.jpg',
          fileSize: 180000,
          status: 'resubmission_required',
          remarks: 'Signature not clear',
        },
      ],
    },
  ]);

  console.log('Creating sample communication logs...');
  await WhatsAppLog.create({
    customerId: customers[0]._id,
    customerName: customers[0].name,
    phone: customers[0].mobile,
    message: 'Dear Rahul Sharma, your PeYug Society Membership application APP-2026-0001 has been approved!',
    type: 'template',
    status: 'delivered',
    sentBy: admin._id,
    sentByName: admin.name,
    providerMessageId: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgg...',
  });

  await CallHistory.create({
    customerId: customers[0]._id,
    customerName: customers[0].name,
    customerPhone: customers[0].mobile,
    calledBy: john._id,
    calledByName: john.name,
    callType: 'Outgoing',
    date: '2026-03-12',
    time: '14:30',
    duration: '3 mins',
    status: 'connected',
    remarks: 'Informed customer regarding verified documents and approval timeline.',
  });

  console.log('Creating leads...');
  await Lead.create({
    customerId: customers[0]._id,
    customerName: customers[0].name,
    status: 'converted',
    telecallerId: john._id,
    history: [
      { status: 'new', date: new Date('2026-01-15'), remark: 'Lead created from website' },
      { status: 'contacted', date: new Date('2026-01-16'), remark: 'Initial call made, interested' },
      { status: 'converted', date: new Date('2026-01-25'), remark: 'Deal closed successfully' },
    ],
  });

  console.log('Creating follow-ups...');
  const today = new Date().toISOString().split('T')[0];
  await FollowUp.create({
    customerId: customers[0]._id,
    customerName: customers[0].name,
    date: today,
    time: '10:00',
    remarks: 'Discuss premium cooperative deposit option',
    nextFollowUp: '',
    status: 'pending',
    createdBy: john._id,
    createdByName: john.name,
  });

  console.log('Seed complete!');
  console.log('Login credentials:');
  console.log('  Admin:       admin@crm.com / admin123');
  console.log('  Telecaller:  john@crm.com  / john123');
  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
