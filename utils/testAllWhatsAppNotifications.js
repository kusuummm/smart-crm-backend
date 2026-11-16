/**
 * Comprehensive WhatsApp Notification Test Suite for PeYug Smart CRM
 * Validates all 12 Lifecycle & Operational WhatsApp Notifications:
 * 1. Welcome Message
 * 2. Registration / Email Verification OTP
 * 3. Application Submitted
 * 4. Documents Pending (KYC Action Required)
 * 5. Documents Approved
 * 6. Payment Confirmation
 * 7. Application Status Update
 * 8. Registration Completed (Certificate Issued)
 * 9. Password Reset OTP
 * 10. Follow-up Status Change
 * 11. Follow-up Scheduled
 * 12. New Customer / Lead Pipeline Entry
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Customer = require('../models/Customer');
const WhatsAppLog = require('../models/WhatsAppLog');
const whatsAppNotificationService = require('../services/whatsAppNotificationService');

async function runWhatsAppTests() {
  console.log('====================================================');
  console.log('   PEYUG CRM - WHATSAPP NOTIFICATION TEST SUITE     ');
  console.log('====================================================\n');

  await connectDB();

  let testCustomer = await Customer.findOne();
  if (!testCustomer) {
    testCustomer = await Customer.create({
      name: 'Komal Rathore',
      email: 'komal.rathore@example.com',
      mobile: '8239977386',
      city: 'Jaipur',
      status: 'active',
    });
  }

  const results = [];

  async function test(name, fn) {
    const start = Date.now();
    try {
      const res = await fn();
      const elapsed = Date.now() - start;
      results.push({ name, status: 'PASS', elapsed, detail: res?.detail || 'OK' });
      console.log(`✅ ${name} -> PASS (${elapsed}ms)`);
    } catch (err) {
      const elapsed = Date.now() - start;
      results.push({ name, status: 'FAIL', elapsed, detail: err.message });
      console.error(`❌ ${name} -> FAIL (${elapsed}ms): ${err.message}`);
    }
  }

  // 1. Welcome
  await test('1. Welcome WhatsApp (Account Creation)', async () => {
    const res = await whatsAppNotificationService.sendWelcomeWhatsApp({
      customerId: testCustomer._id,
      recipientName: testCustomer.name,
      recipientPhone: testCustomer.mobile || '8239977386',
      assignedOfficer: 'Officer Rajesh Kumar',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Log: ${res.log?._id}` };
  });

  // 2. Verification OTP
  await test('2. Verification OTP (Registration Verification)', async () => {
    const res = await whatsAppNotificationService.sendVerificationWhatsApp({
      recipientPhone: testCustomer.mobile || '8239977386',
      recipientName: testCustomer.name,
      otp: '482910',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `OTP: 482910` };
  });

  // 3. Application Submitted
  await test('3. Application Submitted Notification', async () => {
    const res = await whatsAppNotificationService.sendApplicationSubmittedWhatsApp({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerPhone: testCustomer.mobile || '8239977386',
      applicationNumber: 'APP-2026-9001',
      applicationType: 'cooperative_loan',
      feeAmount: 500,
      paymentStatus: 'pending',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `App: APP-2026-9001` };
  });

  // 4. Documents Pending
  await test('4. Documents Pending (KYC Action Required)', async () => {
    const res = await whatsAppNotificationService.sendDocumentsPendingWhatsApp({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerPhone: testCustomer.mobile || '8239977386',
      applicationNumber: 'APP-2026-9001',
      missingDocuments: ['Aadhaar Card (Back)', 'PAN Card (Clear scan)'],
      resubmissionNotes: 'Please ensure all 4 corners are clearly visible.',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Missing: 2 documents` };
  });

  // 5. Documents Approved
  await test('5. Documents Approved Notification', async () => {
    const res = await whatsAppNotificationService.sendDocumentsApprovedWhatsApp({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerPhone: testCustomer.mobile || '8239977386',
      applicationNumber: 'APP-2026-9001',
      documentName: 'Aadhaar Card',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Doc: Aadhaar Card` };
  });

  // 6. Payment Confirmation
  await test('6. Payment Confirmation Receipt', async () => {
    const res = await whatsAppNotificationService.sendPaymentConfirmationWhatsApp({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerPhone: testCustomer.mobile || '8239977386',
      applicationNumber: 'APP-2026-9001',
      paymentAmount: 500,
      paymentReference: 'UPI-TXN-9847291',
      paymentDate: new Date(),
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Paid: ₹500` };
  });

  // 7. Application Status Update
  await test('7. Application Status Update', async () => {
    const res = await whatsAppNotificationService.sendApplicationStatusUpdateWhatsApp({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerPhone: testCustomer.mobile || '8239977386',
      applicationNumber: 'APP-2026-9001',
      oldStatus: 'under_review',
      newStatus: 'approved',
      remarks: 'Application verified and approved by senior desk officer.',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Status: approved` };
  });

  // 8. Registration Completed
  await test('8. Registration Completed (Certificate Issued)', async () => {
    const res = await whatsAppNotificationService.sendRegistrationCompletedWhatsApp({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerPhone: testCustomer.mobile || '8239977386',
      applicationNumber: 'APP-2026-9001',
      certificateNumber: 'CERT-2026-0042',
      certificateTitle: 'Society Membership Certificate',
      downloadUrl: 'https://peyug.in/certificates/CERT-2026-0042.pdf',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Cert: CERT-2026-0042` };
  });

  // 9. Password Reset OTP
  await test('9. Password Reset OTP', async () => {
    const res = await whatsAppNotificationService.sendPasswordResetWhatsApp({
      recipientPhone: testCustomer.mobile || '8239977386',
      recipientName: testCustomer.name,
      otp: '591024',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `OTP: 591024` };
  });

  // 10. Follow-up Status Change
  await test('10. Follow-up Status Change', async () => {
    const res = await whatsAppNotificationService.sendFollowUpStatusChangeWhatsApp({
      lead: { customerId: testCustomer, _id: new mongoose.Types.ObjectId() },
      newStatus: 'interested',
      remark: 'Customer showed strong interest in daily deposit plan.',
      updatedByUser: { name: 'Advisor Priya Sharma' },
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Status: interested` };
  });

  // 11. Follow-up Scheduled
  await test('11. Follow-up Scheduled / Rescheduled', async () => {
    const res = await whatsAppNotificationService.sendFollowUpScheduleWhatsApp({
      customer: testCustomer,
      telecaller: { name: 'Advisor Priya Sharma' },
      followUp: {
        date: '2026-11-20',
        time: '11:00 AM',
        remarks: 'Discuss deposit schemes and KYC collection.',
      },
      actionType: 'scheduled',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `2026-11-20 11:00 AM` };
  });

  // 12. New Customer Lead Entry
  await test('12. New Customer Lead Pipeline Entry', async () => {
    const res = await whatsAppNotificationService.sendNewCustomerLeadWhatsApp({
      customer: testCustomer,
      leadOwner: { name: 'Advisor Priya Sharma', phone: '+91 70657 47747' },
      status: 'new',
      remark: 'New inquiry registered via website portal',
    });
    if (!res.success && !res.log) throw new Error(res.error || 'Failed');
    return { detail: `Owner: Priya Sharma` };
  });

  console.log('\n====================================================');
  console.log('             WHATSAPP TEST RESULTS SUMMARY          ');
  console.log('====================================================');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);

  // Query latest WhatsAppLog counts
  const logCount = await WhatsAppLog.countDocuments();
  console.log(`Total WhatsAppLog records in database: ${logCount}`);
  console.log('====================================================\n');

  await mongoose.disconnect();
}

if (require.main === module) {
  runWhatsAppTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = runWhatsAppTests;
