/**
 * Automated Regression Test Suite for Broken Access Control
 * Tests Deny-by-Default, Role Authorization, and Object-Level Authorization
 */
require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');

// Models
const User = require('../models/User');
const Note = require('../models/Note');
const Session = require('../models/Session');

let server;
let baseUrl;

// Helper to make HTTP requests
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
  console.log('   ACCESS CONTROL & AUTHORIZATION REGRESSION TEST SUITE');
  console.log('================================================================\n');

  await connectDB();

  // Create or retrieve test users
  let adminUser = await User.findOne({ email: 'admin@crm.com' });
  if (!adminUser) {
    adminUser = await User.create({
      name: 'Admin Test',
      email: 'admin@crm.com',
      password: 'Password123!',
      role: 'admin',
      status: 'active',
      isApproved: true,
    });
  }

  let memberUser = await User.findOne({ email: 'member_test@crm.com' });
  if (!memberUser) {
    memberUser = await User.create({
      name: 'Member Test',
      email: 'member_test@crm.com',
      password: 'Password123!',
      role: 'member',
      status: 'active',
      isApproved: true,
    });
  } else {
    memberUser.role = 'member';
    memberUser.status = 'active';
    memberUser.isApproved = true;
    await memberUser.save();
  }

  let otherMember = await User.findOne({ email: 'other_member@crm.com' });
  if (!otherMember) {
    otherMember = await User.create({
      name: 'Other Member',
      email: 'other_member@crm.com',
      password: 'Password123!',
      role: 'member',
      status: 'active',
      isApproved: true,
    });
  }

  // Create active sessions and tokens
  const adminSid = new mongoose.Types.ObjectId().toString();
  await Session.create({
    user: adminUser._id,
    tokenId: adminSid,
    userAgent: 'test-agent',
    ip: '127.0.0.1',
  });
  const adminToken = jwt.sign(
    { id: adminUser._id, role: adminUser.role, sid: adminSid },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const memberSid = new mongoose.Types.ObjectId().toString();
  await Session.create({
    user: memberUser._id,
    tokenId: memberSid,
    userAgent: 'test-agent',
    ip: '127.0.0.1',
  });
  const memberToken = jwt.sign(
    { id: memberUser._id, role: memberUser.role, sid: memberSid },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Spin up app server on ephemeral port
  const express = require('express');
  const cors = require('cors');
  const cookieParser = require('cookie-parser');
  const { errorHandler, notFound } = require('../middleware/errorHandler');
  const { protect, authorize, denyByDefault } = require('../middleware/auth');

  // Routes
  const authRoutes = require('../routes/authRoutes');
  const userRoutes = require('../routes/userRoutes');
  const customerRoutes = require('../routes/customerRoutes');
  const leadRoutes = require('../routes/leadRoutes');
  const settingsRoutes = require('../routes/settingsRoutes');
  const teamRoutes = require('../routes/teamRoutes');
  const noteRoutes = require('../routes/noteRoutes');
  const applicationRoutes = require('../routes/applicationRoutes');
  const automationRoutes = require('../routes/automationRoutes');
  const whatsappRoutes = require('../routes/whatsappRoutes');
  const reportRoutes = require('../routes/reportRoutes');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Public health check
  app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));

  // Deny-by-default middleware
  app.use('/api', denyByDefault);

  // Mount routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api/notes', noteRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/automations', automationRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  app.use('/api/reports', reportRoutes);

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

  console.log('--- 1. DENY-BY-DEFAULT FOR UNAUTHENTICATED REQUESTS ---');
  {
    const res = await request('GET', '/api/customers');
    assert(res.status === 401, `GET /api/customers without token returns 401 (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/users');
    assert(res.status === 401, `GET /api/users without token returns 401 (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/settings');
    assert(res.status === 401, `GET /api/settings without token returns 401 (got ${res.status})`);
  }
  {
    const res = await request('POST', '/api/teams', { body: { name: 'Hacked Team' } });
    assert(res.status === 401, `POST /api/teams without token returns 401 (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/automations');
    assert(res.status === 401, `GET /api/automations without token returns 401 (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/applications');
    assert(res.status === 401, `GET /api/applications without token returns 401 (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/health');
    assert(res.status === 200, `Public whitelisted route GET /api/health returns 200 (got ${res.status})`);
  }

  console.log('\n--- 2. ROLE AUTHORIZATION & PRIVILEGE ESCALATION PREVENTION ---');
  {
    const res = await request('POST', '/api/teams', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Malicious Team' },
    });
    assert(res.status === 403, `Member attempting POST /api/teams returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('PUT', '/api/teams/team-1', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Compromised Name' },
    });
    assert(res.status === 403, `Member attempting PUT /api/teams/:id returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('DELETE', '/api/teams/team-1', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member attempting DELETE /api/teams/:id returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('POST', '/api/settings', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { adminSettings: { strictAuditLog: false } },
    });
    assert(res.status === 403, `Member attempting POST /api/settings returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('POST', '/api/customers/bulk-delete', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { customerIds: ['507f1f77bcf86cd799439011'] },
    });
    assert(res.status === 403, `Member attempting POST /api/customers/bulk-delete returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('DELETE', '/api/customers/507f1f77bcf86cd799439011', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403 || res.status === 404, `Member attempting DELETE /api/customers/:id is denied (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/whatsapp/config', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member attempting GET /api/whatsapp/config returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('POST', '/api/whatsapp/device/connect', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member attempting POST /api/whatsapp/device/connect returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/automations', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member attempting GET /api/automations returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('PATCH', '/api/applications/507f1f77bcf86cd799439011/status', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { status: 'approved' },
    });
    assert(res.status === 403, `Member attempting PATCH /api/applications/:id/status returns 403 Forbidden (got ${res.status})`);
  }
  {
    const res = await request('PATCH', '/api/applications/507f1f77bcf86cd799439011/payment', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { paymentStatus: 'completed' },
    });
    assert(res.status === 403, `Member attempting PATCH /api/applications/:id/payment returns 403 Forbidden (got ${res.status})`);
  }

  console.log('\n--- 3. OBJECT-LEVEL AUTHORIZATION (IDOR) PREVENTION ---');
  {
    // Create note owned by otherMember
    const note = await Note.create({
      teamName: 'Main Team',
      customerName: 'Secret VIP Client',
      customerPhone: '+91 99999 11111',
      noteShort: 'Confidential lead note',
      noteFull: 'Confidential lead note details',
      createdBy: otherMember._id,
      createdByName: otherMember.name,
    });

    const res = await request('DELETE', `/api/notes/${note._id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member attempting to delete another member's note returns 403 Forbidden (got ${res.status})`);

    // Verify note still exists
    const stillExists = await Note.findById(note._id);
    assert(stillExists !== null, `Target note was not deleted by unauthorized caller`);

    // Clean up
    await Note.deleteOne({ _id: note._id });
  }

  console.log('\n--- 4. LEGITIMATE ADMINISTRATOR ACCESS VERIFICATION ---');
  {
    const res = await request('GET', '/api/settings', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin successfully retrieves GET /api/settings (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/teams', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin successfully retrieves GET /api/teams (got ${res.status})`);
  }
  {
    const res = await request('GET', '/api/users/callers-progress-report', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin successfully retrieves GET /api/users/callers-progress-report (got ${res.status})`);
  }

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  server.close();
  await mongoose.connection.close();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
