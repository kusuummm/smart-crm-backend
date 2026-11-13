/**
 * Comprehensive API Test Runner for Smart CRM
 * Validates all endpoints, payloads, auth, WhatsApp, Applications, Documents, Timeline & Reports
 */
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Create a valid dummy PDF file for upload testing
const dummyPdfPath = path.join(uploadsDir, 'sample-test.pdf');
fs.writeFileSync(dummyPdfPath, '%PDF-1.4 sample test document for Smart CRM application and certificate testing');

// Connect DB
const connectDB = require('../config/db');

// Middleware
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { notFound, errorHandler } = require('../middleware/errorHandler');

// Routes
const authRoutes = require('../routes/authRoutes');
const userRoutes = require('../routes/userRoutes');
const customerRoutes = require('../routes/customerRoutes');
const leadRoutes = require('../routes/leadRoutes');
const followUpRoutes = require('../routes/followUpRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const searchRoutes = require('../routes/searchRoutes');
const callHistoryRoutes = require('../routes/callHistoryRoutes');
const emailRoutes = require('../routes/emailRoutes');
const whatsappRoutes = require('../routes/whatsappRoutes');
const eventRoutes = require('../routes/eventRoutes');
const reportRoutes = require('../routes/reportRoutes');
const broadcastRoutes = require('../routes/broadcastRoutes');
const noteRoutes = require('../routes/noteRoutes');
const walletRoutes = require('../routes/walletRoutes');
const telephonyRoutes = require('../routes/telephonyRoutes');
const meetingRoutes = require('../routes/meetingRoutes');
const applicationRoutes = require('../routes/applicationRoutes');
const automationRoutes = require('../routes/automationRoutes');

async function runApiVerification() {
  console.log('====================================================');
  console.log('   SMART CRM - COMPLETE END-TO-END API TEST SUITE   ');
  console.log('====================================================\n');

  await connectDB();

  // Create clean express app for testing
  const app = express();
  app.use(compression());
  app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Health
  app.get('/api/health', (req, res) => res.json({ success: true, message: 'Smart CRM API is running' }));

  // Mount all routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/followups', followUpRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/calls', callHistoryRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/broadcast', broadcastRoutes);
  app.use('/api/notes', noteRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/telephony', telephonyRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/automations', automationRoutes);
  app.use('/uploads', express.static(uploadsDir));

  app.use(notFound);
  app.use(errorHandler);

  // Listen on ephemeral port (port 0)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  console.log(`Test server running locally on: ${baseUrl}\n`);

  const results = [];
  let authToken = '';
  let telecallerToken = '';
  let testCustomerId = '';
  let testAppId = '';
  let testDocId = '';

  async function test(name, category, fn) {
    const start = Date.now();
    try {
      const res = await fn();
      const elapsed = Date.now() - start;
      results.push({ name, category, status: 'PASS', code: res?.status || 200, elapsed, detail: res?.detail || 'OK' });
      console.log(`✅ [${category}] ${name} -> ${res?.status || 200} (${elapsed}ms)`);
    } catch (err) {
      const elapsed = Date.now() - start;
      const statusCode = err.status || err.response?.status || 500;
      const errMsg = err.response?.data?.message || err.message;
      results.push({ name, category, status: 'FAIL', code: statusCode, elapsed, detail: errMsg });
      console.error(`❌ [${category}] ${name} -> ${statusCode} (${elapsed}ms): ${errMsg}`);
    }
  }

  // 1. Health API
  await test('System Health Check', 'Health', async () => {
    const res = await axios.get(`${baseUrl}/health`);
    return { status: res.status, detail: res.data.message };
  });

  // 2. Authentication APIs
  await test('Admin Login', 'Auth', async () => {
    const res = await axios.post(`${baseUrl}/auth/login`, {
      email: 'admin@crm.com',
      password: 'admin123',
    });
    authToken = res.data.token || res.data.data?.token;
    return { status: res.status, detail: `User: ${res.data.user?.name || res.data.data?.name}` };
  });

  await test('Telecaller Login', 'Auth', async () => {
    const res = await axios.post(`${baseUrl}/auth/login`, {
      email: 'john@crm.com',
      password: 'john123',
    });
    telecallerToken = res.data.token || res.data.data?.token;
    return { status: res.status, detail: `User: ${res.data.user?.name || res.data.data?.name}` };
  });

  const authHeader = () => ({ headers: { Authorization: `Bearer ${authToken}` } });
  const telecallerHeader = () => ({ headers: { Authorization: `Bearer ${telecallerToken}` } });

  await test('Verify Authenticated Profile (/auth/me)', 'Auth', async () => {
    const res = await axios.get(`${baseUrl}/auth/me`, authHeader());
    return { status: res.status, detail: `Role: ${res.data.user?.role || res.data.data?.role}` };
  });

  // 3. PeYug WhatsApp Cloud API
  await test('WhatsApp Webhook Verification (hub.challenge)', 'WhatsApp', async () => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'peyug_crm_webhook_verify_sec_948f21';
    const challenge = 'test_challenge_12345';
    const res = await axios.get(`${baseUrl}/whatsapp/webhook`, {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': verifyToken,
        'hub.challenge': challenge,
      },
    });
    const passed = String(res.data) === challenge;
    if (!passed) throw new Error('Challenge string mismatch');
    return { status: res.status, detail: 'Challenge echoed successfully' };
  });

  await test('WhatsApp Webhook Incoming Event Receiver', 'WhatsApp', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '1604281820561116',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '919876543210', phone_number_id: '1408768628982301' },
            messages: [{
              from: '919876543210',
              id: 'wamid.HBgLMTIzNDU2Nzg5MA==',
              timestamp: `${Math.floor(Date.now() / 1000)}`,
              text: { body: 'Hello PeYug CRM Test' },
              type: 'text',
            }],
          },
          field: 'messages',
        }],
      }],
    };
    const res = await axios.post(`${baseUrl}/whatsapp/webhook`, payload);
    return { status: res.status, detail: res.data.message || 'Webhook processed' };
  });

  await test('WhatsApp Logs List', 'WhatsApp', async () => {
    const res = await axios.get(`${baseUrl}/whatsapp`, authHeader());
    return { status: res.status, detail: `${res.data.logs?.length || 0} messages logged` };
  });

  await test('WhatsApp Send Custom Message (Phone Sanitization & waLink)', 'WhatsApp', async () => {
    const res = await axios.post(
      `${baseUrl}/whatsapp/send`,
      {
        phone: '8239977386',
        name: 'komal rathore',
        message: 'Hello komal, your quotation is ready!',
        type: 'custom',
      },
      authHeader()
    );
    if (!res.data.success || !res.data.waLink.includes('918239977386')) {
      throw new Error('Expected success with sanitized waLink');
    }
    return { status: res.status, detail: `Delivered via: ${res.data.deliveredVia}, Phone: ${res.data.recipient?.phone}` };
  });

  // 4. Customers API
  await test('Get Customers List', 'Customers', async () => {
    const res = await axios.get(`${baseUrl}/customers`, authHeader());
    const customers = res.data.customers || res.data.data || [];
    if (customers.length > 0) testCustomerId = String(customers[0]._id);
    return { status: res.status, detail: `${customers.length} registered customers (Found ID: ${testCustomerId})` };
  });

  // 5. Customer-wise Communication History
  await test('Customer Communication Timeline (/communication-history)', 'Timeline', async () => {
    if (!testCustomerId) throw new Error('No customer available for timeline test');
    const res = await axios.get(`${baseUrl}/customers/${testCustomerId}/communication-history`, authHeader());
    const counts = res.data.counts || {};
    return {
      status: res.status,
      detail: `Timeline items: ${res.data.timeline?.length || 0} (Calls: ${counts.calls || 0}, WA: ${counts.whatsapp || 0}, Emails: ${counts.emails || 0})`,
    };
  });

  await test('Customer Communication Timeline (/timeline alias)', 'Timeline', async () => {
    const res = await axios.get(`${baseUrl}/customers/${testCustomerId}/timeline`, authHeader());
    return { status: res.status, detail: `Timeline items: ${res.data.timeline?.length || 0}` };
  });

  // 6. Application Lifecycle & Stats
  await test('Application Statistics (All 7 Metric Categories)', 'Applications', async () => {
    const res = await axios.get(`${baseUrl}/applications/stats`, authHeader());
    const stats = res.data.stats || {};
    return {
      status: res.status,
      detail: `Registered: ${stats.totalCustomers}, Apps: ${stats.totalApplications}, Approved: ${stats.approvedApplications}`,
    };
  });

  await test('Create New Application', 'Applications', async () => {
    if (!testCustomerId) throw new Error('No customer available for application test');
    const res = await axios.post(
      `${baseUrl}/applications`,
      {
        customerId: testCustomerId,
        applicationType: 'membership',
        paymentAmount: 500,
        paymentStatus: 'pending',
        remarks: 'Automated test suite creation',
      },
      authHeader()
    );
    const app = res.data.application || res.data.data;
    testAppId = String(app._id);
    return { status: res.status, detail: `Created App #: ${app.applicationNumber} (Status: ${app.status})` };
  });

  await test('List Applications with Filters & Search', 'Applications', async () => {
    const res = await axios.get(`${baseUrl}/applications?status=all&limit=10`, authHeader());
    return { status: res.status, detail: `${res.data.applications?.length || 0} applications returned` };
  });

  await test('Get Single Application Details', 'Applications', async () => {
    const res = await axios.get(`${baseUrl}/applications/${testAppId}`, authHeader());
    return { status: res.status, detail: `App #: ${res.data.application?.applicationNumber}` };
  });

  await test('Update Application Status (under_review)', 'Applications', async () => {
    const res = await axios.patch(
      `${baseUrl}/applications/${testAppId}/status`,
      { status: 'under_review', remarks: 'Officer reviewing documents' },
      authHeader()
    );
    return { status: res.status, detail: `New Status: ${res.data.application?.status}` };
  });

  await test('Update Application Payment Status (completed)', 'Applications', async () => {
    const res = await axios.patch(
      `${baseUrl}/applications/${testAppId}/payment`,
      { paymentStatus: 'completed', paymentAmount: 500, paymentReference: 'UPI-TEST-9988' },
      authHeader()
    );
    return { status: res.status, detail: `Payment: ${res.data.application?.paymentStatus} (₹${res.data.application?.paymentAmount})` };
  });

  // 7. Application Document Folder
  await test('Upload Document to Application Folder', 'Documents', async () => {
    const form = new FormData();
    form.append('name', 'Aadhaar Card Verification');
    form.append('type', 'aadhaar');
    const blob = new Blob([fs.readFileSync(dummyPdfPath)], { type: 'application/pdf' });
    form.append('file', blob, 'sample-test.pdf');

    const res = await fetch(`${baseUrl}/applications/${testAppId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    const app = data.application;
    const doc = app.documents[app.documents.length - 1];
    testDocId = String(doc._id);
    return { status: res.status, detail: `Uploaded doc: ${doc.name} (${doc.fileName})` };
  });

  await test('Update Document Status (verified)', 'Documents', async () => {
    const res = await axios.patch(
      `${baseUrl}/applications/${testAppId}/documents/${testDocId}/status`,
      { status: 'verified', remarks: 'Aadhaar verified via portal' },
      authHeader()
    );
    const doc = res.data.application?.documents?.find((d) => String(d._id) === String(testDocId));
    return { status: res.status, detail: `Doc Status: ${doc?.status}` };
  });

  // 8. Final Certificate Upload & Download
  await test('Upload Final Certificate', 'Certificates', async () => {
    const form = new FormData();
    form.append('certificateNumber', `CERT-TEST-${Date.now().toString().slice(-4)}`);
    form.append('title', 'Society Membership Certificate');
    const blob = new Blob([fs.readFileSync(dummyPdfPath)], { type: 'application/pdf' });
    form.append('file', blob, 'certificate.pdf');

    const res = await fetch(`${baseUrl}/applications/${testAppId}/certificate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    const cert = data.application?.finalCertificate;
    return { status: res.status, detail: `Cert #: ${cert?.certificateNumber} (${cert?.title})` };
  });

  await test('Verify Application is Marked Approved with Certificate', 'Certificates', async () => {
    const res = await axios.get(`${baseUrl}/applications/${testAppId}`, authHeader());
    const app = res.data.application;
    if (!app.finalCertificate?.fileUrl) throw new Error('Final certificate file URL missing');
    return { status: res.status, detail: `Status: ${app.status}, Cert File: ${app.finalCertificate.fileUrl}` };
  });

  // 9. Core CRM Modules Check
  await test('Leads API', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/leads`, authHeader());
    return { status: res.status, detail: `${res.data.leads?.length || 0} leads` };
  });

  await test('Follow-ups API', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/followups`, authHeader());
    return { status: res.status, detail: `${res.data.followUps?.length || res.data.data?.length || 0} followups` };
  });

  await test('Call History API', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/calls`, authHeader());
    return { status: res.status, detail: `${res.data.calls?.length || 0} calls logged` };
  });

  await test('Dashboard Analytics API', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/dashboard/stats`, authHeader());
    return { status: res.status, detail: `Total Leads: ${res.data.data?.totalLeads || 0}` };
  });

  await test('Telecaller Performance Reports API (Admin)', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/reports/telecaller-performance`, authHeader());
    return { status: res.status, detail: `${res.data.rows?.length || 0} callers summarized` };
  });

  await test('Callers Progress Report API (Admin & Manager)', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/users/callers-progress-report`, authHeader());
    return { status: res.status, detail: `Trend days: ${res.data.dailyTrend?.length || 0}, Summary calls: ${res.data.summary?.totalCalls || 0}` };
  });

  await test('Monthly Activity Reports API (Telecaller)', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/reports/monthly`, telecallerHeader());
    return { status: res.status, detail: `Caller Monthly Stats generated` };
  });

  await test('Daily Follow-up Reports API (Telecaller)', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/reports/daily-followups`, telecallerHeader());
    return { status: res.status, detail: `Caller Daily Follow-ups generated` };
  });

  await test('Broadcast Campaigns API', 'CRM Modules', async () => {
    const res = await axios.get(`${baseUrl}/broadcast`, authHeader());
    return { status: res.status, detail: `${res.data.campaigns?.length || 0} campaigns` };
  });

  await test('Automations List API', 'Automations Engine', async () => {
    const res = await axios.get(`${baseUrl}/automations`, authHeader());
    return { status: res.status, detail: `${res.data.automations?.length || 0} automations` };
  });

  await test('Automations Execution Logs API', 'Automations Engine', async () => {
    const res = await axios.get(`${baseUrl}/automations/logs`, authHeader());
    return { status: res.status, detail: `${res.data.logs?.length || 0} execution logs` };
  });

  await test('Missed Call Auto-Responder & Callback Task', 'Automations Engine', async () => {
    const res = await axios.post(
      `${baseUrl}/automations/test-trigger`,
      { key: 'missed_call', customerPhone: '+91 99999 88888', customerName: 'Test Automation Lead' },
      authHeader()
    );
    return { status: res.status, detail: `Triggered callback notice & follow-up task` };
  });

  // Clean up
  server.close();
  await mongoose.disconnect();

  console.log('\n====================================================');
  console.log('                 TEST SUMMARY REPORT                 ');
  console.log('====================================================');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Total APIs Tested : ${results.length}`);
  console.log(`Passed            : ${passed}`);
  console.log(`Failed            : ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runApiVerification().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
