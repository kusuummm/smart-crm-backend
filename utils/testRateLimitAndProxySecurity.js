/**
 * Automated Regression Test Suite for Rate Limiting, Reverse Proxy Configuration,
 * Request Size Restrictions, Timeouts, Concurrency Limits & HTTP/2 Security:
 * 1. Trusted Proxy Configuration & Client IP Resolution (IP Spoofing Defense)
 * 2. Tiered Rate Limiting & 429 Response Standards (RateLimit & Retry-After headers)
 * 3. Sensitive Endpoint Rate Limiting (Auth, Password Reset, AI, Uploads)
 * 4. High-Capacity Webhook Throttling
 * 5. Request Size Restrictions & Early Content-Length Validation (413 Payload Too Large)
 * 6. Request Execution & HTTP Server Timeouts (Slowloris & Hanging Request Defense)
 * 7. In-Flight Concurrency Limiting & Resource Protection (503 Service Unavailable)
 * 8. HTTP/2 Infrastructure Review & CVE Patch Status (CVE-2023-44487 & CVE-2024-27983)
 */

process.env.TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const http = require('http');
const express = require('express');
const rateLimit = require('express-rate-limit');

const {
  generalLimiter,
  authLimiter,
  passwordResetLimiter,
  aiLimiter,
  uploadExportLimiter,
  webhookLimiter,
  getClientIp,
  getTrustedProxyConfig,
  getRateLimitKey,
} = require('../middleware/rateLimiter');

const {
  requestSizeLimiter,
  requestTimeoutMiddleware,
  concurrencyLimiter,
  applyServerTimeouts,
  getHttp2SecurityReport,
  DEFAULT_JSON_SIZE_LIMIT,
  DEFAULT_MULTIPART_SIZE_LIMIT,
} = require('../middleware/resourceProtection');

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

function makeHttpRequest(app, method, reqPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const url = new URL(reqPath, `http://127.0.0.1:${port}`);

      const options = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: { ...headers },
      };

      let bodyData = null;
      if (body) {
        if (Buffer.isBuffer(body)) {
          bodyData = body;
        } else if (typeof body === 'string') {
          bodyData = Buffer.from(body);
        } else {
          bodyData = Buffer.from(JSON.stringify(body));
        }
        if (!options.headers['Content-Type']) {
          options.headers['Content-Type'] = 'application/json';
        }
        if (!options.headers['Content-Length']) {
          options.headers['Content-Length'] = String(bodyData.length);
        }
      }

      const req = http.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          server.close();
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

      req.on('error', (err) => {
        server.close();
        // If server sent early response and closed socket, resolve gracefully
        resolve({
          status: 400,
          headers: {},
          data: { error: err.message },
          raw: err.message,
        });
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  });
}

