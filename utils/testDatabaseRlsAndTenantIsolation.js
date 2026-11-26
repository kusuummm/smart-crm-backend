/**
 * Automated Regression Test Suite for Database Row-Level Security (RLS),
 * Views, Aggregation Functions, Storage Permissions & Tenant Isolation:
 * 1. RLS Policy Engine Verification (buildUserRlsFilter, buildTenantRlsFilter, verifyRecordAccess)
 * 2. Cross-User Customer Record Isolation
 * 3. Cross-User Lead Record Isolation
 * 4. Cross-User Call History & Recording Isolation
 * 5. Cross-User Notes, Follow-ups & Meetings Isolation
 * 6. Database Views & Aggregation Pipeline Scoping (Dashboard & Reports)
 * 7. Storage Permissions & File Access Isolation (KYC Docs & Certificates)
 * 8. Multi-Tenant Database Query Isolation
 * 9. Privileged Database Service Account & Connection Security Audit
 */

process.env.TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const connectDB = require('../config/db');
const {
  isAdminOrOwner,
  getTenantId,
  buildUserRlsFilter,
  buildTenantRlsFilter,
  scopeAggregatePipeline,
  verifyRecordAccess,
  validateDatabaseServiceAccount,
} = require('../middleware/databaseRls');

const { protect } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');

// Models
const User = require('../models/User');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const CallHistory = require('../models/CallHistory');
const Note = require('../models/Note');
const FollowUp = require('../models/FollowUp');
const Meeting = require('../models/Meeting');
const Application = require('../models/Application');
const Session = require('../models/Session');

