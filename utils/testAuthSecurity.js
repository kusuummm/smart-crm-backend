/**
 * Automated Regression Test Suite for Authentication Security:
 * - Secure Attempt Limits & Account Lockout
 * - Short OTP Expiration (5 min TTL)
 * - Single-Use Verification & Replay Protection (with concurrent race condition tests)
 * - Secure Session Handling & Invalidation across Devices
 * - Two-Factor Authentication (2FA) Workflow
 */
process.env.TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';
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
  console.log('   AUTHENTICATION, OTP & SESSION SECURITY REGRESSION TEST SUITE');
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

  const testEmails = [
    'auth_sec_reg1@crm.com',
    'auth_sec_reg_race@crm.com',
    'auth_sec_reset@crm.com',
    'auth_sec_lockout@crm.com',
    'auth_sec_session@crm.com',
    'auth_sec_2fa@crm.com',
  ];
  await User.deleteMany({ email: { $in: testEmails } });
  await Otp.deleteMany({ email: { $in: testEmails } });

  // Express Test App
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));

  app.use('/api', denyByDefault);
  app.use('/api/auth', authRoutes);

  app.use(notFound);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  console.log('--- 1. SHORT OTP EXPIRATION ENFORCEMENT (5-MINUTE TTL) ---');
  {
    // Request registration OTP
    const res = await request('POST', '/api/auth/register/send-otp', {
      body: {
        name: 'Reg Expiry Test',
        email: 'auth_sec_reg1@crm.com',
        password: 'Password123!',
      },
    });
    assert(res.status === 200, `Registration OTP dispatched (got ${res.status})`);

    const otpDoc = await Otp.findOne({ email: 'auth_sec_reg1@crm.com', purpose: 'register' });
    assert(otpDoc !== null, `OTP record found in database`);

    const ttlMs = otpDoc.expiresAt.getTime() - Date.now();
    assert(ttlMs > 0 && ttlMs <= 5 * 60 * 1000 + 2000, `OTP expiry is short (~5 minutes TTL, actual: ${Math.round(ttlMs / 1000)}s)`);

    // Manually expire the OTP
    otpDoc.expiresAt = new Date(Date.now() - 5000);
    await otpDoc.save();

    // Verification attempt with expired OTP is rejected
    const verifyRes = await request('POST', '/api/auth/register/verify-otp', {
      body: {
        email: 'auth_sec_reg1@crm.com',
        otp: otpDoc.otp,
      },
    });
    assert(verifyRes.status === 400, `Expired OTP verification rejected with 400 (got ${verifyRes.status})`);
    assert(verifyRes.data?.message?.includes('expired'), `Error message indicates code expired (got: "${verifyRes.data?.message}")`);
  }

  console.log('\n--- 2. ATOMIC OTP ATTEMPT LIMITS & THRESHOLD INVALIDATION ---');
  {
    const resetUser = await User.create({
      name: 'Reset Attempt User',
      email: 'auth_sec_reset@crm.com',
      password: 'OldPassword123!',
      role: 'member',
      status: 'active',
      isApproved: true,
    });

    const sendRes = await request('POST', '/api/auth/forgot-password/send-otp', {
      body: { email: 'auth_sec_reset@crm.com' },
    });
    assert(sendRes.status === 200, `Forgot password OTP dispatched (got ${sendRes.status})`);

    const otpDoc = await Otp.findOne({ email: 'auth_sec_reset@crm.com', purpose: 'forgot_password' });
    const realOtp = otpDoc.otp;

    // Fail 4 times with bad OTP
    for (let i = 1; i <= 4; i++) {
      const badRes = await request('POST', '/api/auth/forgot-password/verify-reset', {
        body: {
          email: 'auth_sec_reset@crm.com',
          otp: '000000',
          newPassword: 'NewPassword123!',
        },
      });
      assert(badRes.status === 400, `Bad OTP attempt #${i} rejected with 400 (got ${badRes.status})`);
      assert(badRes.data?.message?.includes(`${5 - i} attempt(s) remaining`) || badRes.data?.message?.includes(`${5 - i} attempts remaining`), `Warning states ${5 - i} attempts remaining`);
    }

    // 5th failed attempt should trigger invalidation
    const fifthRes = await request('POST', '/api/auth/forgot-password/verify-reset', {
      body: {
        email: 'auth_sec_reset@crm.com',
        otp: '000000',
        newPassword: 'NewPassword123!',
      },
    });
    assert(fifthRes.status === 400, `5th bad attempt rejected with 400 (got ${fifthRes.status})`);
    assert(fifthRes.data?.message?.includes('invalidated'), `Error indicates OTP was invalidated due to excessive attempts`);

    // Verify OTP was destroyed from database
    const destroyedOtp = await Otp.findOne({ email: 'auth_sec_reset@crm.com', purpose: 'forgot_password' });
    assert(destroyedOtp === null, `OTP document was permanently removed from database upon exceeding limit`);

    // Even using the real OTP now fails
    const retryRes = await request('POST', '/api/auth/forgot-password/verify-reset', {
      body: {
        email: 'auth_sec_reset@crm.com',
        otp: realOtp,
        newPassword: 'NewPassword123!',
      },
    });
    assert(retryRes.status === 400, `Subsequent attempt with original OTP fails because code is destroyed (got ${retryRes.status})`);
  }

  console.log('\n--- 3. SINGLE-USE VERIFICATION & SEQUENTIAL REPLAY PROTECTION ---');
  {
    // Generate fresh OTP
    await request('POST', '/api/auth/forgot-password/send-otp', {
      body: { email: 'auth_sec_reset@crm.com' },
    });
    const freshOtpDoc = await Otp.findOne({ email: 'auth_sec_reset@crm.com', purpose: 'forgot_password' });

    // First reset succeeds
    const firstUseRes = await request('POST', '/api/auth/forgot-password/verify-reset', {
      body: {
        email: 'auth_sec_reset@crm.com',
        otp: freshOtpDoc.otp,
        newPassword: 'FreshPassword123!',
      },
    });
    assert(firstUseRes.status === 200, `First verification & password reset succeeds with 200 (got ${firstUseRes.status})`);

    // Replay attack with same OTP
    const replayRes = await request('POST', '/api/auth/forgot-password/verify-reset', {
      body: {
        email: 'auth_sec_reset@crm.com',
        otp: freshOtpDoc.otp,
        newPassword: 'HackedPassword123!',
      },
    });
    assert(replayRes.status === 400, `Replay attack with consumed OTP rejected with 400 (got ${replayRes.status})`);
  }

  console.log('\n--- 4. CONCURRENT OTP RACE CONDITION & REPLAY PROTECTION ---');
  {
    // Generate registration OTP for race condition testing
    await request('POST', '/api/auth/register/send-otp', {
      body: {
        name: 'Race User',
        email: 'auth_sec_reg_race@crm.com',
        password: 'Password123!',
      },
    });
    const raceOtpDoc = await Otp.findOne({ email: 'auth_sec_reg_race@crm.com', purpose: 'register' });
    const raceOtp = raceOtpDoc.otp;

    console.log('    Firing 5 simultaneous concurrent verify requests with the same valid OTP...');
    const results = await Promise.all([
      request('POST', '/api/auth/register/verify-otp', { body: { email: 'auth_sec_reg_race@crm.com', otp: raceOtp } }),
      request('POST', '/api/auth/register/verify-otp', { body: { email: 'auth_sec_reg_race@crm.com', otp: raceOtp } }),
      request('POST', '/api/auth/register/verify-otp', { body: { email: 'auth_sec_reg_race@crm.com', otp: raceOtp } }),
      request('POST', '/api/auth/register/verify-otp', { body: { email: 'auth_sec_reg_race@crm.com', otp: raceOtp } }),
      request('POST', '/api/auth/register/verify-otp', { body: { email: 'auth_sec_reg_race@crm.com', otp: raceOtp } }),
    ]);

    const successCount = results.filter((r) => r.status === 201).length;
    const rejectedCount = results.filter((r) => r.status === 400).length;

    assert(successCount === 1, `Exactly 1 concurrent verification succeeded (got ${successCount})`);
    assert(rejectedCount === 4, `Remaining 4 concurrent replay attempts were rejected (got ${rejectedCount})`);

    // Verify only 1 user exists in DB
    const userCount = await User.countDocuments({ email: 'auth_sec_reg_race@crm.com' });
    assert(userCount === 1, `Database holds exactly 1 user account for race registrant (got ${userCount})`);
  }

  console.log('\n--- 5. BRUTE-FORCE LOGIN ATTEMPTS & ACCOUNT LOCKOUT ---');
  {
    const lockUser = await User.create({
      name: 'Lockout Target',
      email: 'auth_sec_lockout@crm.com',
      password: 'CorrectPassword123!',
      role: 'member',
      status: 'active',
      isApproved: true,
    });

    // 4 failed login attempts
    for (let i = 1; i <= 4; i++) {
      const res = await request('POST', '/api/auth/login', {
        body: { email: 'auth_sec_lockout@crm.com', password: 'WrongPassword' },
      });
      assert(res.status === 401, `Failed login attempt #${i} returns 401 Unauthorized (got ${res.status})`);
      assert(res.data?.message?.includes(`${5 - i} attempt(s) remaining`), `Notice warns of ${5 - i} attempt(s) remaining`);
    }

    // 5th failed login attempt triggers account lockout
    const fifthRes = await request('POST', '/api/auth/login', {
      body: { email: 'auth_sec_lockout@crm.com', password: 'WrongPassword' },
    });
    assert(fifthRes.status === 429, `5th failed login attempt triggers account lockout with 429 (got ${fifthRes.status})`);
    assert(fifthRes.data?.message?.includes('locked for 15 minutes'), `Message confirms 15-minute account lock`);

    // 6th attempt with CORRECT password while locked is still rejected!
    const lockedRes = await request('POST', '/api/auth/login', {
      body: { email: 'auth_sec_lockout@crm.com', password: 'CorrectPassword123!' },
    });
    assert(lockedRes.status === 429, `Login with correct password while locked is rejected with 429 (got ${lockedRes.status})`);
    assert(lockedRes.data?.message?.includes('Account temporarily locked'), `Account lock persists`);

    // Account unlock via verified password reset
    await request('POST', '/api/auth/forgot-password/send-otp', {
      body: { email: 'auth_sec_lockout@crm.com' },
    });
    const resetOtp = await Otp.findOne({ email: 'auth_sec_lockout@crm.com', purpose: 'forgot_password' });

    const unlockRes = await request('POST', '/api/auth/forgot-password/verify-reset', {
      body: {
        email: 'auth_sec_lockout@crm.com',
        otp: resetOtp.otp,
        newPassword: 'BrandNewPassword123!',
      },
    });
    assert(unlockRes.status === 200, `Password reset unlocks the account (got ${unlockRes.status})`);

    // Now login with new password succeeds immediately
    const loginRes = await request('POST', '/api/auth/login', {
      body: { email: 'auth_sec_lockout@crm.com', password: 'BrandNewPassword123!' },
    });
    assert(loginRes.status === 200, `Login succeeds with new password after unlock (got ${loginRes.status})`);

    const freshUser = await User.findById(lockUser._id);
    assert(freshUser.failedLoginAttempts === 0, `failedLoginAttempts reset to 0 (got ${freshUser.failedLoginAttempts})`);
    assert(freshUser.lockUntil === null, `lockUntil reset to null`);
  }

  console.log('\n--- 6. SECURE SESSION HANDLING & CROSS-DEVICE INVALIDATION ---');
  {
    const sessionUser = await User.create({
      name: 'Session Test User',
      email: 'auth_sec_session@crm.com',
      password: 'SessionPassword123!',
      role: 'member',
      status: 'active',
      isApproved: true,
    });

    // Simulate 3 active sessions across 3 devices
    const sid1 = new mongoose.Types.ObjectId().toString();
    const sid2 = new mongoose.Types.ObjectId().toString();
    const sid3 = new mongoose.Types.ObjectId().toString();

    await Session.create([
      { user: sessionUser._id, tokenId: sid1, userAgent: 'Device-1 (Laptop)', ip: '10.0.0.1' },
      { user: sessionUser._id, tokenId: sid2, userAgent: 'Device-2 (Phone)', ip: '10.0.0.2' },
      { user: sessionUser._id, tokenId: sid3, userAgent: 'Device-3 (Tablet)', ip: '10.0.0.3' },
    ]);

    const token1 = jwt.sign({ id: sessionUser._id, role: sessionUser.role, sid: sid1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const token2 = jwt.sign({ id: sessionUser._id, role: sessionUser.role, sid: sid2 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const token3 = jwt.sign({ id: sessionUser._id, role: sessionUser.role, sid: sid3 }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Verify all 3 sessions active
    const check1 = await request('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${token1}` } });
    const check2 = await request('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${token2}` } });
    assert(check1.status === 200 && check2.status === 200, `All initial sessions active and authenticated`);

    // Device 1 changes password
    const pwdChangeRes = await request('PUT', '/api/auth/change-password', {
      headers: { Authorization: `Bearer ${token1}` },
      body: {
        currentPassword: 'SessionPassword123!',
        newPassword: 'UpdatedSessionPass123!',
      },
    });
    assert(pwdChangeRes.status === 200, `Password change from Device 1 succeeds (got ${pwdChangeRes.status})`);

    // Device 1 remains authenticated
    const dev1Check = await request('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${token1}` } });
    assert(dev1Check.status === 200, `Device 1 session remains authenticated after password change`);

    // Device 2 and Device 3 are immediately invalidated!
    const dev2Check = await request('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${token2}` } });
    assert(dev2Check.status === 401, `Device 2 session is invalidated and rejected with 401 (got ${dev2Check.status})`);

    const dev3Check = await request('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${token3}` } });
    assert(dev3Check.status === 401, `Device 3 session is invalidated and rejected with 401 (got ${dev3Check.status})`);

    const remainingSessions = await Session.find({ user: sessionUser._id });
    assert(remainingSessions.length === 1 && remainingSessions[0].tokenId === sid1, `Only Device 1 session remains active in database`);
  }

  console.log('\n--- 7. TWO-FACTOR AUTHENTICATION (2FA) WORKFLOW & REPLAY DEFENSE ---');
  {
    const user2FA = await User.create({
      name: '2FA User',
      email: 'auth_sec_2fa@crm.com',
      password: 'Secure2FAPassword123!',
      role: 'member',
      status: 'active',
      isApproved: true,
      twoFactorEnabled: false,
    });

    const tempSid = new mongoose.Types.ObjectId().toString();
    await Session.create({ user: user2FA._id, tokenId: tempSid, userAgent: 'test-agent', ip: '127.0.0.1' });
    const tempToken = jwt.sign({ id: user2FA._id, role: user2FA.role, sid: tempSid }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Enable 2FA
    const enableRes = await request('POST', '/api/auth/2fa/enable', {
      headers: { Authorization: `Bearer ${tempToken}` },
    });
    assert(enableRes.status === 200, `2FA enabled successfully (got ${enableRes.status})`);
    assert(enableRes.data?.twoFactorEnabled === true, `twoFactorEnabled is true in response`);

    // Login now requires 2FA code instead of direct JWT
    const loginAttempt = await request('POST', '/api/auth/login', {
      body: { email: 'auth_sec_2fa@crm.com', password: 'Secure2FAPassword123!' },
    });
    assert(loginAttempt.status === 200, `Login response 200 (got ${loginAttempt.status})`);
    assert(loginAttempt.data?.requires2FA === true, `Login flags requires2FA: true`);
    assert(!loginAttempt.data?.token, `JWT token is NOT issued prior to 2FA verification`);

    // Verify 2FA OTP generated in DB
    const otpDoc2FA = await Otp.findOne({ email: 'auth_sec_2fa@crm.com', purpose: '2fa_login' });
    assert(otpDoc2FA !== null, `2FA OTP created in database`);
    assert(otpDoc2FA.purpose === '2fa_login', `Purpose is '2fa_login'`);

    // Incorrect 2FA code attempt
    const bad2FA = await request('POST', '/api/auth/2fa/verify', {
      body: { email: 'auth_sec_2fa@crm.com', otp: '999999' },
    });
    assert(bad2FA.status === 400, `Incorrect 2FA code rejected with 400 (got ${bad2FA.status})`);
    assert(bad2FA.data?.message?.includes('attempt(s) remaining'), `Notice warns of remaining attempts`);

    // Correct 2FA code verification
    const good2FA = await request('POST', '/api/auth/2fa/verify', {
      body: { email: 'auth_sec_2fa@crm.com', otp: otpDoc2FA.otp },
    });
    assert(good2FA.status === 200, `Correct 2FA code verified with 200 (got ${good2FA.status})`);
    assert(typeof good2FA.data?.token === 'string', `JWT token successfully issued upon 2FA verification`);

    // Replay attack with same 2FA code is rejected
    const replay2FA = await request('POST', '/api/auth/2fa/verify', {
      body: { email: 'auth_sec_2fa@crm.com', otp: otpDoc2FA.otp },
    });
    assert(replay2FA.status === 400, `2FA code replay attempt rejected with 400 (got ${replay2FA.status})`);

    // Disable 2FA with password
    const disableRes = await request('POST', '/api/auth/2fa/disable', {
      headers: { Authorization: `Bearer ${good2FA.data.token}` },
      body: { password: 'Secure2FAPassword123!' },
    });
    assert(disableRes.status === 200, `2FA disabled with valid password (got ${disableRes.status})`);
    assert(disableRes.data?.twoFactorEnabled === false, `twoFactorEnabled is false`);

    // Subsequent login does not require 2FA
    const normalLogin = await request('POST', '/api/auth/login', {
      body: { email: 'auth_sec_2fa@crm.com', password: 'Secure2FAPassword123!' },
    });
    assert(normalLogin.status === 200, `Normal login succeeds directly without 2FA (got ${normalLogin.status})`);
    assert(typeof normalLogin.data?.token === 'string', `Token returned directly`);
  }

  console.log('\n================================================================');
  console.log(`AUTHENTICATION SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Teardown
  await Promise.all([
    User.deleteMany({ email: { $in: testEmails } }),
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
  console.error('Fatal authentication security test suite error:', err);
  if (server) server.close();
  process.exit(1);
});