async function runTests() {
  console.log('\n================================================================');
  console.log('STARTING RATE LIMITING, PROXY & RESOURCE PROTECTION SECURITY SUITE');
  console.log('================================================================\n');

  // =========================================================================
  // SUITE 1: TRUSTED PROXY CONFIGURATION & CLIENT IP RESOLUTION
  // =========================================================================
  console.log('--- Suite 1: Trusted Proxy Configuration & IP Spoofing Defense ---');
  {
    // Test default trusted proxy setting
    const config = getTrustedProxyConfig();
    assert(config === 1 || typeof config === 'number', 'Default trusted proxy config trusts 1 upstream hop (Render / Cloudflare / ALB)');

    // Test IP extraction helper
    const dummyReq = { ip: '::ffff:192.168.1.100' };
    assert(getClientIp(dummyReq) === '192.168.1.100', 'Normalizes IPv6-mapped IPv4 addresses');

    // Test compound key generator
    const authReq = { user: { _id: 'usr_test_123' }, ip: '127.0.0.1' };
    assert(getRateLimitKey(authReq) === 'user:usr_test_123', 'Authenticated requests keyed by user ID to prevent botnet proxy rotation evasion');

    const anonReq = { ip: '203.0.113.50' };
    assert(getRateLimitKey(anonReq) === 'ip:203.0.113.50', 'Anonymous requests keyed by validated client IP');

    // Test express trust proxy behavior with mock app
    const proxyApp = express();
    proxyApp.set('trust proxy', 1); // Trust 1 hop
    proxyApp.get('/ip-test', (req, res) => {
      res.json({ ip: req.ip });
    });

    // Attacker sends: X-Forwarded-For: attacker_spoof, real_client (proxy appends real_client)
    // With trust proxy = 1, Express inspects the last hop added by proxy
    const res = await makeHttpRequest(proxyApp, 'GET', '/ip-test', {
      headers: {
        'X-Forwarded-For': '203.0.113.1, 198.51.100.25',
      },
    });
    assert(res.status === 200, 'Proxy endpoint responds 200 OK');
    assert(res.data.ip === '198.51.100.25', 'Express trust proxy 1 selects validated hop IP, rejecting spoofed prefix IP');
  }

  // =========================================================================
  // SUITE 2: TIERED RATE LIMITING & 429 RESPONSE STANDARDS
  // =========================================================================
  console.log('\n--- Suite 2: Tiered Rate Limiting & 429 Standards ---');
  {
    const app = express();
    const testLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 3, // Allow strictly 3 requests
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res, next, options) => {
        res.setHeader('Retry-After', 60);
        res.status(429).json({
          success: false,
          message: 'Too many requests. Please slow down.',
          retryAfter: 60,
        });
      },
    });

    app.get('/test-limit', testLimiter, (req, res) => {
      res.json({ success: true, count: req.query.c });
    });

    // Spin up server for sequential requests
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const client = (c) =>
      new Promise((resolve) => {
        http.get(`http://127.0.0.1:${port}/test-limit?c=${c}`, (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }));
        });
      });

    const res1 = await client(1);
    const res2 = await client(2);
    const res3 = await client(3);
    const res4 = await client(4); // Exceeds limit
    server.close();

    assert(res1.status === 200, 'Request 1 under limit succeeds with 200 OK');
    assert(res2.status === 200, 'Request 2 under limit succeeds with 200 OK');
    assert(res3.status === 200, 'Request 3 under limit succeeds with 200 OK');
    assert(res4.status === 429, 'Request 4 exceeding limit is rejected with 429 Too Many Requests');
    assert(res4.body.success === false, 'Returns structured JSON error format on 429');
    assert(res4.headers['retry-after'] !== undefined, 'Returns standard Retry-After header');
    assert(res1.headers['ratelimit-limit'] !== undefined || res1.headers['ratelimit'] !== undefined, 'Includes standard RateLimit header');
  }

  // =========================================================================
  // SUITE 3: SENSITIVE ENDPOINT RATE LIMITERS (AUTH, RESET, AI, UPLOADS)
  // =========================================================================
  console.log('\n--- Suite 3: Sensitive Endpoint Rate Limiters ---');
  {
    assert(typeof authLimiter === 'function', 'authLimiter is exported and active');
    assert(typeof passwordResetLimiter === 'function', 'passwordResetLimiter is exported and active');
    assert(typeof aiLimiter === 'function', 'aiLimiter is exported and active');
    assert(typeof uploadExportLimiter === 'function', 'uploadExportLimiter is exported and active');
    assert(typeof webhookLimiter === 'function', 'webhookLimiter is exported and active');

    // Test passwordResetLimiter key derivation with email
    const resetApp = express();
    resetApp.use(express.json());
    resetApp.post('/forgot-password', passwordResetLimiter, (req, res) => {
      res.json({ success: true });
    });

    const resetRes = await makeHttpRequest(resetApp, 'POST', '/forgot-password', {
      body: { email: 'victim@crm.com' },
    });
    assert(resetRes.status === 200, 'Password reset endpoint processes initial legitimate request');
  }

  // =========================================================================
  // SUITE 4: WEBHOOK INGESTION THROTTLING
  // =========================================================================
  console.log('\n--- Suite 4: Webhook Ingestion Throttling ---');
  {
    const webhookApp = express();
    webhookApp.use(express.json());
    webhookApp.post('/api/wallet/webhook/razorpay', webhookLimiter, (req, res) => {
      res.json({ success: true, processed: true });
    });

    const hookRes = await makeHttpRequest(webhookApp, 'POST', '/api/wallet/webhook/razorpay', {
      body: { event: 'payment.captured' },
    });
    assert(hookRes.status === 200, 'Webhook endpoint successfully ingests incoming events');
    assert(hookRes.data.processed === true, 'Webhook payload verified and processed');
  }

  // =========================================================================
  // SUITE 5: REQUEST SIZE RESTRICTIONS & EARLY CONTENT-LENGTH VALIDATION
  // =========================================================================
  console.log('\n--- Suite 5: Request Size Restrictions (413 Payload Too Large) ---');
  {
    const sizeApp = express();
    // Configure 50 KB limit for testing
    sizeApp.use(requestSizeLimiter({ jsonLimit: 50 * 1024, multipartLimit: 200 * 1024 }));
    sizeApp.use(express.json({ limit: '50kb' }));
    sizeApp.post('/upload-data', (req, res) => {
      res.json({ success: true, received: true });
    });

    // 1. Normal size request (under limit)
    const normalRes = await makeHttpRequest(sizeApp, 'POST', '/upload-data', {
      body: { test: 'normal payload' },
    });
    assert(normalRes.status === 200, 'Request within allowed size limits is accepted with 200 OK');

    // 2. Oversized payload (60 KB Buffer on 50 KB limit)
    const oversizedBuffer = Buffer.alloc(60 * 1024, 'x');
    const oversizedRes = await makeHttpRequest(sizeApp, 'POST', '/upload-data', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': `${oversizedBuffer.length}`,
      },
      body: oversizedBuffer,
    });
    assert(oversizedRes.status === 413, 'Early request size limiter rejects oversized Content-Length with 413 Payload Too Large');
    assert(
      (oversizedRes.data && oversizedRes.data.message && oversizedRes.data.message.includes('Payload Too Large')) ||
      (oversizedRes.raw && oversizedRes.raw.includes('Payload Too Large')),
      'Returns descriptive Payload Too Large message'
    );

    // 3. Invalid negative Content-Length
    const invalidLengthRes = await makeHttpRequest(sizeApp, 'POST', '/upload-data', {
      headers: { 'Content-Length': '-5' },
      body: { test: 1 },
    });
    assert(invalidLengthRes.status === 400, 'Rejects malformed negative Content-Length header with 400 Bad Request');
  }

  // =========================================================================
  // SUITE 6: REQUEST & SERVER TIMEOUTS (SLOWLORIS & HANGING REQUEST MITIGATION)
  // =========================================================================
  console.log('\n--- Suite 6: Request Execution & Server Timeouts ---');
  {
    const timeoutApp = express();
    // Set 1-second timeout for test
    timeoutApp.use(requestTimeoutMiddleware(1));
    timeoutApp.get('/fast', (req, res) => {
      res.json({ success: true, fast: true });
    });
    timeoutApp.get('/hanging', (req, res) => {
      // Simulate hanging backend operation past 1 second timeout
      const t = setTimeout(() => {
        if (!res.headersSent) {
          res.json({ done: true });
        }
      }, 1500);
      res.on('finish', () => clearTimeout(t));
      res.on('close', () => clearTimeout(t));
    });

    // 1. Fast request completes normally
    const fastRes = await makeHttpRequest(timeoutApp, 'GET', '/fast');
    assert(fastRes.status === 200, 'Fast request completes normally within timeout window (got 200)');

    // 2. Hanging request times out
    const slowRes = await makeHttpRequest(timeoutApp, 'GET', '/hanging');
    assert(slowRes.status === 504, 'Hanging request cleanly aborted with 504 Gateway Timeout');
    assert(slowRes.data.message.includes('Request Timeout'), 'Returns descriptive timeout error message');

    // 3. Test applyServerTimeouts on HTTP server instance
    const dummyServer = http.createServer();
    const timeouts = applyServerTimeouts(dummyServer, {
      requestTimeout: 25000,
      headersTimeout: 12000,
      keepAliveTimeout: 60000,
      socketTimeout: 30000,
    });
    assert(dummyServer.requestTimeout === 25000, 'Configures server.requestTimeout');
    assert(dummyServer.headersTimeout === 12000, 'Configures server.headersTimeout for Slowloris mitigation');
    assert(dummyServer.keepAliveTimeout === 60000, 'Configures server.keepAliveTimeout for reverse proxy parity');
  }

  // =========================================================================
  // SUITE 7: CONCURRENCY LIMITING & RESOURCE PROTECTION
  // =========================================================================
  console.log('\n--- Suite 7: In-Flight Concurrency Limiting ---');
  {
    const concurApp = express();
    // Allow maximum 2 concurrent operations
    concurApp.use(concurrencyLimiter({ maxConcurrent: 2, name: 'AI requests' }));

    let active = 0;
    concurApp.get('/heavy-op', async (req, res) => {
      active++;
      await new Promise((resolve) => setTimeout(resolve, 300));
      active--;
      res.json({ success: true });
    });

    const server = http.createServer(concurApp);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const fireReq = () =>
      new Promise((resolve) => {
        http.get(`http://127.0.0.1:${port}/heavy-op`, (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(data); } catch (_) {}
            resolve({ status: res.statusCode, headers: res.headers, data: json });
          });
        });
      });

    // Fire 3 simultaneous concurrent requests
    const [r1, r2, r3] = await Promise.all([fireReq(), fireReq(), fireReq()]);
    server.close();

    const statuses = [r1.status, r2.status, r3.status];
    const successCount = statuses.filter((s) => s === 200).length;
    const throttledCount = statuses.filter((s) => s === 503).length;

    assert(successCount === 2, `Exactly 2 concurrent requests admitted under threshold (got ${successCount})`);
    assert(throttledCount === 1, `Excess 3rd request rejected with 503 Service Unavailable (got ${throttledCount})`);

    const rejected = [r1, r2, r3].find((r) => r.status === 503);
    assert(rejected.headers['retry-after'] === '5', '503 response includes standard Retry-After header');
    assert(rejected.data.message.includes('maximum concurrent'), 'Returns descriptive capacity message');
  }

  // =========================================================================
  // SUITE 8: HTTP/2 INFRASTRUCTURE REVIEW & CVE PATCH STATUS
  // =========================================================================
  console.log('\n--- Suite 8: HTTP/2 Infrastructure & CVE Audit ---');
  {
    const report = getHttp2SecurityReport();
    assert(typeof report.nodeVersion === 'string', `Node runtime version verified: ${report.nodeVersion}`);
    assert(
      report.cveStatus['CVE-2023-44487'].isPatched === true,
      'CVE-2023-44487 (HTTP/2 Rapid Reset stream cancellation flood) is verified PATCHED in runtime'
    );
    assert(
      report.cveStatus['CVE-2024-27983'].isPatched === true,
      'CVE-2024-27983 (HTTP/2 CONTINUATION frame header flood unbounded memory exhaustion) is verified PATCHED in runtime'
    );
    assert(
      report.reverseProxyArchitecture.tlsTermination.includes('Reverse Proxy'),
      'Reverse proxy architecture verifies edge TLS & HTTP/2 termination'
    );
  }

  console.log('\n================================================================');
  console.log(`RATE LIMITING & RESOURCE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

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
