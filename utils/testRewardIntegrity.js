/**
 * Automated Test Suite for Coupon, Referral & Loyalty Redemptions Integrity
 * 
 * Verifies:
 * 1. Redemption limits (global usage limit & per-user limit)
 * 2. Expiration checks (validFrom, validUntil, isActive)
 * 3. Uniqueness constraints & self-referral prevention
 * 4. Concurrency protection: simultaneous parallel requests CANNOT double-redeem
 * 5. Atomic loyalty point deductions preventing race conditions and double-spending
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
const Wallet = require('../models/Wallet');
const Coupon = require('../models/Coupon');
const Redemption = require('../models/Redemption');
const LoyaltyAccount = require('../models/LoyaltyAccount');

// Middleware & Routes
const { errorHandler, notFound } = require('../middleware/errorHandler');
const { denyByDefault } = require('../middleware/auth');
const rewardRoutes = require('../routes/rewardRoutes');
const { seedCoupons } = require('../services/rewardService');

let server;
let baseUrl;

function request(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const bodyBuffer =
      body !== null
        ? Buffer.isBuffer(body)
          ? body
          : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
        : null;

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyBuffer ? { 'Content-Length': bodyBuffer.length } : {}),
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
    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n================================================================');
  console.log('   COUPON, REFERRAL & LOYALTY REWARDS INTEGRITY & CONCURRENCY TESTS');
  console.log('================================================================\n');

  await connectDB();
  await seedCoupons();

  // Clean up previous test users & records
  const testEmails = [
    'reward_alice@crm.com',
    'reward_bob@crm.com',
    'reward_charlie@crm.com',
    'reward_dave@crm.com',
  ];
  for (let i = 0; i < 10; i++) testEmails.push(`race_user_${i}@crm.com`);

  await User.deleteMany({ email: { $in: testEmails } });
  await Coupon.deleteMany({ code: { $in: ['EXPIRED10', 'FUTURE20', 'INACTIVE50', 'RACE_COUPON_1', 'USER_LIMIT_1'] } });

  // Create primary test users
  const alice = await User.create({
    name: 'Alice Referrer',
    email: 'reward_alice@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
    referralCode: 'REF-ALICE-100',
  });

  const bob = await User.create({
    name: 'Bob Referee',
    email: 'reward_bob@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  const charlie = await User.create({
    name: 'Charlie Racer',
    email: 'reward_charlie@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  const dave = await User.create({
    name: 'Dave Points',
    email: 'reward_dave@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  function makeToken(user) {
    return jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || 'test_jwt_secret',
      { expiresIn: '1h' }
    );
  }

  const aliceToken = makeToken(alice);
  const bobToken = makeToken(bob);
  const charlieToken = makeToken(charlie);
  const daveToken = makeToken(dave);

  // Setup express test server
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(['/api/rewards', '/rewards'], denyByDefault);
  app.use(['/api/rewards', '/rewards'], rewardRoutes);
  app.use(notFound);
  app.use(errorHandler);

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

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

  console.log('--- 1. COUPON EXPIRATION, SCHEDULE & STATUS INTEGRITY ---');
  {
    // Expired coupon check
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await Coupon.create({
      code: 'EXPIRED10',
      description: 'Expired test coupon',
      discountType: 'percentage',
      discountValue: 10,
      minOrderAmount: 100,
      validFrom: lastWeek,
      validUntil: yesterday, // Expired yesterday
      isActive: true,
    });

    const res = await request('POST', '/api/rewards/coupons/validate', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { code: 'EXPIRED10', amount: 1000 },
    });
    assert(res.status === 400, `Expired coupon is rejected with 400 (got ${res.status})`);
  }
  {
    // Future promotion check (not yet valid)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await Coupon.create({
      code: 'FUTURE20',
      description: 'Future test coupon',
      discountType: 'percentage',
      discountValue: 20,
      minOrderAmount: 100,
      validFrom: tomorrow, // Starts tomorrow
      validUntil: nextWeek,
      isActive: true,
    });

    const res = await request('POST', '/api/rewards/coupons/validate', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { code: 'FUTURE20', amount: 1000 },
    });
    assert(res.status === 400, `Future unstarted coupon is rejected with 400 (got ${res.status})`);
  }
  {
    // Deactivated coupon check (isActive: false)
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await Coupon.create({
      code: 'INACTIVE50',
      description: 'Deactivated test coupon',
      discountType: 'flat',
      discountValue: 50,
      minOrderAmount: 100,
      validFrom: lastWeek,
      validUntil: nextWeek,
      isActive: false, // Deactivated
    });

    const res = await request('POST', '/api/rewards/coupons/validate', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { code: 'INACTIVE50', amount: 500 },
    });
    assert(res.status === 400, `Deactivated coupon is rejected with 400 (got ${res.status})`);
  }
  {
    // Minimum spend threshold enforcement
    const res = await request('POST', '/api/rewards/coupons/validate', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { code: 'WELCOME10', amount: 500 }, // min is ₹1,000
    });
    assert(res.status === 400, `Order below minimum amount is rejected with 400 (got ${res.status})`);
  }
  {
    // Valid coupon calculates authorized discount correctly
    const res = await request('POST', '/api/rewards/coupons/validate', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { code: 'WELCOME10', amount: 2000 },
    });
    assert(res.status === 200, `Valid coupon returns 200 (got ${res.status})`);
    assert(res.data.discount === 200, `10% discount on ₹2,000 is ₹200 (got ${res.data.discount})`);
  }

  console.log('\n--- 2. CONCURRENT COUPON REDEMPTION RACE CONDITION TEST ---');
  {
    await Coupon.deleteMany({ code: 'RACE_COUPON_1' });
    await Redemption.deleteMany({ couponCode: 'RACE_COUPON_1' });
    await User.deleteMany({ email: /^race_user_/ });

    // Create a flash coupon with usageLimit: 1 (strictly ONE redemption globally)
    const now = new Date();
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await Coupon.create({
      code: 'RACE_COUPON_1',
      description: 'Single-use flash coupon for race condition testing',
      discountType: 'flat',
      discountValue: 100,
      minOrderAmount: 500,
      usageLimit: 1, // Only 1 lucky user can redeem!
      timesRedeemed: 0,
      perUserLimit: 1,
      validFrom: now,
      validUntil: nextMonth,
      isActive: true,
    });

    // Create 10 distinct test users and fire 10 simultaneous requests
    const raceUsers = [];
    for (let i = 0; i < 10; i++) {
      const u = await User.create({
        name: `Racer ${i}`,
        email: `race_user_${i}@crm.com`,
        password: 'Password123!',
        role: 'member',
        status: 'active',
        isApproved: true,
      });
      raceUsers.push(u);
    }

    console.log('    Firing 10 simultaneous concurrent requests to redeem 1-use coupon...');
    const results = await Promise.all(
      raceUsers.map((u, i) =>
        request('POST', '/api/rewards/coupons/redeem', {
          headers: { Authorization: `Bearer ${makeToken(u)}` },
          body: {
            code: 'RACE_COUPON_1',
            orderId: `ord_race_${i}`,
            amount: 1000,
          },
        })
      )
    );

    const successCount = results.filter((r) => r.status === 200).length;
    const failureCount = results.filter((r) => r.status === 400 || r.status === 409).length;

    assert(successCount === 1, `Exactly 1 concurrent request succeeded (got ${successCount})`);
    assert(failureCount === 9, `Remaining 9 concurrent requests failed gracefully (got ${failureCount})`);

    const finalCoupon = await Coupon.findOne({ code: 'RACE_COUPON_1' });
    assert(finalCoupon.timesRedeemed === 1, `TimesRedeemed in database is strictly 1 (got ${finalCoupon.timesRedeemed})`);
  }

  console.log('\n--- 3. PER-USER REDEMPTION LIMIT ENFORCEMENT ---');
  {
    // Create coupon with perUserLimit: 1
    const now = new Date();
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await Coupon.create({
      code: 'USER_LIMIT_1',
      description: 'Coupon with perUserLimit = 1',
      discountType: 'flat',
      discountValue: 50,
      minOrderAmount: 200,
      usageLimit: 100,
      timesRedeemed: 0,
      perUserLimit: 1, // Only 1 per user
      validFrom: now,
      validUntil: nextMonth,
      isActive: true,
    });

    // Alice redeems on order 1
    const res1 = await request('POST', '/api/rewards/coupons/redeem', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        code: 'USER_LIMIT_1',
        orderId: 'ord_alice_first',
        amount: 500,
      },
    });
    assert(res1.status === 200, `Alice's first redemption succeeds with 200 (got ${res1.status})`);

    // Alice attempts second redemption on order 2
    const res2 = await request('POST', '/api/rewards/coupons/redeem', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        code: 'USER_LIMIT_1',
        orderId: 'ord_alice_second',
        amount: 500,
      },
    });
    assert(res2.status === 400, `Alice's second redemption is rejected with 400 per-user limit (got ${res2.status})`);
  }

  console.log('\n--- 4. REFERRAL REWARD WORKFLOW & UNIQUENESS CONSTRAINTS ---');
  {
    // Alice attempts self-referral
    const res = await request('POST', '/api/rewards/referral/claim', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { referralCode: alice.referralCode },
    });
    assert(res.status === 400, `Self-referral is rejected with 400 (got ${res.status})`);
  }
  {
    // Bob legitimately claims Alice's referral code
    const res = await request('POST', '/api/rewards/referral/claim', {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { referralCode: alice.referralCode },
    });
    assert(res.status === 200, `Bob's referral claim succeeds with 200 (got ${res.status})`);
    assert(res.data.refereeReward === 100, `Bob receives ₹100 signup credit (got ${res.data.refereeReward})`);

    // Verify Bob's wallet balance
    const bobWallet = await Wallet.findOne({ userId: bob._id });
    assert(bobWallet.balance === 100, `Bob's wallet balance credited to ₹100 (got ${bobWallet.balance})`);

    // Verify Alice's wallet balance
    const aliceWallet = await Wallet.findOne({ userId: alice._id });
    assert(aliceWallet.balance === 200, `Alice's wallet balance credited with ₹200 referral bonus (got ${aliceWallet.balance})`);
  }
  {
    // Bob attempts to claim a referral a second time
    const res = await request('POST', '/api/rewards/referral/claim', {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { referralCode: alice.referralCode },
    });
    assert(res.status === 409, `Duplicate referral claim is rejected with 409 Conflict (got ${res.status})`);
  }

  console.log('\n--- 5. CONCURRENT REFERRAL CLAIM RACE CONDITION TEST ---');
  {
    // Charlie fires 5 simultaneous concurrent referral claim requests
    console.log('    Firing 5 simultaneous concurrent requests from Charlie to claim referral...');
    const results = await Promise.all([
      request('POST', '/api/rewards/referral/claim', {
        headers: { Authorization: `Bearer ${charlieToken}` },
        body: { referralCode: alice.referralCode },
      }),
      request('POST', '/api/rewards/referral/claim', {
        headers: { Authorization: `Bearer ${charlieToken}` },
        body: { referralCode: alice.referralCode },
      }),
      request('POST', '/api/rewards/referral/claim', {
        headers: { Authorization: `Bearer ${charlieToken}` },
        body: { referralCode: alice.referralCode },
      }),
      request('POST', '/api/rewards/referral/claim', {
        headers: { Authorization: `Bearer ${charlieToken}` },
        body: { referralCode: alice.referralCode },
      }),
      request('POST', '/api/rewards/referral/claim', {
        headers: { Authorization: `Bearer ${charlieToken}` },
        body: { referralCode: alice.referralCode },
      }),
    ]);

    const successCount = results.filter((r) => r.status === 200).length;
    const conflictCount = results.filter((r) => r.status === 409).length;

    assert(successCount === 1, `Exactly 1 concurrent referral claim succeeded (got ${successCount})`);
    assert(conflictCount === 4, `Remaining 4 concurrent claims rejected with 409 Conflict (got ${conflictCount})`);

    // Verify Charlie's wallet was credited only ONCE (₹100, NOT ₹500!)
    const charlieWallet = await Wallet.findOne({ userId: charlie._id });
    assert(charlieWallet.balance === 100, `Charlie's wallet credited exactly once for ₹100 (got ${charlieWallet.balance})`);
  }

  console.log('\n--- 6. LOYALTY POINTS ATOMIC REDEMPTIONS & CONCURRENCY PROTECTION ---');
  {
    // Setup Dave with exactly 500 loyalty points
    await LoyaltyAccount.findOneAndUpdate(
      { userId: dave._id },
      { points: 500, lifetimeEarned: 500, tier: 'silver' },
      { upsert: true, new: true }
    );

    // Dave fires 5 simultaneous concurrent requests to redeem 500 points (reward_100: costs 500 pts for ₹100)
    console.log('    Firing 5 simultaneous concurrent requests to redeem 500 points with balance of 500...');
    const results = await Promise.all([
      request('POST', '/api/rewards/loyalty/redeem', {
        headers: { Authorization: `Bearer ${daveToken}` },
        body: { rewardId: 'reward_100' },
      }),
      request('POST', '/api/rewards/loyalty/redeem', {
        headers: { Authorization: `Bearer ${daveToken}` },
        body: { rewardId: 'reward_100' },
      }),
      request('POST', '/api/rewards/loyalty/redeem', {
        headers: { Authorization: `Bearer ${daveToken}` },
        body: { rewardId: 'reward_100' },
      }),
      request('POST', '/api/rewards/loyalty/redeem', {
        headers: { Authorization: `Bearer ${daveToken}` },
        body: { rewardId: 'reward_100' },
      }),
      request('POST', '/api/rewards/loyalty/redeem', {
        headers: { Authorization: `Bearer ${daveToken}` },
        body: { rewardId: 'reward_100' },
      }),
    ]);

    const successCount = results.filter((r) => r.status === 200).length;
    const failureCount = results.filter((r) => r.status === 400).length;

    assert(successCount === 1, `Exactly 1 loyalty redemption succeeded (got ${successCount})`);
    assert(failureCount === 4, `Remaining 4 concurrent attempts failed with 400 Insufficient points (got ${failureCount})`);

    // Verify Dave's points balance is 0 (never negative!)
    const finalAccount = await LoyaltyAccount.findOne({ userId: dave._id });
    assert(finalAccount.points === 0, `Dave's points balance is exactly 0 (got ${finalAccount.points})`);

    // Verify Dave's wallet was credited only once (₹100, NOT ₹500!)
    const daveWallet = await Wallet.findOne({ userId: dave._id });
    assert(daveWallet.balance === 100, `Dave's wallet was credited exactly once with ₹100 (got ${daveWallet.balance})`);
  }

  console.log('\n================================================================');
  console.log(`REWARDS & CONCURRENCY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Teardown
  await Promise.all([
    User.deleteMany({ email: { $in: testEmails } }),
    Session.deleteMany({ user: { $in: [alice._id, bob._id, charlie._id, dave._id] } }),
    Wallet.deleteMany({ userId: { $in: [alice._id, bob._id, charlie._id, dave._id] } }),
    Coupon.deleteMany({ code: { $in: ['EXPIRED10', 'FUTURE20', 'INACTIVE50', 'RACE_COUPON_1', 'USER_LIMIT_1'] } }),
    Redemption.deleteMany({ userId: { $in: [alice._id, bob._id, charlie._id, dave._id] } }),
    LoyaltyAccount.deleteMany({ userId: { $in: [alice._id, bob._id, charlie._id, dave._id] } }),
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
  console.error('Fatal rewards test suite error:', err);
  if (server) server.close();
  process.exit(1);
});
