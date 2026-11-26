/**
 * Automated Regression Test Suite for Cross-Account Isolation & Object-Level Authorization (BOLA / IDOR)
 * Verifies that Member A cannot view, modify, or delete resources belonging to Member B:
 * - Calls & Recordings (/api/calls/:id)
 * - Leads & Pipeline (/api/leads/:id, /api/leads/:id/status, /api/leads/:id/emails)
 * - Customers & Communication History (/api/customers/:id, /api/customers/:id/communication-history)
 * - Applications & Documents (/api/applications/:id, /api/applications)
 * - Follow-ups (/api/followups/:id)
 * - Scheduled Meetings (/api/meetings/:id, /api/meetings/:id/send-reminder)
 * - Events & Reminders (/api/events/:id, /api/events/:id/remind)
 * - Internal Notes (/api/notes/:id)
 * - Auth Sessions & Devices (/api/auth/sessions/:id)
 * - Wallet Isolation (/api/wallet)
 * - WhatsApp & Email targeting (/api/whatsapp/send, /api/emails/send)
 * Also verifies that legitimate Admin / Manager oversight is preserved.
 */
require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const connectDB = require('../config/db');

// Models
const User = require('../models/User');
const Session = require('../models/Session');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const CallHistory = require('../models/CallHistory');
const Application = require('../models/Application');
const FollowUp = require('../models/FollowUp');
const Meeting = require('../models/Meeting');
const Event = require('../models/Event');
const Note = require('../models/Note');
const EmailLog = require('../models/EmailLog');
const Wallet = require('../models/Wallet');

// Middleware & Routes
const { errorHandler, notFound } = require('../middleware/errorHandler');
const { denyByDefault } = require('../middleware/auth');
const authRoutes = require('../routes/authRoutes');
const userRoutes = require('../routes/userRoutes');
const customerRoutes = require('../routes/customerRoutes');
const leadRoutes = require('../routes/leadRoutes');
const callHistoryRoutes = require('../routes/callHistoryRoutes');
const applicationRoutes = require('../routes/applicationRoutes');
const followUpRoutes = require('../routes/followUpRoutes');
const meetingRoutes = require('../routes/meetingRoutes');
const eventRoutes = require('../routes/eventRoutes');
const noteRoutes = require('../routes/noteRoutes');
const whatsappRoutes = require('../routes/whatsappRoutes');
const emailRoutes = require('../routes/emailRoutes');
const walletRoutes = require('../routes/walletRoutes');

let server;
let baseUrl;

