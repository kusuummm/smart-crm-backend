/**
 * Automated Test Suite for Role Management, Privilege Escalation Prevention,
 * Mass Assignment Protection, and Role-Based Authorization
 */
require('dotenv').config();
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');

// Middleware
const { denyByDefault } = require('../middleware/auth');
const { errorHandler, notFound } = require('../middleware/errorHandler');

// Models
const User = require('../models/User');
const Session = require('../models/Session');
const Otp = require('../models/Otp');

// Routes
const authRoutes = require('../routes/authRoutes');
const userRoutes = require('../routes/userRoutes');

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
  console.log('   ROLE AUTHORIZATION & PRIVILEGE ESCALATION TEST SUITE');
  console.log('================================================================\n');

  await connectDB();

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  \x1b[32m✔ PASS\x1b[0m: ${message}`);
      passed++;
    } else {
      console.error(`  \x1b[31m✘ FAIL\x1b[0m: ${message}`);
      failed++;
    }
  }

  // Teardown previous test fixtures
  const testEmails = [
    'role_test_owner1@crm.com',
    'role_test_owner2@crm.com',
    'role_test_admin@crm.com',
    'role_test_member@crm.com',
    'role_test_target@crm.com',
    'role_test_newuser@crm.com',
    'role_test_newowner@crm.com',
    'role_test_newmanager@crm.com',
  ];
  await User.deleteMany({ email: { $in: testEmails } });
  await Otp.deleteMany({ email: { $in: testEmails } });

  // 1. Create Test Fixture Users
  const ownerUser = await User.create({
    name: 'Primary Owner',
    email: 'role_test_owner1@crm.com',
    password: 'Password123!',
    role: 'owner',
    status: 'active',
    isApproved: true,
  });

  const secondaryOwner = await User.create({
    name: 'Secondary Owner',
    email: 'role_test_owner2@crm.com',
    password: 'Password123!',
    role: 'owner',
    status: 'active',
    isApproved: true,
  });

  const adminUser = await User.create({
    name: 'Admin User',
    email: 'role_test_admin@crm.com',
    password: 'Password123!',
    role: 'admin',
    status: 'active',
    isApproved: true,
  });

  const memberUser = await User.create({
    name: 'Member User',
    email: 'role_test_member@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  const targetMember = await User.create({
    name: 'Target Member',
    email: 'role_test_target@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'pending',
    isApproved: false,
  });

  // Sessions and JWT tokens
  const createToken = async (u) => {
    const sid = new mongoose.Types.ObjectId().toString();
    await Session.create({
      user: u._id,
      tokenId: sid,
      userAgent: 'test-agent',
      ip: '127.0.0.1',
    });
    return jwt.sign(
      { id: u._id, role: u.role, sid },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  };

  const ownerToken = await createToken(ownerUser);
  const adminToken = await createToken(adminUser);
  const memberToken = await createToken(memberUser);

  // Setup test Express app
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));

  app.use('/api', denyByDefault);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);

  app.use(notFound);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  console.log('--- 1. PROFILE UPDATE & MASS ASSIGNMENT PROTECTION (PUT /api/auth/me) ---');
  {
    // Member attempts self-escalation to admin
    const res = await request('PUT', '/api/auth/me', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Member User', role: 'admin' },
    });
    assert(res.status === 403, `Self-escalation to 'admin' rejected with 403 Forbidden (got ${res.status})`);
    assert(
      res.data?.message?.includes('Unauthorized modification of privileged field(s): role'),
      `Error specifies unauthorized role modification (got: "${res.data?.message}")`
    );

    // Verify DB untouched
    const freshMember = await User.findById(memberUser._id);
    assert(freshMember.role === 'member', `Member role remained 'member' in database (got ${freshMember.role})`);
  }
  {
    // Member attempts self-escalation to owner
    const res = await request('PUT', '/api/auth/me', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Member User', role: 'owner' },
    });
    assert(res.status === 403, `Self-escalation to 'owner' rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to tamper with privileged balance
    const res = await request('PUT', '/api/auth/me', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Member User', balance: '₹999999.0' },
    });
    assert(res.status === 403, `Unauthorized balance tampering rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to tamper with isApproved
    const res = await request('PUT', '/api/auth/me', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Member User', isApproved: false },
    });
    assert(res.status === 403, `Unauthorized isApproved modification rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to tamper with referralCode
    const res = await request('PUT', '/api/auth/me', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Member User', referralCode: 'HAXX0R' },
    });
    assert(res.status === 403, `Unauthorized referralCode modification rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member updates permitted profile fields safely
    const res = await request('PUT', '/api/auth/me', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Member Renamed', phone: '+919988776655' },
    });
    assert(res.status === 200, `Legitimate profile update succeeds with 200 OK (got ${res.status})`);
    assert(res.data?.user?.name === 'Member Renamed', `User name updated to 'Member Renamed'`);
    assert(res.data?.user?.avatar === 'MR', `Avatar initials updated to 'MR' (got ${res.data?.user?.avatar})`);

    const freshMember = await User.findById(memberUser._id);
    assert(freshMember.name === 'Member Renamed', `Database user name reflects update`);
    assert(freshMember.role === 'member', `Role strictly preserved as 'member'`);
  }

  console.log('\n--- 2. REGISTRATION & SERVER-SIDE ROLE ASSIGNMENT INTEGRITY ---');
  {
    // Direct registration without OTP is rejected
    const res = await request('POST', '/api/auth/register', {
      body: { name: 'Direct User', email: 'direct@crm.com', password: 'Password123!' },
    });
    assert(res.status === 400, `Direct registration without OTP rejected with 400 (got ${res.status})`);
  }
  {
    // Client attempts to register with privilege escalation payload in send-otp
    const res = await request('POST', '/api/auth/register/send-otp', {
      body: {
        name: 'New Registrant',
        email: 'role_test_newuser@crm.com',
        password: 'Password123!',
        phone: '+919876543210',
        role: 'owner',
        isApproved: true,
        balance: '₹50000',
      },
    });
    assert(res.status === 200, `Registration OTP dispatched with 200 OK (got ${res.status})`);

    // Verify stored OTP metadata unconditionally sets role to 'member'
    const otpDoc = await Otp.findOne({ email: 'role_test_newuser@crm.com', purpose: 'register' });
    assert(otpDoc !== null, `OTP record exists in database`);
    assert(otpDoc?.metadata?.role === 'member', `OTP metadata strictly enforces role 'member' (got ${otpDoc?.metadata?.role})`);

    // Verify OTP and complete registration
    const verifyRes = await request('POST', '/api/auth/register/verify-otp', {
      body: {
        email: 'role_test_newuser@crm.com',
        otp: otpDoc.otp,
        role: 'admin', // Injected role in verify body
      },
    });
    assert(verifyRes.status === 201, `Registration completed with 201 Created (got ${verifyRes.status})`);
    assert(verifyRes.data?.user?.role === 'member', `Created user has role 'member' regardless of client injection (got ${verifyRes.data?.user?.role})`);

    const createdUser = await User.findOne({ email: 'role_test_newuser@crm.com' });
    assert(createdUser.role === 'member', `Database user role is strictly 'member'`);
  }

  console.log('\n--- 3. UNPRIVILEGED ACCESS DENIAL ON ADMINISTRATIVE USER ROUTES ---');
  {
    // Member attempts to create a user via POST /api/users
    const res = await request('POST', '/api/users', {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Injected User', email: 'inj@crm.com', password: 'Password123!' },
    });
    assert(res.status === 403, `Member POST /api/users rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to update another user via PUT /api/users/:id
    const res = await request('PUT', `/api/users/${targetMember._id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Hacked Name' },
    });
    assert(res.status === 403, `Member PUT /api/users/:id rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to approve a user via PUT /api/users/:id/approve
    const res = await request('PUT', `/api/users/${targetMember._id}/approve`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member PUT /api/users/:id/approve rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to reject a user via PUT /api/users/:id/reject
    const res = await request('PUT', `/api/users/${targetMember._id}/reject`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member PUT /api/users/:id/reject rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to toggle status via PUT /api/users/:id/status
    const res = await request('PUT', `/api/users/${targetMember._id}/status`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member PUT /api/users/:id/status rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to delete a user via DELETE /api/users/:id
    const res = await request('DELETE', `/api/users/${targetMember._id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member DELETE /api/users/:id rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Member attempts to access progress report
    const res = await request('GET', '/api/users/callers-progress-report', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert(res.status === 403, `Member GET callers-progress-report rejected with 403 Forbidden (got ${res.status})`);
  }

  console.log('\n--- 4. ROLE HIERARCHY & OWNER PROTECTION (ADMIN CONSTRAINTS) ---');
  {
    // Admin attempts to create an Owner account
    const res = await request('POST', '/api/users', {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Illegal Owner',
        email: 'role_test_newowner@crm.com',
        password: 'Password123!',
        role: 'owner',
      },
    });
    assert(res.status === 403, `Admin creating 'owner' account rejected with 403 Forbidden (got ${res.status})`);
    assert(
      res.data?.message?.includes('Only an organization Owner can create another Owner account'),
      `Error specifies Owner account creation constraint (got: "${res.data?.message}")`
    );
  }
  {
    // Admin attempts to promote a member to Owner
    const res = await request('PUT', `/api/users/${targetMember._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { role: 'owner' },
    });
    assert(res.status === 403, `Admin promoting member to 'owner' rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Admin attempts to modify an existing Owner account's profile
    const res = await request('PUT', `/api/users/${ownerUser._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Tampered Owner Name' },
    });
    assert(res.status === 403, `Admin modifying Owner account rejected with 403 Forbidden (got ${res.status})`);
    assert(
      res.data?.message?.includes('Only an organization Owner can modify an Owner account'),
      `Error specifies Owner modification constraint (got: "${res.data?.message}")`
    );
  }
  {
    // Admin attempts to reject an Owner account
    const res = await request('PUT', `/api/users/${ownerUser._id}/reject`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 403, `Admin rejecting Owner account rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Admin attempts to toggle status of an Owner account
    const res = await request('PUT', `/api/users/${ownerUser._id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 403, `Admin toggling Owner status rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Admin attempts to reset password of an Owner account
    const res = await request('PUT', `/api/users/${ownerUser._id}/reset-password`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { newPassword: 'NewPassword123!' },
    });
    assert(res.status === 403, `Admin resetting Owner password rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Admin attempts to delete an Owner account
    const res = await request('DELETE', `/api/users/${ownerUser._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 403, `Admin deleting Owner account rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Admin attempts to delete their own active account
    const res = await request('DELETE', `/api/users/${adminUser._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 400, `Admin self-deletion rejected with 400 Bad Request (got ${res.status})`);
    assert(res.data?.message?.includes('cannot delete your own account'), `Message confirms self-deletion safety`);
  }
  {
    // Admin attempts to disable their own active account
    const res = await request('PUT', `/api/users/${adminUser._id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 400, `Admin self-disable rejected with 400 Bad Request (got ${res.status})`);
    assert(res.data?.message?.includes('cannot disable your own active account'), `Message confirms self-disable safety`);
  }

  console.log('\n--- 5. LEGITIMATE ADMINISTRATIVE OPERATIONS ---');
  {
    // Admin creates a legitimate member
    const res = await request('POST', '/api/users', {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Manager User',
        email: 'role_test_newmanager@crm.com',
        password: 'Password123!',
        role: 'manager',
      },
    });
    assert(res.status === 201, `Admin creating 'manager' account succeeds with 201 Created (got ${res.status})`);
    assert(res.data?.user?.role === 'manager', `Created account has role 'manager' (got ${res.data?.user?.role})`);
  }
  {
    // Admin approves pending member
    const res = await request('PUT', `/api/users/${targetMember._id}/approve`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin approving user succeeds with 200 OK (got ${res.status})`);
    assert(res.data?.user?.isApproved === true, `User isApproved is true`);
    assert(res.data?.user?.status === 'active', `User status is active`);
  }
  {
    // Admin updates user details and promotes to manager
    const res = await request('PUT', `/api/users/${targetMember._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Promoted Member', role: 'manager' },
    });
    assert(res.status === 200, `Admin promoting user to 'manager' succeeds with 200 OK (got ${res.status})`);
    assert(res.data?.user?.role === 'manager', `Target user role is now 'manager'`);
  }
  {
    // Admin toggles user status
    const res = await request('PUT', `/api/users/${targetMember._id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Admin toggling user status succeeds with 200 OK (got ${res.status})`);
    assert(res.data?.user?.status === 'inactive', `User status toggled to 'inactive'`);
  }

  console.log('\n--- 6. OWNER PRIVILEGE AUTHORITY ---');
  {
    // Owner creates another Owner account
    const res = await request('POST', '/api/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        name: 'New Third Owner',
        email: 'role_test_newowner@crm.com',
        password: 'Password123!',
        role: 'owner',
      },
    });
    assert(res.status === 201, `Owner creating another Owner account succeeds with 201 Created (got ${res.status})`);
    assert(res.data?.user?.role === 'owner', `Created account has role 'owner'`);
  }
  {
    // Owner promotes admin to Owner
    const res = await request('PUT', `/api/users/${adminUser._id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { role: 'owner' },
    });
    assert(res.status === 200, `Owner promoting user to 'owner' succeeds with 200 OK (got ${res.status})`);
    assert(res.data?.user?.role === 'owner', `User role successfully elevated to 'owner' by Owner`);
  }
  {
    // Owner modifies another owner account
    const res = await request('PUT', `/api/users/${secondaryOwner._id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { name: 'Renamed Secondary Owner' },
    });
    assert(res.status === 200, `Owner modifying another owner succeeds with 200 OK (got ${res.status})`);
    assert(res.data?.user?.name === 'Renamed Secondary Owner', `Owner account name updated`);
  }
  {
    // Owner deletes secondary owner (multiple owners exist)
    const res = await request('DELETE', `/api/users/${secondaryOwner._id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res.status === 200, `Owner deleting non-last owner succeeds with 200 OK (got ${res.status})`);
  }

  console.log('\n================================================================');
  console.log(`ROLE AUTHORIZATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Teardown
  await Promise.all([
    User.deleteMany({ email: { $in: testEmails } }),
    Session.deleteMany({ user: { $in: [ownerUser._id, secondaryOwner._id, adminUser._id, memberUser._id, targetMember._id] } }),
    Otp.deleteMany({ email: { $in: testEmails } }),
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
  console.error('Fatal role authorization test suite error:', err);
  if (server) server.close();
  process.exit(1);
});
