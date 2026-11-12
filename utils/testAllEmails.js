/**
 * Comprehensive Transactional Email Test Suite for Smart CRM
 * Validates all 8 Required Lifecycle Emails + Password Reset & Secure Login Verification
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Customer = require('../models/Customer');
const EmailLog = require('../models/EmailLog');
const emailNotificationService = require('../services/emailNotificationService');

async function runEmailTests() {
  console.log('====================================================');
  console.log('   SMART CRM - TRANSACTIONAL EMAIL TEST SUITE        ');
  console.log('====================================================\n');

  await connectDB();

  // Find or create test customer
  let testCustomer = await Customer.findOne();
  if (!testCustomer) {
    testCustomer = await Customer.create({
      name: 'Rohan Verma',
      email: 'rohan.verma@example.com',
      mobile: '9876543299',
      city: 'Delhi',
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

  // 1. Welcome Email
  await test('1. Welcome Email (Account Creation)', async () => {
    const res = await emailNotificationService.sendWelcomeEmail({
      recipientEmail: testCustomer.email,
      recipientName: testCustomer.name,
      userType: 'customer',
      customerId: testCustomer._id,
      assignedOfficer: 'Officer John Smith',
      loginUrl: 'http://localhost:3000/login',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Welcome email failed');
    return { detail: `Logged with ID: ${res.log?._id}` };
  });

  // 2. Email Verification
  await test('2. Email Verification (First Login / Registration OTP)', async () => {
    const res = await emailNotificationService.sendVerificationEmail({
      recipientEmail: testCustomer.email,
      recipientName: testCustomer.name,
      otp: '782910',
      verificationUrl: 'http://localhost:3000/verify-email?otp=782910',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Verification email failed');
    return { detail: `OTP: 782910 (Log: ${res.log?._id})` };
  });

  // 3. Application Submitted
  await test('3. Application Submitted (New Application)', async () => {
    const res = await emailNotificationService.sendApplicationSubmittedEmail({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerEmail: testCustomer.email,
      applicationNumber: 'APP-2026-9001',
      applicationType: 'membership',
      feeAmount: 500,
      paymentStatus: 'pending',
      remarks: 'Application initiated through online portal',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Application submitted email failed');
    return { detail: `App: APP-2026-9001, Fee: ₹500` };
  });

  // 4. Documents Pending
  await test('4. Documents Pending (Incomplete Documents / Resubmission)', async () => {
    const res = await emailNotificationService.sendDocumentsPendingEmail({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerEmail: testCustomer.email,
      applicationNumber: 'APP-2026-9001',
      missingDocuments: ['Aadhaar Card (Back page missing)', 'Passport Photograph (High-res scan)'],
      resubmissionNotes: 'Please upload clear scan with all 4 corners visible.',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Documents pending email failed');
    return { detail: `Missing: Aadhaar, Photo` };
  });

  // 5. Documents Approved
  await test('5. Documents Approved (Verification Complete)', async () => {
    const res = await emailNotificationService.sendDocumentsApprovedEmail({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerEmail: testCustomer.email,
      applicationNumber: 'APP-2026-9001',
      documentName: 'Aadhaar Card & PAN Card',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Documents approved email failed');
    return { detail: `Approved: Aadhaar & PAN` };
  });

  // 6. Payment Confirmation
  await test('6. Payment Confirmation (Fee Paid)', async () => {
    const res = await emailNotificationService.sendPaymentConfirmationEmail({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerEmail: testCustomer.email,
      applicationNumber: 'APP-2026-9001',
      paymentAmount: 500,
      paymentReference: 'UPI-TXN-20260312-8877',
      paymentDate: new Date(),
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Payment confirmation email failed');
    return { detail: `Paid: ₹500 (Ref: UPI-TXN-20260312-8877)` };
  });

  // 7. Application Status Update
  await test('7. Application Status Update (Status Change)', async () => {
    const res = await emailNotificationService.sendApplicationStatusUpdateEmail({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerEmail: testCustomer.email,
      applicationNumber: 'APP-2026-9001',
      oldStatus: 'pending_documents',
      newStatus: 'under_review',
      remarks: 'Application assigned to senior verification officer for review.',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Status update email failed');
    return { detail: `Stage: under_review` };
  });

  // 8. Registration Completed
  await test('8. Registration Completed (Certificate Issued)', async () => {
    const res = await emailNotificationService.sendRegistrationCompletedEmail({
      customerId: testCustomer._id,
      customerName: testCustomer.name,
      customerEmail: testCustomer.email,
      applicationNumber: 'APP-2026-9001',
      certificateNumber: 'CERT-JINL-2026-9001',
      certificateTitle: 'Society Membership & Shareholder Certificate',
      downloadUrl: 'http://localhost:5000/uploads/certificate.pdf',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Registration completed email failed');
    return { detail: `Cert #: CERT-JINL-2026-9001` };
  });

  // 9. Password Reset
  await test('9. Password Reset (Forgot Password OTP)', async () => {
    const res = await emailNotificationService.sendPasswordResetEmail({
      recipientEmail: 'admin@crm.com',
      recipientName: 'Admin User',
      otp: '492813',
      resetUrl: 'http://localhost:3000/reset-password?otp=492813',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Password reset email failed');
    return { detail: `Reset OTP: 492813` };
  });

  // 10. Secure Login Verification
  await test('10. Secure Login Verification (2FA / Login Verification OTP)', async () => {
    const res = await emailNotificationService.sendLoginVerificationEmail({
      recipientEmail: 'admin@crm.com',
      recipientName: 'Admin User',
      otp: '618294',
      ipAddress: '192.168.1.45',
      userAgent: 'Chrome on Windows 11',
    });
    if (!res.success && !res.simulated) throw new Error(res.error || 'Login verification email failed');
    return { detail: `2FA OTP: 618294` };
  });

  // 11. Verify Timeline Logging
  await test('11. Database Verification (Email Logs in MongoDB)', async () => {
    const recentLogs = await EmailLog.find({ customerId: testCustomer._id }).sort({ createdAt: -1 });
    if (recentLogs.length < 5) throw new Error(`Expected at least 5 email logs for customer, got ${recentLogs.length}`);
    return { detail: `${recentLogs.length} logs found in MongoDB for customer` };
  });

  await mongoose.disconnect();

  console.log('\n====================================================');
  console.log('              EMAIL TEST SUMMARY REPORT              ');
  console.log('====================================================');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Total Emails Tested : ${results.length}`);
  console.log(`Passed              : ${passed}`);
  console.log(`Failed              : ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runEmailTests().catch((err) => {
  console.error('Fatal Email Test Error:', err);
  process.exit(1);
});
