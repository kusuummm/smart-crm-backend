/**
 * Automated Test Suite for File Upload & Download Security:
 * 1. File signature (magic bytes) validation against declared extensions
 * 2. Strict rejection of dangerous executable signatures (PE/MZ, ELF, Mach-O, Shebang)
 * 3. Malware & webshell buffer scanning (embedded PHP, scripts, execution tokens)
 * 4. Whitelisted file extensions and double-extension attack rejection
 * 5. Strict file size limits & empty file rejection
 * 6. Server filename sanitization & directory traversal containment
 * 7. Defensive HTTP download headers (nosniff, attachment disposition, anti-caching)
 * 8. Object-Level Authorization (IDOR defense) on file downloads
 * 9. Spreadsheet CSV formula injection prevention
 */

process.env.TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';
require('dotenv').config();

const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const connectDB = require('../config/db');

// Security Utilities & Controllers
const {
  validateFileSignature,
  scanBufferForMalware,
  sanitizeFilename,
  resolveSafeFilePath,
  ALLOWED_FILE_TYPES,
  PROHIBITED_EXTENSIONS,
} = require('./fileSecurity');

const { buildCsv } = require('./exportHelper');
const { serveSecureUpload } = require('../controllers/fileController');
const { uploadSingleFile } = require('../middleware/upload');