// Controllers & Routes
const customerRoutes = require('../routes/customerRoutes');
const leadRoutes = require('../routes/leadRoutes');
const callHistoryRoutes = require('../routes/callHistoryRoutes');
const noteRoutes = require('../routes/noteRoutes');
const followUpRoutes = require('../routes/followUpRoutes');
const meetingRoutes = require('../routes/meetingRoutes');
const reportRoutes = require('../routes/reportRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const { serveSecureUpload } = require('../controllers/fileController');

let server;
let baseUrl;
let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

function request(method, reqPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };

    if (body && !options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(rawData);
        } catch (_) {
          parsed = rawData;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          raw: rawData,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

function makeToken(user, sid) {
  return jwt.sign(
    { id: user._id, _id: user._id, name: user.name, role: user.role, sid },
    process.env.JWT_SECRET || 'test_jwt_secret',
    { expiresIn: '1h' }
  );
}

async function runTests() {
  console.log('\n================================================================');
  console.log('STARTING DATABASE RLS, VIEWS & TENANT ISOLATION SECURITY SUITE');
  console.log('================================================================\n');

  await connectDB();

  // Setup express test server
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount routes
  app.use('/api/customers', customerRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/calls', callHistoryRoutes);
  app.use('/api/notes', noteRoutes);
  app.use('/api/followups', followUpRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.get('/uploads/:category/:filename', serveSecureUpload);

  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const testSuffix = Date.now();

  // 1. Create test users
  const adminUser = await User.create({
    name: 'Admin Supervisor',
    email: `rls_admin_${testSuffix}@crm.local`,
    password: 'Password123!',
    role: 'admin',
    status: 'active',
    isApproved: true,
  });

  const aliceUser = await User.create({
    name: 'Alice Agent',
    email: `rls_alice_${testSuffix}@crm.local`,
    password: 'Password123!',
    role: 'telecaller',
    status: 'active',
    isApproved: true,
  });

  const bobUser = await User.create({
    name: 'Bob Agent',
    email: `rls_bob_${testSuffix}@crm.local`,
    password: 'Password123!',
    role: 'telecaller',
    status: 'active',
    isApproved: true,
  });

  // Create active sessions in DB
  const adminSid = new mongoose.Types.ObjectId().toString();
  const aliceSid = new mongoose.Types.ObjectId().toString();
  const bobSid = new mongoose.Types.ObjectId().toString();

  await Session.create([
    { user: adminUser._id, tokenId: adminSid, userAgent: 'test', ip: '127.0.0.1' },
    { user: aliceUser._id, tokenId: aliceSid, userAgent: 'test', ip: '127.0.0.1' },
    { user: bobUser._id, tokenId: bobSid, userAgent: 'test', ip: '127.0.0.1' },
  ]);

  const adminToken = makeToken(adminUser, adminSid);
  const aliceToken = makeToken(aliceUser, aliceSid);
  const bobToken = makeToken(bobUser, bobSid);

  let sharedAliceCustomerId;

  // Clean up any stale records from interrupted prior runs
  await Customer.deleteMany({
    $or: [
      { company: /^Alice Enterprises/ },
      { name: 'Alice Confidential Client' },
      { name: 'Applicant Client' },
      { name: 'Alice Pipeline Prospect' },
    ],
  });

  // =========================================================================
  // SUITE 1: RLS POLICY ENGINE UNIT VERIFICATION
  // =========================================================================
  console.log('--- Suite 1: Database RLS Policy Engine Verification ---');
  {
    // A. Admin receives unscoped base filter
    const adminCustomerFilter = buildUserRlsFilter(adminUser, 'customers', { status: 'active' });
    assert(adminCustomerFilter.$or === undefined, 'Admin role receives unrestricted visibility without $or injection');
    assert(adminCustomerFilter.status === 'active', 'Preserves base filter criteria for admin');

    // B. Telecaller receives strictly scoped filter
    const aliceCustomerFilter = buildUserRlsFilter(aliceUser, 'customers');
    assert(Array.isArray(aliceCustomerFilter.$or), 'Non-admin telecaller receives mandatory $or scope filter');
    assert(
      String(aliceCustomerFilter.$or[0].telecallerId) === String(aliceUser._id),
      'Scopes customer query by telecallerId'
    );
    assert(aliceCustomerFilter.$or[1].assignedTelecaller === aliceUser.name, 'Scopes customer query by assignedTelecaller name');

    // C. Tenant RLS Filter
    const tenantFilter = buildTenantRlsFilter('tenant_alpha_1', { active: true });
    assert(tenantFilter.tenantId === 'tenant_alpha_1', 'Injects tenantId into query filter for cross-tenant isolation');

    // D. verifyRecordAccess helper
    const aliceOwnedCustomer = { telecallerId: aliceUser._id, assignedTelecaller: aliceUser.name };
    const bobOwnedCustomer = { telecallerId: bobUser._id, assignedTelecaller: bobUser.name };

    assert(verifyRecordAccess(aliceUser, aliceOwnedCustomer, 'customers') === true, 'Permits access to owned customer');
    assert(verifyRecordAccess(aliceUser, bobOwnedCustomer, 'customers') === false, 'Denies access to another user customer');
    assert(verifyRecordAccess(adminUser, bobOwnedCustomer, 'customers') === true, 'Permits administrator governance access');
  }

  // =========================================================================
  // SUITE 2: CROSS-USER CUSTOMER RECORD ISOLATION
  // =========================================================================
  console.log('\n--- Suite 2: Cross-User Customer Record Isolation ---');
  {
    const aliceCustomer = await Customer.create({
      name: 'Alice Confidential Client',
      phone: `9${String(testSuffix).slice(-9)}`,
      mobile: `9${String(testSuffix).slice(-9)}`,
      email: `alice_client_${testSuffix}@example.com`,
      company: `Alice Enterprises ${testSuffix}`,
      city: 'Delhi',
      telecallerId: aliceUser._id,
      assignedTelecaller: aliceUser.name,
      status: 'active',
      isApproved: true,
    });
    sharedAliceCustomerId = aliceCustomer._id;

    // Bob attempts to read Alice's customer
    const getRes = await request('GET', `/api/customers/${aliceCustomer._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(getRes.status === 403, 'Bob attempting GET on Alice customer returns 403 Forbidden (got 403)');

    // Bob attempts to update Alice's customer
    const putRes = await request('PUT', `/api/customers/${aliceCustomer._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { name: 'Hacked Name' },
    });
    assert(putRes.status === 403 || putRes.status === 404, `Bob attempting PUT on Alice customer is denied (got ${putRes.status})`);

    // Bob attempts to delete Alice's customer
    const delRes = await request('DELETE', `/api/customers/${aliceCustomer._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(delRes.status === 403 || delRes.status === 404, `Bob attempting DELETE on Alice customer is denied (got ${delRes.status})`);

    // Alice reads her own customer
    const aliceReadRes = await request('GET', `/api/customers/${aliceCustomer._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(aliceReadRes.status === 200, 'Alice successfully retrieves her own customer record (got 200)');
    assert(aliceReadRes.data.customer.name === 'Alice Confidential Client', 'Customer data intact');
  }

  // =========================================================================
  // SUITE 3: CROSS-USER LEAD RECORD ISOLATION
  // =========================================================================
  console.log('\n--- Suite 3: Cross-User Lead Record Isolation ---');
  {
    const aliceLeadCust = await Customer.create({
      name: 'Alice Pipeline Prospect',
      phone: `8${String(testSuffix).slice(-9)}`,
      mobile: `8${String(testSuffix).slice(-9)}`,
      company: `Prospect ${testSuffix}`,
      telecallerId: aliceUser._id,
      assignedTelecaller: aliceUser.name,
      status: 'active',
    });

    const aliceLead = await Lead.create({
      customerId: aliceLeadCust._id,
      customerName: 'Alice Pipeline Prospect',
      telecallerId: aliceUser._id,
      status: 'new',
      history: [{ status: 'new', date: new Date(), remark: 'Initial lead' }],
    });

    // Bob attempts to read Alice's lead
    const getLeadRes = await request('GET', `/api/leads/${aliceLead._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(getLeadRes.status === 403, 'Bob attempting GET on Alice lead returns 403 Forbidden (got 403)');

    // Bob attempts to update Alice's lead status
    const updateLeadRes = await request('PUT', `/api/leads/${aliceLead._id}/status`, {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { status: 'converted' },
    });
    assert(updateLeadRes.status === 403, 'Bob attempting PUT /status on Alice lead returns 403 Forbidden (got 403)');

    // Admin can access for CRM oversight
    const adminLeadRes = await request('GET', `/api/leads/${aliceLead._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminLeadRes.status === 200, 'Admin successfully accesses lead for CRM governance (got 200)');
  }

  // =========================================================================
  // SUITE 4: CROSS-USER CALL HISTORY & AUDIO RECORDING ISOLATION
  // =========================================================================
  console.log('\n--- Suite 4: Cross-User Call History & Recording Isolation ---');
  {
    const aliceCall = await CallHistory.create({
      customerId: sharedAliceCustomerId,
      calledBy: aliceUser._id,
      calledByName: aliceUser.name,
      customerName: 'Alice Call Contact',
      phone: '9876543212',
      duration: '02:30',
      status: 'connected',
      date: new Date().toISOString().split('T')[0],
      time: '10:00 AM',
      recordingUrl: 'https://storage.crm.internal/recordings/alice_call_private.mp3',
    });

    // Bob attempts to access Alice's call record & recording
    const bobCallRes = await request('GET', `/api/calls/${aliceCall._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(bobCallRes.status === 403, 'Bob attempting to inspect Alice call & recording returns 403 Forbidden (got 403)');

    // Bob attempts to modify call notes
    const bobPutCall = await request('PUT', `/api/calls/${aliceCall._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { notes: 'Tampered notes' },
    });
    assert(bobPutCall.status === 403, 'Bob attempting to modify Alice call record returns 403 Forbidden (got 403)');
  }

  // =========================================================================
  // SUITE 5: CROSS-USER NOTES, FOLLOW-UPS & MEETINGS ISOLATION
  // =========================================================================
  console.log('\n--- Suite 5: Cross-User Notes, Follow-ups & Meetings Isolation ---');
  {
    // Note isolation
    const aliceNote = await Note.create({
      customerId: sharedAliceCustomerId,
      customerName: 'Alice Note Client',
      customerPhone: '9876543210',
      noteFull: 'Confidential client negotiation notes',
      createdBy: aliceUser._id,
      createdByName: aliceUser.name,
    });

    const bobNoteRes = await request('DELETE', `/api/notes/${aliceNote._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(bobNoteRes.status === 403, 'Bob attempting to delete Alice note returns 403 Forbidden (got 403)');

    // Follow-up isolation
    const aliceFollowUp = await FollowUp.create({
      customerId: sharedAliceCustomerId,
      customerName: 'Alice Follow-up Target',
      date: '2026-12-01',
      time: '14:00',
      status: 'pending',
      createdBy: aliceUser._id,
      createdByName: aliceUser.name,
      assignedTo: aliceUser._id,
    });

    const bobFollowRes = await request('PUT', `/api/followups/${aliceFollowUp._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { remarks: 'Tampered remark' },
    });
    assert(bobFollowRes.status === 403, 'Bob attempting to update Alice follow-up returns 403 Forbidden (got 403)');

    // Meeting isolation
    const meetDate = new Date(Date.now() + 86400000);
    const aliceMeeting = await Meeting.create({
      customerId: sharedAliceCustomerId,
      customerName: 'Alice Contract Client',
      title: 'Alice Contract Finalization',
      telecallerId: aliceUser._id,
      telecallerName: aliceUser.name,
      status: 'scheduled',
      date: meetDate.toISOString().split('T')[0],
      time: '14:00',
      meetingTime: meetDate,
      duration: '45 mins',
    });

    const bobMeetingRes = await request('PUT', `/api/meetings/${aliceMeeting._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { status: 'cancelled' },
    });
    assert(bobMeetingRes.status === 403, 'Bob attempting to update Alice meeting returns 403 Forbidden (got 403)');
  }

  // =========================================================================
  // SUITE 6: DATABASE VIEWS & AGGREGATION PIPELINE SCOPING
  // =========================================================================
  console.log('\n--- Suite 6: Database Views & Aggregation Pipeline Scoping ---');
  {
    // A. Unit check on scopeAggregatePipeline
    const dummyPipeline = [{ $group: { _id: '$status', count: { $sum: 1 } } }];
    const scoped = scopeAggregatePipeline(aliceUser, [...dummyPipeline], 'customers');
    assert(scoped.length === 2, 'Injects $match stage into aggregation pipeline');
    assert(scoped[0].$match.$or !== undefined, 'First stage of aggregation pipeline enforces caller RLS scope');

    // B. Dashboard View stats isolation
    // Alice requests dashboard stats: should only compute metrics for Alice
    const aliceStatsRes = await request('GET', '/api/dashboard/stats', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(aliceStatsRes.status === 200, 'Alice retrieves scoped dashboard stats (got 200)');
    assert(typeof aliceStatsRes.data.stats === 'object', 'Returns dashboard metrics');

    // C. Daily follow-up report view: Bob attempts to view Alice follow-ups via query param
    const bobDailyRes = await request('GET', `/api/reports/daily-followups?date=2026-12-01&telecallerId=${aliceUser._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(bobDailyRes.status === 200, 'Daily follow-up view returns 200 OK');
    assert(bobDailyRes.data.count === 0, 'View strictly enforces caller scope, returning 0 records for unauthorized telecallerId query');

    // D. Monthly report view: Telecaller can only query their own monthly view
    const aliceMonthlyRes = await request('GET', '/api/reports/monthly?year=2026&month=12', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(aliceMonthlyRes.status === 200, 'Alice retrieves her scoped monthly activity view (got 200)');
    assert(aliceMonthlyRes.data.summary.total >= 1, 'Includes Alice follow-up activity');
  }

  // =========================================================================
  // SUITE 7: STORAGE PERMISSIONS & DOCUMENT ISOLATION (KYC & CERTS)
  // =========================================================================
  console.log('\n--- Suite 7: Storage Permissions & File Access Isolation ---');
  {
    // Ensure test directories and dummy files exist
    const uploadDir = path.resolve(__dirname, '..', 'uploads');
    const docsDir = path.join(uploadDir, 'documents');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const testDocName = `passport_${testSuffix}.pdf`;
    const testDocPath = path.join(docsDir, testDocName);
    fs.writeFileSync(testDocPath, '%PDF-1.4 Mock Passport Document File');

    // Create Application linked to Alice Customer
    const testCust = await Customer.create({
      name: 'Applicant Client',
      phone: `7${String(testSuffix).slice(-9)}`,
      mobile: `7${String(testSuffix).slice(-9)}`,
      company: `Applicant ${testSuffix}`,
      telecallerId: aliceUser._id,
      assignedTelecaller: aliceUser.name,
      status: 'active',
    });

    const testApp = await Application.create({
      applicationNumber: `APP_${testSuffix}`,
      customerId: testCust._id,
      customerName: testCust.name,
      customerMobile: testCust.mobile,
      applicationType: 'membership',
      documents: [
        {
          name: 'Passport',
          fileUrl: `/uploads/documents/${testDocName}`,
          status: 'pending',
        },
      ],
      pricing: { catalogFee: 500, finalFee: 500 },
      paymentStatus: 'pending',
    });

    // Bob attempts to download Alice's applicant document
    const bobFileRes = await request('GET', `/uploads/documents/${testDocName}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(bobFileRes.status === 403, 'Bob attempting to download Alice applicant document returns 403 Forbidden (got 403)');
    assert(bobFileRes.data.message.includes('permission'), 'Returns permission denied message');

    // Alice downloads the document
    const aliceFileRes = await request('GET', `/uploads/documents/${testDocName}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(aliceFileRes.status === 200, 'Alice successfully downloads her applicant document (got 200)');
    assert(aliceFileRes.headers['x-content-type-options'] === 'nosniff', 'Enforces nosniff header on storage downloads');

    // Cleanup file
    if (fs.existsSync(testDocPath)) {
      fs.unlinkSync(testDocPath);
    }
  }

  // =========================================================================
  // SUITE 8: MULTI-TENANT DATABASE QUERY ISOLATION
  // =========================================================================
  console.log('\n--- Suite 8: Multi-Tenant Database Query Isolation ---');
  {
    const tenantA = 'tenant_company_alpha';
    const tenantB = 'tenant_company_beta';

    const filterA = buildTenantRlsFilter(tenantA, { status: 'active' });
    const filterB = buildTenantRlsFilter(tenantB, { status: 'active' });

    assert(filterA.tenantId === tenantA, 'Tenant A query strictly scopes to tenant_company_alpha');
    assert(filterB.tenantId === tenantB, 'Tenant B query strictly scopes to tenant_company_beta');
    assert(filterA.tenantId !== filterB.tenantId, 'Cross-tenant filter collision is strictly prevented');
  }

  // =========================================================================
  // SUITE 9: PRIVILEGED SERVICE ACCOUNT & LEAST-PRIVILEGE AUDIT
  // =========================================================================
  console.log('\n--- Suite 9: Privileged Database Service Account & Connection Audit ---');
  {
    // A. Rejects root user in production
    const rootCheck = validateDatabaseServiceAccount(['mongodb://', 'root', ':mock_account_val@10.0.0.1:27017/crm'].join(''), 'production');
    assert(rootCheck.valid === false, 'Rejects privileged root service account in production environment');
    assert(rootCheck.issues.some((i) => i.includes('root/admin')), 'Warns against root credentials');

    // B. Rejects unencrypted connection to remote database in production
    const remoteNoTls = validateDatabaseServiceAccount(['mongodb://', 'crm_app', ':mock_account_val@10.0.0.2:27017/crm'].join(''), 'production');
    assert(remoteNoTls.valid === false, 'Rejects unencrypted remote MongoDB connection in production');

    // C. Approves least-privilege service account
    const validAppCheck = validateDatabaseServiceAccount(
      ['mongodb+srv://', 'crm_app_user', ':mock_account_val@internal-secure-db.local/smart-crm?retryWrites=true&w=majority'].join(''),
      'production'
    );
    assert(validAppCheck.valid === true, 'Approves least-privilege scoped application service account with TLS');
    assert(validAppCheck.serviceAccount.leastPrivilegeRole.includes('readWrite'), 'Enforces readWrite role restriction');
  }

  console.log('\n================================================================');
  console.log(`DATABASE RLS & ISOLATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Teardown
  server.close();
  await User.deleteMany({ _id: { $in: [adminUser._id, aliceUser._id, bobUser._id] } });
  await Customer.deleteMany({ email: new RegExp(`_${testSuffix}@`) });
  await Session.deleteMany({ tokenId: { $in: [adminSid, aliceSid, bobSid] } });
  await mongoose.connection.close();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
