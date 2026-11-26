/**
 * Automated Test Suite for Payment Provider Verification, Webhooks & Fulfillment Integrity
 * 
 * Verifies:
 * 1. Webhook HMAC-SHA256 signature validation using raw request body
 * 2. Rejection of forged, malformed, or missing webhook signatures
 * 3. Validation of transaction amounts (in paise), currency ('INR'), and order identifiers
 * 4. Prevention of order fulfillment for unconfirmed, pending, or failed payments
 * 5. Strong idempotency: duplicate webhook deliveries do not double-credit wallet or re-fulfill orders
 * 6. Direct backend provider verification (status check with payment gateway before settlement)
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const connectDB = require('../config/db');

// Models
const User = require('../models/User');
const Session = require('../models/Session');
const Wallet = require('../models/Wallet');
const Order = require('../models/Order');

// Middleware & Routes
const { errorHandler, notFound } = require('../middleware/errorHandler');
const { denyByDefault } = require('../middleware/auth');
const walletRoutes = require('../routes/walletRoutes');
const {
  verifyWebhookSignature,
  verifyPaymentWithProvider,
  fulfillOrderPayment,
} = require('../services/paymentProviderService');

let server;
let baseUrl;
const TEST_WEBHOOK_SECRET = 'test_wh_secret_xyz987654321';

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

function signWebhookPayload(payloadObj, secret = TEST_WEBHOOK_SECRET) {
  const rawBody = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return { rawBody, signature };
}

async function runTests() {
  console.log('\n================================================================');
  console.log('   PAYMENT PROVIDER VERIFICATION & WEBHOOK REGRESSION TESTS');
  console.log('================================================================\n');

  process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

  await connectDB();

  // Clean up previous test records
  const testEmails = ['payment_tester@crm.com', 'payment_buyer@crm.com'];
  await User.deleteMany({ email: { $in: testEmails } });

  const testUser = await User.create({
    name: 'Payment Tester',
    email: 'payment_tester@crm.com',
    password: 'Password123!',
    role: 'member',
    status: 'active',
    isApproved: true,
  });

  const session = await Session.create({
    user: testUser._id,
    tokenId: `sid_${Date.now()}_${Math.random()}`,
    ipAddress: '127.0.0.1',
    userAgent: 'PaymentTestRunner',
  });

  const userToken = jwt.sign(
    { id: testUser._id, role: testUser.role, sid: session.tokenId },
    process.env.JWT_SECRET || 'test_jwt_secret',
    { expiresIn: '1h' }
  );

  // Setup express test server
  const app = express();
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(['/api/wallet', '/wallet'], denyByDefault);
  app.use(['/api/wallet', '/wallet'], walletRoutes);
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

  console.log('--- 1. WEBHOOK SIGNATURE INTEGRITY & REJECTION OF FORGERY ---');
  {
    // Webhook without signature header is rejected
    const { rawBody } = signWebhookPayload({ event: 'payment.captured' });
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    });
    assert(res.status === 400, `Webhook without signature header is rejected with 400 (got ${res.status})`);
  }
  {
    // Webhook with tampered/forged signature is rejected
    const { rawBody } = signWebhookPayload({ event: 'payment.captured' });
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: rawBody,
    });
    assert(res.status === 400, `Webhook with forged signature is rejected with 400 (got ${res.status})`);
  }
  {
    // Webhook signed with wrong secret is rejected
    const { rawBody, signature } = signWebhookPayload({ event: 'payment.captured' }, 'wrong_attacker_secret');
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
      },
      body: rawBody,
    });
    assert(res.status === 400, `Webhook signed with unauthorized secret is rejected with 400 (got ${res.status})`);
  }

  console.log('\n--- 2. TRANSACTION AMOUNTS, CURRENCIES & ORDER IDENTIFIERS ---');
  let topupOrder;
  {
    // Create authentic order for ₹500 top-up
    const res = await request('POST', '/api/wallet/create-order', {
      headers: { Authorization: `Bearer ${userToken}` },
      body: { amount: 500 },
    });
    assert(res.status === 200, `Create order returns 200 (got ${res.status})`);
    topupOrder = res.data;
  }
  {
    // Webhook with mismatched/unknown order ID is rejected
    const fakeEvent = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_001',
            order_id: 'order_nonexistent_999999',
            amount: 50000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const { rawBody, signature } = signWebhookPayload(fakeEvent);
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    assert(res.status === 404, `Webhook for non-existent order is rejected with 404 (got ${res.status})`);
  }
  {
    // Webhook with tampered amount (sending ₹100 instead of ₹500) is rejected
    const tamperedAmountEvent = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_tamper_amt',
            order_id: topupOrder.orderId,
            amount: 10000, // ₹100 in paise instead of ₹500
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const { rawBody, signature } = signWebhookPayload(tamperedAmountEvent);
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    assert(res.status === 400, `Webhook with tampered amount is rejected with 400 (got ${res.status})`);

    // Ensure order was NOT fulfilled
    const dbOrder = await Order.findOne({ orderId: topupOrder.orderId });
    assert(dbOrder.status === 'created', `Order remains in 'created' status after tampered amount attempt`);
  }
  {
    // Webhook with unsupported currency (e.g. USD instead of INR) is rejected
    const wrongCurrencyEvent = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_wrong_curr',
            order_id: topupOrder.orderId,
            amount: 50000,
            currency: 'USD',
            status: 'captured',
          },
        },
      },
    };
    const { rawBody, signature } = signWebhookPayload(wrongCurrencyEvent);
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    assert(res.status === 400, `Webhook with non-INR currency is rejected with 400 (got ${res.status})`);
  }

  console.log('\n--- 3. UNCONFIRMED PAYMENTS & FAILED PAYMENT HANDLING ---');
  let failedTestOrder;
  {
    // Create order to test failed status
    const res = await request('POST', '/api/wallet/create-order', {
      headers: { Authorization: `Bearer ${userToken}` },
      body: { amount: 250 },
    });
    failedTestOrder = res.data;
  }
  {
    // Webhook with unconfirmed payment status (e.g. 'created' or 'pending') is rejected
    const pendingPaymentEvent = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_pending',
            order_id: failedTestOrder.orderId,
            amount: 25000,
            currency: 'INR',
            status: 'pending', // NOT captured
          },
        },
      },
    };
    const { rawBody, signature } = signWebhookPayload(pendingPaymentEvent);
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    assert(res.status === 400, `Unconfirmed / pending payment webhook is rejected with 400 (got ${res.status})`);
  }
  {
    // Webhook with payment.failed marks order as failed and does not credit wallet
    const failedPaymentEvent = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_failed',
            order_id: failedTestOrder.orderId,
            amount: 25000,
            currency: 'INR',
            status: 'failed',
            error_description: 'Payment dropped by customer bank',
          },
        },
      },
    };
    const { rawBody, signature } = signWebhookPayload(failedPaymentEvent);
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    assert(res.status === 200, `Payment.failed event acknowledged with 200 (got ${res.status})`);

    const dbOrder = await Order.findOne({ orderId: failedTestOrder.orderId });
    assert(dbOrder.status === 'failed', `Order status transitioned to 'failed'`);

    // Verify wallet balance remained 0
    const wallet = await Wallet.findOne({ userId: testUser._id });
    assert(!wallet || wallet.balance === 0, `Wallet balance remains untouched after payment failure`);
  }

  console.log('\n--- 4. IDEMPOTENT ORDER FULFILLMENT VIA WEBHOOK ---');
  {
    // Legitimate payment.captured webhook with exact server amount (₹500 = 50000 paise)
    const validCaptureEvent = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_legit_capture',
            order_id: topupOrder.orderId,
            amount: 50000, // Exact paise
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const { rawBody, signature } = signWebhookPayload(validCaptureEvent);
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    assert(res.status === 200, `Legitimate payment.captured webhook processed with 200 (got ${res.status})`);
    assert(res.data.idempotent === false, `Initial fulfillment is marked non-idempotent (fresh fulfillment)`);

    // Verify database updates
    const dbOrder = await Order.findOne({ orderId: topupOrder.orderId });
    assert(dbOrder.status === 'paid', `Order status transitioned to 'paid'`);

    const wallet = await Wallet.findOne({ userId: testUser._id });
    assert(wallet.balance === 500, `Wallet balance successfully credited to ₹500 (got ${wallet.balance})`);
  }
  {
    // Duplicate delivery of the exact same payment.captured webhook (Idempotency test)
    const validCaptureEvent = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_legit_capture',
            order_id: topupOrder.orderId,
            amount: 50000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const { rawBody, signature } = signWebhookPayload(validCaptureEvent);
    const res = await request('POST', '/api/wallet/webhook/razorpay', {
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    assert(res.status === 200, `Duplicate webhook delivery returns 200 OK (got ${res.status})`);
    assert(res.data.idempotent === true, `Duplicate webhook delivery identified as idempotent no-op`);

    // Verify wallet balance is STILL ₹500 (NO duplicate credit!)
    const wallet = await Wallet.findOne({ userId: testUser._id });
    assert(wallet.balance === 500, `Wallet balance remains exactly ₹500 without duplicate credit (got ${wallet.balance})`);
  }
  {
    // Client attempts to call /api/wallet/recharge on order that was already fulfilled by webhook
    const res = await request('POST', '/api/wallet/recharge', {
      headers: { Authorization: `Bearer ${userToken}` },
      body: {
        orderId: topupOrder.orderId,
        paymentMethod: 'Razorpay',
        paymentId: 'pay_client_duplicate_attempt',
      },
    });
    assert(res.status === 409, `Client recharge call on webhook-fulfilled order returns 409 Conflict (got ${res.status})`);
  }

  console.log('\n--- 5. DIRECT PROVIDER STATUS VERIFICATION UNIT CHECKS ---');
  {
    // Test direct verification rejection on unconfirmed status
    let threw = false;
    try {
      await verifyPaymentWithProvider({
        paymentId: 'pay_mock_unconfirmed',
        expectedOrderId: 'order_123',
        expectedAmount: 1000,
        mockClient: {
          fetchPayment: async () => ({
            id: 'pay_mock_unconfirmed',
            status: 'failed',
            amount: 100000,
            currency: 'INR',
            order_id: 'order_123',
          }),
        },
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 400, `Provider verification rejects non-captured payment (status: failed)`);
    }
    assert(threw, `Provider verification threw error for unconfirmed status`);
  }
  {
    // Test direct verification rejection on amount mismatch
    let threw = false;
    try {
      await verifyPaymentWithProvider({
        paymentId: 'pay_mock_amt_mismatch',
        expectedOrderId: 'order_123',
        expectedAmount: 500, // expected ₹500 = 50000 paise
        mockClient: {
          fetchPayment: async () => ({
            id: 'pay_mock_amt_mismatch',
            status: 'captured',
            amount: 10000, // only 10000 paise
            currency: 'INR',
            order_id: 'order_123',
          }),
        },
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 400, `Provider verification rejects amount mismatch`);
    }
    assert(threw, `Provider verification threw error for amount mismatch`);
  }
  {
    // Test direct verification rejection on currency mismatch
    let threw = false;
    try {
      await verifyPaymentWithProvider({
        paymentId: 'pay_mock_curr_mismatch',
        expectedOrderId: 'order_123',
        expectedAmount: 500,
        expectedCurrency: 'INR',
        mockClient: {
          fetchPayment: async () => ({
            id: 'pay_mock_curr_mismatch',
            status: 'captured',
            amount: 50000,
            currency: 'EUR',
            order_id: 'order_123',
          }),
        },
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 400, `Provider verification rejects currency mismatch`);
    }
    assert(threw, `Provider verification threw error for currency mismatch`);
  }
  {
    // Test direct verification rejection on order ID mismatch
    let threw = false;
    try {
      await verifyPaymentWithProvider({
        paymentId: 'pay_mock_order_mismatch',
        expectedOrderId: 'order_expected_123',
        expectedAmount: 500,
        mockClient: {
          fetchPayment: async () => ({
            id: 'pay_mock_order_mismatch',
            status: 'captured',
            amount: 50000,
            currency: 'INR',
            order_id: 'order_different_999',
          }),
        },
      });
    } catch (err) {
      threw = true;
      assert(err.statusCode === 400, `Provider verification rejects order ID mismatch`);
    }
    assert(threw, `Provider verification threw error for order ID mismatch`);
  }
  {
    // Test direct verification success on confirmed captured payment
    const verified = await verifyPaymentWithProvider({
      paymentId: 'pay_mock_success',
      expectedOrderId: 'order_match_123',
      expectedAmount: 500,
      mockClient: {
        fetchPayment: async () => ({
          id: 'pay_mock_success',
          status: 'captured',
          amount: 50000,
          currency: 'INR',
          order_id: 'order_match_123',
        }),
      },
    });
    assert(verified.verified === true && verified.status === 'captured', `Provider verification successfully confirms captured payment`);
  }

  console.log('\n================================================================');
  console.log(`PAYMENT VERIFICATION & WEBHOOK RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Teardown
  await Promise.all([
    User.deleteMany({ email: { $in: testEmails } }),
    Session.deleteMany({ user: testUser._id }),
    Wallet.deleteMany({ userId: testUser._id }),
    Order.deleteMany({ userId: testUser._id }),
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
  console.error('Fatal payment test suite error:', err);
  if (server) server.close();
  process.exit(1);
});