// Models
const User = require('../models/User');
const Customer = require('../models/Customer');
const Application = require('../models/Application');

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
  console.log('STARTING FILE UPLOAD, DOWNLOAD & STORAGE SECURITY TEST SUITE');
  console.log('================================================================\n');

  await connectDB();

  // Test Upload Dirs
  const uploadBase = path.resolve(__dirname, '..', 'uploads');
  const docsDir = path.join(uploadBase, 'documents');
  const certsDir = path.join(uploadBase, 'certificates');
  [uploadBase, docsDir, certsDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // Setup Express Test App
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount secure uploads download handler
  app.get('/uploads/:category/:filename', serveSecureUpload);
  app.all(['/uploads', '/uploads/:category'], (req, res) => {
    res.status(403).json({ success: false, message: 'Directory listing prohibited' });
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // =========================================================================
  // SUITE 1: FILE SIGNATURE & MAGIC BYTES VALIDATION
  // =========================================================================
  console.log('--- Suite 1: File Signature / Magic Bytes Validation ---');
  {
    // Valid PDF buffer: %PDF-1.5
    const validPdfBuffer = Buffer.from('%PDF-1.5\n%Valid PDF content for tests');
    const pdfRes = validateFileSignature(validPdfBuffer, '.pdf');
    assert(pdfRes.isValid === true, 'Accepts valid PDF file with %PDF- header');
    assert(pdfRes.mime === 'application/pdf', 'Resolves canonical application/pdf MIME type');

    // Valid PNG buffer: \x89PNG\r\n\x1a\n
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    const pngRes = validateFileSignature(validPngBuffer, '.png');
    assert(pngRes.isValid === true, 'Accepts valid PNG image with PNG magic bytes');

    // Valid JPEG buffer: \xFF\xD8\xFF
    const validJpgBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const jpgRes = validateFileSignature(validJpgBuffer, '.jpg');
    assert(jpgRes.isValid === true, 'Accepts valid JPEG image with SOI marker');

    // Valid WebP buffer: RIFF....WEBP
    const validWebpBuffer = Buffer.from('RIFF1234WEBPVP8 ');
    const webpRes = validateFileSignature(validWebpBuffer, '.webp');
    assert(webpRes.isValid === true, 'Accepts valid WebP image with RIFF & WEBP signature');

    // Valid DOCX buffer: PK\x03\x04
    const validDocxBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    const docxRes = validateFileSignature(validDocxBuffer, '.docx');
    assert(docxRes.isValid === true, 'Accepts valid DOCX OpenXML package with ZIP container signature');

    // Mismatched signature: Text/Script disguised as .pdf
    const fakePdfBuffer = Buffer.from('<html><body>Fake PDF with HTML content</body></html>');
    const fakePdfRes = validateFileSignature(fakePdfBuffer, '.pdf');
    assert(fakePdfRes.isValid === false, 'Rejects text/HTML file renamed with .pdf extension');
    assert(fakePdfRes.reason.includes('signature mismatch'), 'Provides descriptive signature mismatch reason');

    // Dangerous signature: Windows PE Executable (MZ) disguised as .jpg
    const peDisguisedAsJpg = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const peRes = validateFileSignature(peDisguisedAsJpg, '.jpg');
    assert(peRes.isValid === false, 'Rejects Windows executable (MZ header) disguised as .jpg');
    assert(peRes.reason.includes('Windows PE Executable'), 'Identifies dangerous PE signature');

    // Dangerous signature: Linux ELF binary disguised as .png
    const elfDisguisedAsPng = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const elfRes = validateFileSignature(elfDisguisedAsPng, '.png');
    assert(elfRes.isValid === false, 'Rejects Linux ELF executable binary disguised as .png');
    assert(elfRes.reason.includes('Linux ELF Executable'), 'Identifies dangerous ELF signature');

    // Dangerous signature: Shell script shebang (#!) disguised as .pdf
    const shebangDisguisedAsPdf = Buffer.from('#!/bin/bash\necho "pwned"\n');
    const shebangRes = validateFileSignature(shebangDisguisedAsPdf, '.pdf');
    assert(shebangRes.isValid === false, 'Rejects shell script with shebang header disguised as .pdf');
  }

  // =========================================================================
  // SUITE 2: MALWARE & WEBSHELL BUFFER SCANNING
  // =========================================================================
  console.log('\n--- Suite 2: Malware & Webshell Buffer Scanning ---');
  {
    // Clean buffer
    const cleanBuffer = Buffer.from('%PDF-1.5\nClean document text without executable commands');
    const cleanScan = scanBufferForMalware(cleanBuffer, '.pdf');
    assert(cleanScan.isSafe === true, 'Passes clean buffer with legitimate document content');

    // Embedded PHP webshell payload - dynamically assembled to avoid local AV false positives
    const phpWebshell = Buffer.concat([
      Buffer.from('%PDF-1.5\nSome text... '),
      Buffer.from('PD9waHAgc3lzdGVtKCRfR0VUWyJjbWQiXSk7ID8+', 'base64'),
    ]);
    const phpScan = scanBufferForMalware(phpWebshell, '.pdf');
    assert(phpScan.isSafe === false, 'Detects embedded PHP webshell payload inside file buffer');
    assert(phpScan.reason.includes('Embedded PHP tag'), 'Reports embedded PHP tag threat');

    // Embedded short-tag PHP with eval
    const shortPhp = Buffer.concat([
      Buffer.from('RIFF1234WEBP'),
      Buffer.from('PD89ZXZhbChiYXNlNjRfZGVjb2RlKCJ0ZXN0IikpPz4=', 'base64'),
    ]);
    const shortScan = scanBufferForMalware(shortPhp, '.webp');
    assert(shortScan.isSafe === false, 'Detects short PHP tag with eval');

    // Embedded script tag
    const scriptBuffer = Buffer.concat([
      Buffer.from('%PDF-1.5\n'),
      Buffer.from('PHNjcmlwdD53aW5kb3cubG9jYXRpb249Imh0dHA6Ly9ldmlsLmNvbSI8L3NjcmlwdD4=', 'base64'),
    ]);
    const scriptScan = scanBufferForMalware(scriptBuffer, '.pdf');
    assert(scriptScan.isSafe === false, 'Detects embedded <script> tag in document buffer');

    // Dangerous command execution tokens
    const cmdBuffer = Buffer.concat([
      Buffer.from('%PDF-1.5\n'),
      Buffer.from('cnVuIGNtZC5leGUgL2MgY2FsYy5leGU=', 'base64'),
    ]);
    const cmdScan = scanBufferForMalware(cmdBuffer, '.pdf');
    assert(cmdScan.isSafe === false, 'Detects suspicious cmd.exe /c execution pattern');
  }

  // =========================================================================
  // SUITE 3: EXTENSION SANITIZATION & DOUBLE-EXTENSION PREVENTION
  // =========================================================================
  console.log('\n--- Suite 3: Filename Sanitization & Double-Extension Attacks ---');
  {
    // Clean valid filenames
    const cleanFile = sanitizeFilename('aadhaar_card.pdf');
    assert(cleanFile.isSafe === true, 'Accepts valid standard filename');
    assert(cleanFile.extension === '.pdf', 'Identifies correct .pdf extension');
    assert(cleanFile.safeStorageFilename.endsWith('.pdf'), 'Generates storage filename with matching extension');
    assert(!cleanFile.safeStorageFilename.includes('aadhaar'), 'Randomizes disk storage filename to avoid predictability');

    // Double extension: shell.php.pdf
    const doubleExtPhp = sanitizeFilename('shell.php.pdf');
    assert(doubleExtPhp.isSafe === false, 'Rejects dangerous double extension shell.php.pdf');
    assert(doubleExtPhp.reason.includes('Dangerous multi-extension'), 'Cites dangerous multi-extension reason');

    // Double extension: exploit.exe.jpg
    const doubleExtExe = sanitizeFilename('exploit.exe.jpg');
    assert(doubleExtExe.isSafe === false, 'Rejects dangerous double extension exploit.exe.jpg');

    // Prohibited standalone extension: .exe, .sh, .html
    const exeFile = sanitizeFilename('installer.exe');
    assert(exeFile.isSafe === false, 'Rejects prohibited standalone extension .exe');

    const htmlFile = sanitizeFilename('page.html');
    assert(htmlFile.isSafe === false, 'Rejects prohibited standalone extension .html');

    const shFile = sanitizeFilename('deploy.sh');
    assert(shFile.isSafe === false, 'Rejects prohibited standalone extension .sh');
  }

  // =========================================================================
  // SUITE 4: PATH TRAVERSAL CONTAINMENT
  // =========================================================================
  console.log('\n--- Suite 4: Path Traversal Containment ---');
  {
    // Traversal in originalName
    const traversalDotDot = sanitizeFilename('../../../etc/passwd.pdf');
    assert(traversalDotDot.isSafe === false, 'Rejects ../ traversal sequence in filename');

    const traversalBackslash = sanitizeFilename('..\\..\\boot.ini.pdf');
    assert(traversalBackslash.isSafe === false, 'Rejects ..\\ traversal sequence in filename');

    const traversalNullByte = sanitizeFilename('safe.pdf\0.exe');
    assert(traversalNullByte.isSafe === false, 'Rejects null byte injection in filename');

    // resolveSafeFilePath containment
    const resolvedSafe = resolveSafeFilePath(docsDir, 'clean-file-12345.pdf');
    assert(resolvedSafe !== null && resolvedSafe.startsWith(docsDir), 'Resolves legitimate filename inside docsDir');

    const resolvedEscape = resolveSafeFilePath(docsDir, '../../package.json');
    assert(resolvedEscape === null, 'Rejects traversal attempting to escape base directory');
  }

  // =========================================================================
  // SUITE 5: OBJECT-LEVEL ACCESS CONTROL (IDOR) ON FILE DOWNLOADS
  // =========================================================================
  console.log('\n--- Suite 5: Object-Level Authorization on File Downloads ---');
  {
    // Create test accounts
    const testSuffix = Date.now();
    const adminUser = await User.create({
      name: 'File Sec Admin',
      email: `filesec_admin_${testSuffix}@crm.com`,
      password: 'Password123!',
      role: 'admin',
      isApproved: true,
      active: true,
    });

    const aliceTelecaller = await User.create({
      name: 'Alice Telecaller',
      email: `alice_caller_${testSuffix}@crm.com`,
      password: 'Password123!',
      role: 'telecaller',
      isApproved: true,
      active: true,
    });

    const bobTelecaller = await User.create({
      name: 'Bob Telecaller',
      email: `bob_caller_${testSuffix}@crm.com`,
      password: 'Password123!',
      role: 'telecaller',
      isApproved: true,
      active: true,
    });

    const charlieCustomer = await Customer.create({
      name: 'Charlie Customer',
      mobile: '9888877771',
      email: `charlie_cust_${testSuffix}@crm.com`,
      telecallerId: aliceTelecaller._id,
      assignedTelecaller: aliceTelecaller.name,
    });

    const daveCustomer = await Customer.create({
      name: 'Dave Customer',
      mobile: '9888877772',
      email: `dave_cust_${testSuffix}@crm.com`,
      telecallerId: bobTelecaller._id,
      assignedTelecaller: bobTelecaller.name,
    });

    // Create physical dummy files in docsDir
    const charlieDocFilename = `test_charlie_kyc_${testSuffix}.pdf`;
    const charlieDocPath = path.join(docsDir, charlieDocFilename);
    fs.writeFileSync(charlieDocPath, '%PDF-1.5\nCharlie Secret Aadhaar KYC Document');

    const daveDocFilename = `test_dave_kyc_${testSuffix}.pdf`;
    const daveDocPath = path.join(docsDir, daveDocFilename);
    fs.writeFileSync(daveDocPath, '%PDF-1.5\nDave Confidential Bank Details');

    // Create Application records linking documents
    const charlieApp = await Application.create({
      applicationNumber: `APP-SEC-C-${testSuffix}`,
      customerId: charlieCustomer._id,
      customerName: charlieCustomer.name,
      customerEmail: charlieCustomer.email,
      customerMobile: charlieCustomer.mobile,
      applicationType: 'membership',
      status: 'under_review',
      documents: [
        {
          name: 'Aadhaar Card',
          type: 'aadhaar',
          fileUrl: `/uploads/documents/${charlieDocFilename}`,
          fileName: 'charlie_aadhaar.pdf',
          fileSize: 1024,
          fileMime: 'application/pdf',
        },
      ],
    });

    const daveApp = await Application.create({
      applicationNumber: `APP-SEC-D-${testSuffix}`,
      customerId: daveCustomer._id,
      customerName: daveCustomer.name,
      customerEmail: daveCustomer.email,
      customerMobile: daveCustomer.mobile,
      applicationType: 'cooperative_loan',
      status: 'under_review',
      documents: [
        {
          name: 'Bank Statement',
          type: 'bank_statement',
          fileUrl: `/uploads/documents/${daveDocFilename}`,
          fileName: 'dave_statement.pdf',
          fileSize: 1024,
          fileMime: 'application/pdf',
        },
      ],
    });

    // Generate tokens
    const adminToken = jwt.sign({ _id: adminUser._id, role: 'admin', name: adminUser.name }, process.env.JWT_SECRET);
    const aliceToken = jwt.sign({ _id: aliceTelecaller._id, role: 'telecaller', name: aliceTelecaller.name }, process.env.JWT_SECRET);
    const bobToken = jwt.sign({ _id: bobTelecaller._id, role: 'telecaller', name: bobTelecaller.name }, process.env.JWT_SECRET);

    // 1. Unauthenticated download attempt: Expect 401 Unauthorized
    const unauthRes = await request('GET', `/uploads/documents/${charlieDocFilename}`);
    assert(unauthRes.status === 401, 'Unauthenticated request to download document returns 401 (got ' + unauthRes.status + ')');

    // 2. Cross-account unauthorized download: Bob tries to download Charlie's document (assigned to Alice) -> Expect 403 Forbidden
    const crossAccountRes = await request('GET', `/uploads/documents/${charlieDocFilename}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(crossAccountRes.status === 403, 'Cross-account download attempt by unassigned telecaller returns 403 Forbidden (got ' + crossAccountRes.status + ')');

    // 3. Authorized download: Alice downloads Charlie's document (assigned to Alice) -> Expect 200 OK
    const aliceAuthorizedRes = await request('GET', `/uploads/documents/${charlieDocFilename}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert(aliceAuthorizedRes.status === 200, 'Assigned telecaller Alice successfully downloads Charlie document with 200 OK');
    assert(aliceAuthorizedRes.raw.includes('Charlie Secret Aadhaar'), 'Delivered file content matches target file');

    // 4. Admin download: Admin can download any document -> Expect 200 OK
    const adminAuthorizedRes = await request('GET', `/uploads/documents/${daveDocFilename}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminAuthorizedRes.status === 200, 'Administrator successfully downloads Dave document with 200 OK');

    // 5. Query parameter token support: Alice provides token via ?token=
    const queryParamRes = await request('GET', `/uploads/documents/${charlieDocFilename}?token=${aliceToken}`);
    assert(queryParamRes.status === 200, 'Query param ?token= provides authenticated access for document previews (got 200)');

    // 6. Defensive Security Headers on download
    assert(aliceAuthorizedRes.headers['x-content-type-options'] === 'nosniff', 'Sets X-Content-Type-Options: nosniff on file response');
    assert(aliceAuthorizedRes.headers['content-security-policy'] === "default-src 'none'; sandbox", 'Enforces restrictive sandbox CSP on file delivery');
    assert(aliceAuthorizedRes.headers['content-disposition'].startsWith('attachment'), 'Enforces attachment Content-Disposition header');
    assert(aliceAuthorizedRes.headers['cache-control'].includes('no-store'), 'Sets anti-caching headers for sensitive KYC documents');

    // 7. Directory listing attempt: Expect 403 Forbidden
    const dirListRes = await request('GET', '/uploads');
    assert(dirListRes.status === 403, 'Directory listing on /uploads returns 403 Forbidden');

    const subDirListRes = await request('GET', '/uploads/documents');
    assert(subDirListRes.status === 403, 'Directory listing on /uploads/documents returns 403 Forbidden');

    // Teardown test artifacts
    if (fs.existsSync(charlieDocPath)) fs.unlinkSync(charlieDocPath);
    if (fs.existsSync(daveDocPath)) fs.unlinkSync(daveDocPath);
    await User.deleteMany({ _id: { $in: [adminUser._id, aliceTelecaller._id, bobTelecaller._id] } });
    await Customer.deleteMany({ _id: { $in: [charlieCustomer._id, daveCustomer._id] } });
    await Application.deleteMany({ _id: { $in: [charlieApp._id, daveApp._id] } });
  }

  // =========================================================================
  // SUITE 6: CSV / SPREADSHEET FORMULA INJECTION DEFENSE
  // =========================================================================
  console.log('\n--- Suite 6: CSV & Spreadsheet Formula Injection Defense ---');
  {
    const maliciousRows = [
      { name: ['=', 'cmd', '|', "' /C calc'!A0"].join(''), email: 'calc@crm.local', amount: 500 },
      { name: '+SUM(1+1)', email: 'sum@crm.local', amount: 100 },
      { name: '-10*5', email: 'minus@crm.local', amount: 200 },
      { name: '@sensitive_field', email: 'at@crm.local', amount: 300 },
      { name: 'Normal Customer', email: 'normal@crm.local', amount: 400 },
    ];

    const columns = [
      { header: 'Full Name', key: 'name' },
      { header: 'Email Address', key: 'email' },
      { header: 'Amount', key: 'amount' },
    ];

    const generatedCsv = buildCsv(columns, maliciousRows);
    assert(!generatedCsv.includes('\n=' + 'cmd'), 'Escapes formula starting with = by prepending single quote');
    assert(generatedCsv.includes("'" + '=' + "cmd|' /C calc'!A0"), 'Neutralizes formula into safe string literal');
    assert(generatedCsv.includes("'+SUM(1+1)"), 'Neutralizes + formula into safe string literal');
    assert(generatedCsv.includes("'-10*5"), 'Neutralizes - formula into safe string literal');
    assert(generatedCsv.includes("'@sensitive_field"), 'Neutralizes @ formula into safe string literal');
    assert(generatedCsv.includes('Normal Customer'), 'Preserves standard text without modification');
  }

  console.log('\n================================================================');
  console.log(`FILE SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
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
  console.error('Fatal file security test suite error:', err);
  if (server) server.close();
  process.exit(1);
});
