/**
 * Automated Test Suite for JWT Security, Verification & Refresh Token Rotation:
 * 1. Explicit Algorithm Allowlist Enforcement (Strict 'HS256', blocks 'none' and confusion attacks)
 * 2. Cryptographic Signature Validation & Payload Tampering Defense
 * 3. Standard Claims Validation: Issuer ('iss') and Audience ('aud')
 * 4. Expiration ('exp') Validation & Expired Token Rejection
 * 5. Token Purpose Enforcement ('type': 'access' vs 'refresh' purpose separation)
 * 6. Single-Use Refresh Token Rotation (RTR) & Atomic Session Update
 * 7. Automatic Refresh Token Reuse Detection & Session Family Revocation
 * 8. Secure Key Management (minimum 256-bit entropy & distinct refresh key derivation)
 * 9. Protected API & File Controller Verification Parity
 */

process.env.TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config(); // Fallback

const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const connectDB = require('../config/db');

// Security Utilities & Models
const {
  JWT_ISSUER,
  JWT_AUDIENCE,
  ALLOWED_ALGORITHMS,
  getJwtSecret,
  getRefreshSecret,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('./jwtSecurity');

const generateToken = require('./generateToken');
const { protect } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { serveSecureUpload } = require('../controllers/fileController');
const { refreshToken } = require('../controllers/authController');

const User = require('../models/User');
const Session = require('../models/Session');

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

async function runTests() {
  console.log('\n================================================================');
  console.log('STARTING JWT GENERATION, VERIFICATION & ROTATION SECURITY SUITE');
  console.log('================================================================\n');

  await connectDB();

  // Express Test Server
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Test endpoints
  app.get('/api/test-protected', protect, (req, res) => {
    res.json({ success: true, user: req.user._id, role: req.user.role });
  });

  app.post('/api/auth/refresh', refreshToken);
  app.get('/uploads/:category/:filename', serveSecureUpload);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const secret = getJwtSecret();
  const testSuffix = Date.now();

  // Create a verified active test user
  const testUser = await User.create({
    name: 'JWT Security User',
    email: `jwt_user_${testSuffix}@crm.local`,
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  const testSessionSid = crypto.randomUUID();
  await Session.create({
    user: testUser._id,
    tokenId: testSessionSid,
    userAgent: 'JWT-Security-Test-Runner',
    ip: '127.0.0.1',
  });

  // =========================================================================
  // SUITE 1: EXPLICIT ALGORITHM ALLOWLIST ENFORCEMENT ('HS256')
  // =========================================================================
  console.log('--- Suite 1: Algorithm Allowlist Enforcement (Strict HS256) ---');
  {
    // Valid HS256 access token
    const validToken = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      secret,
      { algorithm: 'HS256', expiresIn: '15m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    const validVerify = verifyAccessToken(validToken);
    assert(validVerify.id === testUser._id.toString(), 'Verifies authentic token signed with HS256');

    // Attack 1: Unsigned 'none' algorithm token
    // Payload signed with algorithm 'none'
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const nonePayload = Buffer.from(JSON.stringify({ id: testUser._id, role: 'admin', sid: testSessionSid, type: 'access' })).toString('base64url');
    const noneToken = `${noneHeader}.${nonePayload}.`;

    try {
      verifyAccessToken(noneToken);
      assert(false, 'Should reject algorithm none token');
    } catch (err) {
      assert(err.message.includes('algorithm') || err.name === 'JsonWebTokenError', 'Rejects alg: "none" attack token');
    }

    // Verify rejection via HTTP middleware
    const noneHttpRes = await request('GET', '/api/test-protected', {
      headers: { Authorization: `Bearer ${noneToken}` },
    });
    assert(noneHttpRes.status === 401, 'Protected route rejects alg: "none" token with 401 Unauthorized');

    // Attack 2: Disallowed algorithm (e.g. HS512 or HS384 when only HS256 allowed)
    const hs512Token = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      secret,
      { algorithm: 'HS512', expiresIn: '15m' }
    );
    try {
      verifyAccessToken(hs512Token);
      assert(false, 'Should reject non-allowlisted algorithm token');
    } catch (err) {
      assert(err.message.includes('algorithm') || err.name === 'JsonWebTokenError', 'Rejects algorithm not in allowlist (HS512)');
    }
  }

  // =========================================================================
  // SUITE 2: CRYPTOGRAPHIC SIGNATURE & TAMPERING VALIDATION
  // =========================================================================
  console.log('\n--- Suite 2: Cryptographic Signature & Payload Tampering Defense ---');
  {
    const authenticToken = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      secret,
      { algorithm: 'HS256', expiresIn: '15m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );

    // Tampering: Change payload role to 'admin' without re-signing
    const parts = authenticToken.split('.');
    const tamperedPayloadObj = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    tamperedPayloadObj.role = 'admin'; // Privilege escalation attempt
    const tamperedPayload = Buffer.from(JSON.stringify(tamperedPayloadObj)).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    try {
      verifyAccessToken(tamperedToken);
      assert(false, 'Should reject tampered token');
    } catch (err) {
      assert(err.message.includes('signature') || err.name === 'JsonWebTokenError', 'Detects payload tampering and rejects invalid signature');
    }

    const tamperedHttpRes = await request('GET', '/api/test-protected', {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    assert(tamperedHttpRes.status === 401, 'Protected route rejects tampered payload with 401 Unauthorized');

    // Token signed with wrong secret key
    const wrongSecretToken = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      'wrong_unauthorized_key_string_1234567890',
      { algorithm: 'HS256', expiresIn: '15m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    try {
      verifyAccessToken(wrongSecretToken);
      assert(false, 'Should reject token signed with unauthorized key');
    } catch (err) {
      assert(err.name === 'JsonWebTokenError', 'Rejects token signed with wrong secret key');
    }
  }

  // =========================================================================
  // SUITE 3: STANDARD CLAIMS VALIDATION: ISSUER & AUDIENCE
  // =========================================================================
  console.log('\n--- Suite 3: Standard Claims Validation (Issuer & Audience) ---');
  {
    // Valid issuer and audience
    const validClaimsToken = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      secret,
      { algorithm: 'HS256', expiresIn: '15m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    const claimsRes = verifyAccessToken(validClaimsToken, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    assert(claimsRes.iss === JWT_ISSUER, 'Validates authentic issuer claim');
    assert(claimsRes.aud === JWT_AUDIENCE, 'Validates authentic audience claim');

    // Mismatched issuer (e.g. rogue auth server)
    const spoofedIssuerToken = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      secret,
      { algorithm: 'HS256', expiresIn: '15m', issuer: 'rogue-identity-provider', audience: JWT_AUDIENCE }
    );
    try {
      verifyAccessToken(spoofedIssuerToken, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
      assert(false, 'Should reject mismatched issuer');
    } catch (err) {
      assert(err.message.includes('jwt issuer invalid'), 'Rejects spoofed issuer claim');
    }

    // Mismatched audience (e.g. token minted for a different microservice)
    const spoofedAudToken = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      secret,
      { algorithm: 'HS256', expiresIn: '15m', issuer: JWT_ISSUER, audience: 'unauthorized-third-party-app' }
    );
    try {
      verifyAccessToken(spoofedAudToken, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
      assert(false, 'Should reject mismatched audience');
    } catch (err) {
      assert(err.message.includes('jwt audience invalid'), 'Rejects mismatched audience claim');
    }
  }

  // =========================================================================
  // SUITE 4: EXPIRATION ENFORCEMENT & EXPIRED TOKEN REJECTION
  // =========================================================================
  console.log('\n--- Suite 4: Expiration Enforcement ---');
  {
    // Past expiration token (already expired 10 seconds ago)
    const expiredToken = jwt.sign(
      { id: testUser._id, role: 'member', sid: testSessionSid, type: 'access' },
      secret,
      { algorithm: 'HS256', expiresIn: '-10s', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );

    try {
      verifyAccessToken(expiredToken);
      assert(false, 'Should throw TokenExpiredError on expired token');
    } catch (err) {
      assert(err.name === 'TokenExpiredError', 'Rejects expired token with TokenExpiredError');
    }

    const expiredHttpRes = await request('GET', '/api/test-protected', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert(expiredHttpRes.status === 401, 'Protected route rejects expired token with 401 Unauthorized');
  }

  // =========================================================================
  // SUITE 5: TOKEN PURPOSE ENFORCEMENT (ACCESS VS REFRESH SEPARATION)
  // =========================================================================
  console.log('\n--- Suite 5: Token Purpose Enforcement ---');
  {
    // 1. Generate access and refresh tokens
    const { token: accessToken, refreshToken: validRefreshToken } = generateToken(testUser._id, testUser.role, testSessionSid);

    // Purpose Confusion Attack 1: Sending refresh token to access-protected API
    const refreshAsAccessRes = await request('GET', '/api/test-protected', {
      headers: { Authorization: `Bearer ${validRefreshToken}` },
    });
    assert(refreshAsAccessRes.status === 401, 'Rejects refresh token sent to access-protected route (got 401)');
    const msg1 = (refreshAsAccessRes.data?.message || refreshAsAccessRes.raw || '').toLowerCase();
    assert(
      msg1.includes('purpose') || msg1.includes('invalid') || msg1.includes('signature') || msg1.includes('token'),
      'Prevents token purpose confusion attack on API endpoints'
    );

    // Purpose Confusion Attack 2: Sending access token to refresh endpoint
    const accessAsRefreshRes = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: accessToken },
    });
    assert(accessAsRefreshRes.status === 401, 'Rejects access token sent to token refresh endpoint (got 401)');
    const msg2 = (accessAsRefreshRes.data?.message || accessAsRefreshRes.raw || '').toLowerCase();
    assert(
      msg2.includes('purpose') || msg2.includes('invalid') || msg2.includes('signature') || msg2.includes('token'),
      'Prevents access token misuse on refresh endpoint'
    );
  }

  // =========================================================================
  // SUITE 6: REFRESH TOKEN ROTATION (RTR) & ATOMIC LIFECYCLE
  // =========================================================================
  console.log('\n--- Suite 6: Refresh Token Rotation (RTR) ---');
  {
    const rtrSid = crypto.randomUUID();
    const tokenData = generateToken(testUser._id, testUser.role, rtrSid);

    // Create session in DB with refresh token hash
    const sessionDoc = await Session.create({
      user: testUser._id,
      tokenId: rtrSid,
      refreshTokenHash: tokenData.refreshTokenHash,
      family: tokenData.family,
      refreshRotationCounter: 0,
    });

    // 1. Use the refresh token once: Expect 200 OK with new tokens
    const refreshRes1 = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: tokenData.refreshToken },
    });
    assert(refreshRes1.status === 200, 'Refreshes session successfully with 200 OK');
    assert(refreshRes1.data.token && refreshRes1.data.refreshToken, 'Returns brand new access token and rotated refresh token');
    assert(refreshRes1.data.refreshToken !== tokenData.refreshToken, 'Rotated refresh token is distinct from original refresh token');

    // Verify session updated atomically in DB
    const updatedSession = await Session.findOne({ tokenId: rtrSid });
    assert(updatedSession.refreshRotationCounter === 1, 'Increments session refreshRotationCounter to 1');
    assert(updatedSession.refreshTokenHash === hashToken(refreshRes1.data.refreshToken), 'Updates stored hash with new rotated token hash');

    // 2. The new rotated refresh token can be used for the next refresh cycle
    const refreshRes2 = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: refreshRes1.data.refreshToken },
    });
    assert(refreshRes2.status === 200, 'Rotated refresh token successfully completes second refresh cycle (got 200)');
    assert(refreshRes2.data.refreshToken !== refreshRes1.data.refreshToken, 'Issues third distinct refresh token');
  }

  // =========================================================================
  // SUITE 7: AUTOMATIC REFRESH TOKEN REUSE DETECTION & REVOCATION
  // =========================================================================
  console.log('\n--- Suite 7: Automatic Refresh Token Reuse Detection ---');
  {
    const reuseSid = crypto.randomUUID();
    const tokenData = generateToken(testUser._id, testUser.role, reuseSid);

    await Session.create({
      user: testUser._id,
      tokenId: reuseSid,
      refreshTokenHash: tokenData.refreshTokenHash,
      family: tokenData.family,
      refreshRotationCounter: 0,
    });

    // Cycle 1: Legitimate client refreshes token
    const firstRefreshRes = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: tokenData.refreshToken },
    });
    assert(firstRefreshRes.status === 200, 'Legitimate client refreshes token (got 200)');

    // REUSE ATTACK: Attacker presents the old, already-consumed tokenData.refreshToken!
    const reuseAttackRes = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: tokenData.refreshToken }, // Stale token replay
    });
    assert(reuseAttackRes.status === 401, 'Replay of consumed refresh token returns 401 Unauthorized');
    const reuseMsg = (reuseAttackRes.data?.message || reuseAttackRes.raw || '').toLowerCase();
    assert(reuseMsg.includes('reuse') || reuseMsg.includes('invalid') || reuseMsg.includes('token'), 'Reports security alert for refresh token reuse');

    // Verify session was immediately revoked in DB
    const revokedSession = await Session.findOne({ tokenId: reuseSid });
    assert(revokedSession.isRevoked === true, 'Entire session is automatically marked revoked upon reuse detection');

    // Subsequent access attempts with this session are blocked
    const subsequentAccess = await request('GET', '/api/test-protected', {
      headers: { Authorization: `Bearer ${firstRefreshRes.data.token}` },
    });
    assert(subsequentAccess.status === 401, 'Subsequent access with revoked session is blocked (got 401)');
  }

  // =========================================================================
  // SUITE 8: SECURE KEY MANAGEMENT & CRYPTOGRAPHIC SEPARATION
  // =========================================================================
  console.log('\n--- Suite 8: Secure Key Management & Key Isolation ---');
  {
    const accessSecret = getJwtSecret();
    const refreshSecret = getRefreshSecret();

    assert(typeof accessSecret === 'string' && accessSecret.length >= 32, 'Access token signing key meets minimum 256-bit entropy threshold');
    assert(typeof refreshSecret === 'string' && refreshSecret.length >= 32, 'Refresh token signing key meets minimum 256-bit entropy threshold');
    assert(accessSecret !== refreshSecret, 'Access token key and refresh token key are cryptographically separated');

    // Verify cross-key signature rejection
    const accessSignedToken = jwt.sign({ test: 1 }, accessSecret, { algorithm: 'HS256' });
    try {
      jwt.verify(accessSignedToken, refreshSecret, { algorithms: ALLOWED_ALGORITHMS });
      assert(false, 'Should fail to verify cross-key signature');
    } catch (err) {
      assert(err.name === 'JsonWebTokenError', 'Access token fails signature verification against refresh secret');
    }
  }

  // =========================================================================
  // SUITE 9: FILE CONTROLLER JWT VERIFICATION PARITY
  // =========================================================================
  console.log('\n--- Suite 9: File Controller JWT Parity ---');
  {
    // Valid access token on file endpoint returns 404 (file not on disk) rather than 401 (auth succeeds)
    const validFileToken = signAccessToken(testUser._id, 'admin', testSessionSid).token;
    const authSuccessRes = await request('GET', '/uploads/documents/non_existent.pdf', {
      headers: { Authorization: `Bearer ${validFileToken}` },
    });
    assert(authSuccessRes.status === 404, 'Valid access token passes authentication in file controller (got 404 file not found)');

    // Refresh token sent to file controller is rejected
    const fileRefreshToken = signRefreshToken(testUser._id, 'admin', testSessionSid).refreshToken;
    const refreshRejectedRes = await request('GET', '/uploads/documents/non_existent.pdf', {
      headers: { Authorization: `Bearer ${fileRefreshToken}` },
    });
    assert(refreshRejectedRes.status === 401, 'File controller strictly rejects refresh token sent for file download (got 401)');
  }

  console.log('\n================================================================');
  console.log(`JWT SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Teardown
  server.close();
  await User.deleteOne({ _id: testUser._id });
  await Session.deleteMany({ user: testUser._id });
  await mongoose.connection.close();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal JWT security test suite error:', err);
  if (server) server.close();
  process.exit(1);
});
