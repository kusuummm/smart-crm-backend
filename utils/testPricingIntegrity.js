/**
 * Automated Test Suite for Checkout, Pricing, and Transaction Integrity
 * 
 * Verifies:
 * 1. Product prices, taxes (GST 18%), and discounts are calculated strictly server-side
 * 2. Unauthorized pricing overrides & fake promo codes are rejected
 * 3. Client-submitted price tampering during checkout & order creation is blocked
 * 4. Recharge execution enforces trusted server order amount, rejecting tampered amounts
 * 5. Replay attacks and duplicate payments are blocked (idempotency)
 * 6. Cross-account order hijacking is rejected (BOLA)
 * 7. Application fees enforce server catalog and reject client price tampering
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
const Application = require('../models/Application');
const Wallet = require('../models/Wallet');
const Order = require('../models/Order');

// Middleware & Routes
const { errorHandler, notFound } = require('../middleware/errorHandler');
const { denyByDefault } = require('../middleware/auth');
const walletRoutes = require('../routes/walletRoutes');
const applicationRoutes = require('../routes/applicationRoutes');

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
  console.log('   CHECKOUT, PRICING & TRANSACTION INTEGRITY REGRESSION TESTS');
  console.log('================================================================\n');

  await connectDB();

  // Clean up any previous test records
  const testEmails = ['pricing_admin@crm.com', 'pricing_alice@crm.com', 'pricing_bob@crm.com'];
  await User.deleteMany({ email: { $in: testEmails } });
  await Customer.deleteMany({ email: 'pricing_client@example.org' });

  // Create test users
  const adminUser = await User.create({
    name: 'Pricing Admin',
    email: 'pricing_admin@crm.com',
    password: 'Password123!',
    role: 'admin',
    status: 'active',
    isApproved: true,
  });

  const memberAlice = await User.create({
    name: 'Alice Shopper',
    email: 'pricing_alice@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  const memberBob = await User.create({
    name: 'Bob Shopper',
    email: 'pricing_bob@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  // Create JWT tokens
  const adminSid = new mongoose.Types.ObjectId().toString();
  await Session.create({ user: adminUser._id, tokenId: adminSid, userAgent: 'test', ip: '127.0.0.1' });
  const adminToken = jwt.sign({ id: adminUser._id, role: adminUser.role, sid: adminSid }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const aliceSid = new mongoose.Types.ObjectId().toString();
  await Session.create({ user: memberAlice._id, tokenId: aliceSid, userAgent: 'test', ip: '127.0.0.1' });
  const aliceToken = jwt.sign({ id: memberAlice._id, role: memberAlice.role, sid: aliceSid }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const bobSid = new mongoose.Types.ObjectId().toString();
  await Session.create({ user: memberBob._id, tokenId: bobSid, userAgent: 'test', ip: '127.0.0.1' });
  const bobToken = jwt.sign({ id: memberBob._id, role: memberBob.role, sid: bobSid }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // Test Customer for Alice
  const aliceCustomer = await Customer.create({
    name: 'Alice VIP Corp',
    mobile: '9811122233',
    phone: '9811122233',
    email: 'pricing_client@example.org',
    telecallerId: memberAlice._id,
    assignedTelecaller: memberAlice.name,
    status: 'active',
  });

  // Spin up test server
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get('/api/health', (req, res) => res.json({ success: true }));
  app.use('/api', denyByDefault);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/applications', applicationRoutes);
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

  console.log('--- 1. SERVER-SIDE PRICING CATALOG & CALCULATION ---');
  {
    // Retrieve official pricing catalog
    const res = await request('GET', '/api/wallet/pricing/catalog', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(res.status === 200, `GET /api/wallet/pricing/catalog returns 200 (got ${res.status})`);
    assert(Array.isArray(res.data.products) && res.data.products.length >= 8, `Catalog contains valid products`);
    assert(res.data.standardTaxRate === 0.18, `Standard GST tax rate is 18%`);
  }
  {
    // Calculate pricing for Annual Pro plan without discounts
    const res = await request('POST', '/api/wallet/calculate-pricing', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        items: [{ productId: 'pro_annual', quantity: 1 }],
      },
    });
    assert(res.status === 200, `Calculate pricing for Pro Annual returns 200 (got ${res.status})`);
    assert(res.data.pricing.subtotal === 14999, `Subtotal is exact catalog price ₹14,999 (got ${res.data?.pricing?.subtotal})`);
    assert(res.data.pricing.taxAmount === 2699.82, `GST 18% is correctly calculated: ₹2,699.82 (got ${res.data?.pricing?.taxAmount})`);
    assert(res.data.pricing.total === 17698.82, `Final total is ₹17,698.82 (got ${res.data?.pricing?.total})`);
  }
  {
    // Calculate pricing with authorized promo code ANNUAL20 (20% off capped at ₹3,000)
    const res = await request('POST', '/api/wallet/calculate-pricing', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        items: [{ productId: 'pro_annual', quantity: 1 }],
        promoCode: 'ANNUAL20',
      },
    });
    assert(res.status === 200, `Calculate pricing with promo code returns 200 (got ${res.status})`);
    assert(res.data.pricing.discount === 2999.8, `Authorized discount is ₹2,999.80 (got ${res.data?.pricing?.discount})`);
    assert(res.data.pricing.total === 14159.06, `Final total after discount + 18% GST is ₹14,159.06 (got ${res.data?.pricing?.total})`);
  }

  console.log('\n--- 2. REJECTION OF UNAUTHORIZED PRICING CHANGES & FAKE PROMO CODES ---');
  {
    // Attacker submits an invalid / non-existent promo code
    const res = await request('POST', '/api/wallet/calculate-pricing', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        items: [{ productId: 'pro_annual', quantity: 1 }],
        promoCode: 'HACK99_FREE_EVERYTHING',
      },
    });
    assert(res.status === 400, `Fake promo code is rejected with 400 Bad Request (got ${res.status})`);
  }
  {
    // Attacker submits an unknown / forged product ID
    const res = await request('POST', '/api/wallet/calculate-pricing', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        items: [{ productId: 'custom_free_tier', quantity: 1 }],
      },
    });
    assert(res.status === 400, `Unknown product identifier is rejected with 400 Bad Request (got ${res.status})`);
  }
  {
    // Attacker claims an arbitrary discounted total during calculation (Price Tampering)
    const res = await request('POST', '/api/wallet/calculate-pricing', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        items: [{ productId: 'pro_annual', quantity: 1 }],
        claimedPricing: { total: 10 }, // Claims to pay only ₹10
      },
    });
    assert(res.status === 400, `Claimed pricing tampering is detected and rejected with 400 (got ${res.status})`);
  }
  {
    // Negative or zero wallet top-up
    const res = await request('POST', '/api/wallet/calculate-pricing', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { amount: -500 },
    });
    assert(res.status === 400, `Negative wallet amount is rejected with 400 (got ${res.status})`);
  }
  {
    // Below minimum recharge threshold
    const res = await request('POST', '/api/wallet/calculate-pricing', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { amount: 2 },
    });
    assert(res.status === 400, `Wallet amount below minimum (₹10) is rejected with 400 (got ${res.status})`);
  }

  console.log('\n--- 3. ORDER CREATION WITH AUTHORITATIVE DATA ---');
  let validOrder;
  {
    // Create an order for ₹500 wallet recharge
    const res = await request('POST', '/api/wallet/create-order', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { amount: 500 },
    });
    assert(res.status === 200, `Create order returns 200 (got ${res.status})`);
    assert(res.data.orderId !== undefined, `Server issued orderId: ${res.data?.orderId}`);
    assert(res.data.pricing.total === 500, `Order pricing total is verified at ₹500`);
    validOrder = res.data;

    // Verify order was persisted in MongoDB
    const dbOrder = await Order.findOne({ orderId: validOrder.orderId });
    assert(dbOrder !== null && dbOrder.status === 'created', `Order document securely persisted with status 'created'`);
  }
  {
    // Attacker attempts to create order with tampered claimed pricing
    const res = await request('POST', '/api/wallet/create-order', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        items: [{ productId: 'biz_phone_annual', quantity: 1 }],
        claimedPricing: { total: 1 }, // Try to purchase for ₹1
      },
    });
    assert(res.status === 400, `Order creation with tampered pricing is rejected with 400 (got ${res.status})`);
  }

  console.log('\n--- 4. TRANSACTION INTEGRITY, TAMPERING REJECTION & IDEMPOTENCY ---');
  {
    // Attacker attempts to recharge with a tampered amount (sending amount: 50000 on a ₹500 order)
    const res = await request('POST', '/api/wallet/recharge', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        orderId: validOrder.orderId,
        amount: 50000, // Tampered claim!
        paymentMethod: 'UPI',
        paymentId: `pay_fake_tamper_${Date.now()}`,
      },
    });
    assert(res.status === 400, `Recharge with tampered amount is rejected with 400 Bad Request (got ${res.status})`);
  }
  {
    // Bob attempts to pay / claim Alice's order (BOLA / Cross-Account Theft)
    const res = await request('POST', '/api/wallet/recharge', {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: {
        orderId: validOrder.orderId,
        paymentMethod: 'UPI',
        paymentId: `pay_bob_theft_${Date.now()}`,
      },
    });
    assert(res.status === 403, `Cross-account order execution is rejected with 403 Forbidden (got ${res.status})`);
  }
  {
    // Alice executes legitimate payment on her order
    const res = await request('POST', '/api/wallet/recharge', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        orderId: validOrder.orderId,
        paymentMethod: 'UPI',
        paymentId: `pay_alice_legit_${Date.now()}`,
      },
    });
    assert(res.status === 200, `Legitimate recharge succeeds with 200 (got ${res.status})`);
    assert(res.data.amountCredited === 500, `Amount credited matches trusted order total ₹500 (got ${res.data?.amountCredited})`);

    // Verify order marked paid in database
    const dbOrder = await Order.findOne({ orderId: validOrder.orderId });
    assert(dbOrder.status === 'paid', `Order status transitioned to 'paid'`);
  }
  {
    // Duplicate payment / Replay attack on the same order
    const res = await request('POST', '/api/wallet/recharge', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        orderId: validOrder.orderId,
        paymentMethod: 'UPI',
        paymentId: `pay_replay_attack_${Date.now()}`,
      },
    });
    assert(res.status === 409, `Replay attack on completed order is rejected with 409 Conflict (got ${res.status})`);
  }

  console.log('\n--- 5. APPLICATION FEE INTEGRITY ---');
  {
    // Member creates application for 'membership' (Trusted fee is ₹500)
    const res = await request('POST', '/api/applications', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        customerId: aliceCustomer._id,
        applicationType: 'membership',
      },
    });
    assert(res.status === 201, `Application created successfully with 201 (got ${res.status})`);
    assert(res.data.application.paymentAmount === 500, `Application fee automatically set to trusted catalog fee ₹500 (got ${res.data?.application?.paymentAmount})`);
    assert(res.data.application.paymentStatus === 'pending', `Default payment status is strictly 'pending'`);
  }
  {
    // Attacker attempts to tamper with application fee (claiming fee is ₹1 instead of ₹500)
    const res = await request('POST', '/api/applications', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        customerId: aliceCustomer._id,
        applicationType: 'membership',
        paymentAmount: 1, // Tampered!
      },
    });
    assert(res.status === 400, `Tampered application fee is rejected with 400 Bad Request (got ${res.status})`);
  }
  {
    // Non-admin attempts to mark payment completed without payment reference
    const res = await request('POST', '/api/applications', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: {
        customerId: aliceCustomer._id,
        applicationType: 'membership',
        paymentStatus: 'completed',
        // No paymentReference provided
      },
    });
    assert(res.status === 400, `Marking application payment completed without proof is rejected with 400 (got ${res.status})`);
  }

  console.log('\n================================================================');
  console.log(`TRANSACTION & PRICING INTEGRITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Clean up test records
  await Promise.all([
    User.deleteMany({ _id: { $in: [adminUser._id, memberAlice._id, memberBob._id] } }),
    Session.deleteMany({ user: { $in: [adminUser._id, memberAlice._id, memberBob._id] } }),
    Customer.deleteMany({ _id: aliceCustomer._id }),
    Application.deleteMany({ customerId: aliceCustomer._id }),
    Wallet.deleteMany({ userId: { $in: [adminUser._id, memberAlice._id, memberBob._id] } }),
    Order.deleteMany({ userId: { $in: [adminUser._id, memberAlice._id, memberBob._id] } }),
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
  console.error('Fatal pricing integrity test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