function request(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json || data,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n================================================================');
  console.log('   CROSS-ACCOUNT ISOLATION & OBJECT-LEVEL AUTHORIZATION TESTS');
  console.log('================================================================\n');

  await connectDB();

  // Clean up any previous test artifacts
  const testEmails = ['admin_iso@crm.com', 'member_a@crm.com', 'member_b@crm.com'];
  await User.deleteMany({ email: { $in: testEmails } });
  await Customer.deleteMany({ $or: [{ email: 'bobclient@example.org' }, { mobile: '9876543210' }, { phone: '9876543210' }] });
  await Application.deleteMany({ applicationNumber: 'APP-2026-TEST-9999' });

  // 1. Create Test Users: Admin, Member A, Member B
  const adminUser = await User.create({
    name: 'Admin Iso',
    email: 'admin_iso@crm.com',
    password: 'Password123!',
    role: 'admin',
    status: 'active',
    isApproved: true,
  });

  const memberA = await User.create({
    name: 'Member Alice',
    email: 'member_a@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  const memberB = await User.create({
    name: 'Member Bob',
    email: 'member_b@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  // Sessions and JWT tokens
  const adminSid = new mongoose.Types.ObjectId().toString();
  await Session.create({ user: adminUser._id, tokenId: adminSid, userAgent: 'test', ip: '127.0.0.1' });
  const adminToken = jwt.sign({ id: adminUser._id, role: adminUser.role, sid: adminSid }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const aliceSid = new mongoose.Types.ObjectId().toString();
  await Session.create({ user: memberA._id, tokenId: aliceSid, userAgent: 'test', ip: '127.0.0.1' });
  const aliceToken = jwt.sign({ id: memberA._id, role: memberA.role, sid: aliceSid }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const bobSid = new mongoose.Types.ObjectId().toString();
  const bobSession = await Session.create({ user: memberB._id, tokenId: bobSid, userAgent: 'test', ip: '127.0.0.1' });
  const bobToken = jwt.sign({ id: memberB._id, role: memberB.role, sid: bobSid }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // 2. Setup Test App Server
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));
  app.use('/api', denyByDefault);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/calls', callHistoryRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/followups', followUpRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/notes', noteRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/wallet', walletRoutes);

  app.use(notFound);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 3. Seed isolated resources owned by Member Bob
  const bobCustomer = await Customer.create({
    name: "Bob's Client Corp",
    mobile: '9876543210',
    phone: '9876543210',
    email: 'bobclient@example.org',
    telecallerId: memberB._id,
    assignedTelecaller: memberB.name,
    status: 'active',
  });

  const bobLead = await Lead.create({
    customerId: bobCustomer._id,
    customerName: bobCustomer.name,
    status: 'interested',
    telecallerId: memberB._id,
    history: [{ status: 'interested', date: new Date(), remark: 'Initial call by Bob', updatedBy: memberB._id }],
  });

  const bobCall = await CallHistory.create({
    customerId: bobCustomer._id,
    customerName: bobCustomer.name,
    customerPhone: '9876543210',
    callType: 'Outgoing',
    date: '2026-11-25',
    time: '14:30',
    duration: '120s',
    status: 'connected',
    remarks: 'Private discussion on terms',
    calledBy: memberB._id,
    calledByName: memberB.name,
    recordingUrl: 'https://storage.provider.com/recordings/bob_secret_call.mp3',
  });

  const bobApplication = await Application.create({
    applicationNumber: 'APP-2026-TEST-9999',
    customerId: bobCustomer._id,
    customerName: bobCustomer.name,
    customerMobile: '9876543210',
    customerEmail: 'bobclient@example.org',
    applicationType: 'membership',
    status: 'new',
    assignedTo: memberB._id,
    assignedToName: memberB.name,
  });

  const bobFollowUp = await FollowUp.create({
    customerId: bobCustomer._id,
    customerName: bobCustomer.name,
    phone: '9876543210',
    date: '2026-11-30',
    time: '11:00',
    remarks: 'Follow up on proposal',
    createdBy: memberB._id,
    createdByName: memberB.name,
    assignedTo: memberB._id,
    assignedToName: memberB.name,
  });

  const bobMeeting = await Meeting.create({
    customerId: bobCustomer._id,
    customerName: bobCustomer.name,
    telecallerId: memberB._id,
    telecallerName: memberB.name,
    title: 'Demo for Bob Client',
    date: '2026-12-01',
    time: '15:00',
    meetingTime: new Date(2026, 11, 1, 15, 0),
  });

  const bobEvent = await Event.create({
    customerId: bobCustomer._id,
    customerName: bobCustomer.name,
    type: 'renewal',
    date: '2026-12-05',
    description: 'Annual contract renewal',
  });

  const bobNote = await Note.create({
    customerName: bobCustomer.name,
    customerPhone: '9876543210',
    customerId: bobCustomer._id,
    noteShort: "Bob's confidential note",
    noteFull: "Full confidential notes for Bob's client",
    createdBy: memberB._id,
    createdByName: memberB.name,
  });

  console.log('--- 1. CALLS & RECORDINGS OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to GET Bob's call record
    const res = await request('GET', `/api/calls/${bobCall._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting GET /api/calls/:id on Bob's call returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to PUT (modify) Bob's call record
    const res = await request('PUT', `/api/calls/${bobCall._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { remarks: 'Tampered by Alice' },
    });
    assert(res.status === 403, `Alice attempting PUT /api/calls/:id on Bob's call returns 403 (got ${res.status})`);
  }
  {
    // Admin can legitimately access Bob's call
    const res = await request('GET', `/api/calls/${bobCall._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin successfully retrieves GET /api/calls/:id for oversight (got ${res.status})`);
  }

  console.log('\n--- 2. LEADS & EMAIL AUDIT OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to GET Bob's lead
    const res = await request('GET', `/api/leads/${bobLead._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting GET /api/leads/:id on Bob's lead returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to update Bob's lead status
    const res = await request('PUT', `/api/leads/${bobLead._id}/status`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { status: 'won' },
    });
    assert(res.status === 403, `Alice attempting PUT /api/leads/:id/status on Bob's lead returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to access Bob's lead email communication history
    const res = await request('GET', `/api/leads/${bobLead._id}/emails`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting GET /api/leads/:id/emails on Bob's lead returns 403 (got ${res.status})`);
  }
  {
    // Admin can view Bob's lead
    const res = await request('GET', `/api/leads/${bobLead._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin successfully retrieves GET /api/leads/:id (got ${res.status})`);
  }

  console.log('\n--- 3. CUSTOMER CONTACTS & TIMELINE OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to GET Bob's customer details
    const res = await request('GET', `/api/customers/${bobCustomer._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting GET /api/customers/:id on Bob's customer returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to view Bob's customer communication history / timeline
    const res = await request('GET', `/api/customers/${bobCustomer._id}/communication-history`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting GET /api/customers/:id/communication-history returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to send WhatsApp to Bob's customer
    const res = await request('POST', '/api/whatsapp/send', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { customerId: bobCustomer._id, message: 'Unauthorized message' },
    });
    assert(res.status === 403, `Alice attempting POST /api/whatsapp/send to Bob's customer returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to send Email to Bob's customer
    const res = await request('POST', '/api/emails/send', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { customerId: bobCustomer._id, subject: 'Unauthorized', body: 'Hello' },
    });
    assert(res.status === 403, `Alice attempting POST /api/emails/send to Bob's customer returns 403 (got ${res.status})`);
  }

  console.log('\n--- 4. APPLICATIONS OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to GET Bob's application
    const res = await request('GET', `/api/applications/${bobApplication._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting GET /api/applications/:id on Bob's application returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to create an application for Bob's customer
    const res = await request('POST', '/api/applications', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { customerId: bobCustomer._id, applicationType: 'membership' },
    });
    assert(res.status === 403, `Alice attempting POST /api/applications for Bob's customer returns 403 (got ${res.status})`);
  }
  {
    // Admin can view Bob's application
    const res = await request('GET', `/api/applications/${bobApplication._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin successfully retrieves GET /api/applications/:id (got ${res.status})`);
  }

  console.log('\n--- 5. FOLLOW-UPS OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to update Bob's follow-up
    const res = await request('PUT', `/api/followups/${bobFollowUp._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { remarks: 'Rescheduled by Alice' },
    });
    assert(res.status === 403, `Alice attempting PUT /api/followups/:id on Bob's follow-up returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to delete Bob's follow-up
    const res = await request('DELETE', `/api/followups/${bobFollowUp._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting DELETE /api/followups/:id on Bob's follow-up returns 403 (got ${res.status})`);
  }
  {
    // Bob can legitimately update his own follow-up
    const res = await request('PUT', `/api/followups/${bobFollowUp._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { remarks: 'Rescheduled by Bob' },
    });
    assert(res.status === 200, `Bob can update his own follow-up (got ${res.status})`);
  }

  console.log('\n--- 6. MEETINGS OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to update Bob's meeting
    const res = await request('PUT', `/api/meetings/${bobMeeting._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { title: 'Hijacked Meeting' },
    });
    assert(res.status === 403, `Alice attempting PUT /api/meetings/:id on Bob's meeting returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to cancel/delete Bob's meeting
    const res = await request('DELETE', `/api/meetings/${bobMeeting._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting DELETE /api/meetings/:id on Bob's meeting returns 403 (got ${res.status})`);
  }
  {
    // Admin can update the meeting
    const res = await request('PUT', `/api/meetings/${bobMeeting._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: 'Admin reviewed meeting' },
    });
    assert(res.status === 200, `Admin can update meeting details (got ${res.status})`);
  }

  console.log('\n--- 7. EVENTS & REMINDERS OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to update Bob's event
    const res = await request('PUT', `/api/events/${bobEvent._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { description: 'Alice edit' },
    });
    assert(res.status === 403, `Alice attempting PUT /api/events/:id on Bob's event returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to trigger reminder for Bob's event
    const res = await request('POST', `/api/events/${bobEvent._id}/remind`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { via: ['dashboard'] },
    });
    assert(res.status === 403, `Alice attempting POST /api/events/:id/remind on Bob's event returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to delete Bob's event
    const res = await request('DELETE', `/api/events/${bobEvent._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting DELETE /api/events/:id on Bob's event returns 403 (got ${res.status})`);
  }

  console.log('\n--- 8. NOTES & SESSIONS OBJECT-LEVEL ISOLATION ---');
  {
    // Alice tries to delete Bob's note
    const res = await request('DELETE', `/api/notes/${bobNote._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 403, `Alice attempting DELETE /api/notes/:id on Bob's note returns 403 (got ${res.status})`);
  }
  {
    // Alice tries to revoke Bob's active session
    const res = await request('DELETE', `/api/auth/sessions/${bobSession._id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 404, `Alice attempting DELETE /api/auth/sessions/:id on Bob's session returns 404 Not Found (isolated) (got ${res.status})`);
    
    // Verify Bob's session was not deleted
    const checkBobSession = await Session.findById(bobSession._id);
    assert(checkBobSession !== null, `Bob's session remains active and safe`);
  }
  {
    // Bob can revoke his own session
    const res = await request('DELETE', `/api/auth/sessions/${bobSession._id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(res.status === 200, `Bob can revoke his own session (got ${res.status})`);
  }

  console.log('\n--- 9. WALLET DATA ISOLATION ---');
  {
    // Alice accesses /api/wallet
    const res = await request('GET', '/api/wallet', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 200 && String(res.data.wallet.userId) === String(memberA._id), `Alice's wallet query returns Alice's wallet only (userId: ${res.data?.wallet?.userId})`);
  }

  console.log('\n================================================================');
  console.log(`CROSS-ACCOUNT ISOLATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Clean up test records
  await Promise.all([
    User.deleteMany({ _id: { $in: [adminUser._id, memberA._id, memberB._id] } }),
    Session.deleteMany({ user: { $in: [adminUser._id, memberA._id, memberB._id] } }),
    Customer.deleteMany({ _id: bobCustomer._id }),
    Lead.deleteMany({ _id: bobLead._id }),
    CallHistory.deleteMany({ _id: bobCall._id }),
    Application.deleteMany({ _id: bobApplication._id }),
    FollowUp.deleteMany({ _id: bobFollowUp._id }),
    Meeting.deleteMany({ _id: bobMeeting._id }),
    Event.deleteMany({ _id: bobEvent._id }),
    Note.deleteMany({ _id: bobNote._id }),
    Wallet.deleteMany({ userId: { $in: [adminUser._id, memberA._id, memberB._id] } }),
  ]);

  server.close();
  await mongoose.connection.close();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal isolation test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
