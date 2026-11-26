/**
 * Automated Test Suite for Secret Scanning & Environment Management:
 * 1. Runtime Environment Validator (detects missing secrets & placeholder credentials)
 * 2. Secret Scanner Pattern Detection (detects AWS, Meta, Mongo, Private Keys, JWT secrets)
 * 3. Safe Redaction & Masking (ensures secrets are never logged in cleartext)
 * 4. Git Ignore Rules Verification (ensures .env and keys are never tracked)
 * 5. Configuration File Security (verifies no hardcoded secrets in render.yaml)
 * 6. Clean .env.example Developer Onboarding Templates
 */

process.env.TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { validateEnvironment, KNOWN_PLACEHOLDERS } = require('../config/envValidator');
const { runSecretScan, scanFile, SECRET_RULES } = require('./secretScanner');
const { installHooks } = require('./installGitHooks');

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
  console.log('STARTING SECRET SCANNING & ENVIRONMENT MANAGEMENT TEST SUITE');
  console.log('================================================================\n');

  // =========================================================================
  // SUITE 1: RUNTIME ENVIRONMENT VALIDATOR
  // =========================================================================
  console.log('--- Suite 1: Runtime Environment Validator ---');
  {
    const originalEnv = { ...process.env };

    // 1. Missing JWT_SECRET in production
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    try {
      validateEnvironment();
      assert(false, 'Should throw error when JWT_SECRET is missing in production');
    } catch (err) {
      assert(err.message.includes('validation failed'), 'Throws validation error when JWT_SECRET is missing in production');
    }

    // 2. Default placeholder JWT_SECRET in production
    process.env.JWT_SECRET = 'your_super_secret_jwt_key_here_change_in_production';
    try {
      validateEnvironment();
      assert(false, 'Should throw error when default placeholder JWT_SECRET is used in production');
    } catch (err) {
      assert(err.message.includes('validation failed'), 'Rejects default placeholder JWT_SECRET in production');
    }

    // 3. Placeholder MONGO_URI in production
    const dynamicValidJwt = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = dynamicValidJwt;
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/crm_with_password';
    try {
      validateEnvironment();
      assert(false, 'Should throw error when MONGO_URI contains placeholder in production');
    } catch (err) {
      assert(err.message.includes('validation failed'), 'Rejects placeholder credentials in MONGO_URI');
    }

    // 4. Valid, non-placeholder secrets in production (dynamically generated at runtime)
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/crm_production_db';
    process.env.RAZORPAY_KEY_SECRET = crypto.randomBytes(16).toString('hex');
    const validRes = validateEnvironment();
    assert(validRes.isValid === true, 'Validates successfully when production secrets are non-default and non-placeholder');

    // Restore environment
    process.env = originalEnv;
    process.env.TEST_SUITE = 'true';
    process.env.NODE_ENV = 'test';
  }

  // =========================================================================
  // SUITE 2: SECRET SCANNER PATTERN DETECTION
  // =========================================================================
  console.log('\n--- Suite 2: Secret Scanner Detection Engine ---');
  {
    // Test scratch file for scanning
    const testTempFile = path.join(__dirname, 'temp_test_secret_sample.txt');

    // Zero-literal dynamic runtime calculation of defanged test vectors (numeric byte array XOR)
    const decodeVector = (bytes) => bytes.map((b) => String.fromCharCode(b ^ 0x7B)).join('');
    const sampleAWS = decodeVector([58,48,50,58,50,52,40,61,52,63,53,53,76,44,35,34,33,58,57,56]);
    const sampleGoogle = decodeVector([58,50,1,26,40,2,63,16,66,73,48,16,23,43,10,41,8,47,46,13,12,35,2,33,75,74,73,72,79,78,77,76,67,66,26,25,24,31,30]);
    const sampleMongo = decodeVector([22,20,21,28,20,31,25,80,8,9,13,65,84,84,14,8,30,9,36,26,24,24,20,14,21,15,65,22,20,24,16,36,31,25,36,11,26,8,8,36,3,2,1,59,74,73,76,85,75,85,75,85,74,84,24,9,22,36,31,25]);
    const samplePrivKey = decodeVector([86,86,86,86,86,57,62,60,50,53,91,41,40,58,91,43,41,50,45,58,47,62,91,48,62,34,86,86,86,86,86]);

    const testContent = [
      `# Test file with simulated keys`,
      `aws_key: ${sampleAWS}`,
      `google_key: ${sampleGoogle}`,
      `db_uri: ${sampleMongo}`,
      `${samplePrivKey}`,
      `# Safe placeholder should be ignored`,
      `SAFE_VAR=your_placeholder_token_here`,
      `ANOTHER_SAFE=<password>`,
    ].join('\n');

    fs.writeFileSync(testTempFile, testContent, 'utf8');

    const issues = scanFile(testTempFile);

    // Verify findings
    const rulesFound = issues.map((i) => i.rule);
    assert(rulesFound.includes('AWS Access Key ID'), 'Detects exposed AWS Access Key ID');
    assert(rulesFound.includes('Google API / Gemini API Key'), 'Detects exposed Google API key');
    assert(rulesFound.includes('MongoDB Connection String with Password'), 'Detects MongoDB URI with embedded credentials');
    assert(rulesFound.includes('Private Encryption Key Header'), 'Detects private encryption key header');

    // Verify that safe placeholders were ignored
    const placeholderIssues = issues.filter((i) => i.masked.includes('placeholder') || i.masked.includes('password'));
    assert(placeholderIssues.length === 0, 'Correctly ignores dummy placeholder values without false positives');

    // Verify masking behavior: raw secret values must NOT be present in masked output
    const rawExposedInMasked = issues.some((i) => i.masked.includes(decodeVector([15,30,8,15,36,8,30,24,9,30,15])) || i.masked.includes('WXYZABC'));
    assert(rawExposedInMasked === false, 'Masked output securely redacts secret substrings (no cleartext leakage)');

    // Cleanup temp file
    if (fs.existsSync(testTempFile)) fs.unlinkSync(testTempFile);
  }

  // =========================================================================
  // SUITE 3: GITIGNORE RULES & TRACKED FILES INTEGRITY
  // =========================================================================
  console.log('\n--- Suite 3: Git Ignore & Tracked Files Integrity ---');
  {
    const backendGitignorePath = path.resolve(__dirname, '..', '.gitignore');
    const backendGitignore = fs.readFileSync(backendGitignorePath, 'utf8');

    assert(backendGitignore.includes('.env'), 'Backend .gitignore excludes .env files');
    assert(backendGitignore.includes('*.pem'), 'Backend .gitignore excludes *.pem certificate files');
    assert(backendGitignore.includes('*.key'), 'Backend .gitignore excludes *.key private key files');
    assert(backendGitignore.includes('credentials.json'), 'Backend .gitignore excludes credentials.json');
    assert(backendGitignore.includes('.npmrc'), 'Backend .gitignore excludes .npmrc auth tokens');

    const frontendGitignorePath = path.resolve(__dirname, '../../Smart-CRM/.gitignore');
    if (fs.existsSync(frontendGitignorePath)) {
      const frontendGitignore = fs.readFileSync(frontendGitignorePath, 'utf8');
      assert(frontendGitignore.includes('.env'), 'Frontend .gitignore excludes .env files');
      assert(frontendGitignore.includes('dist'), 'Frontend .gitignore excludes dist build artifacts');
      assert(frontendGitignore.includes('*.key'), 'Frontend .gitignore excludes *.key files');
    }
  }

  // =========================================================================
  // SUITE 4: CONFIGURATION SECURITY & RENDER.YAML AUDIT
  // =========================================================================
  console.log('\n--- Suite 4: Configuration Security & Render.yaml Audit ---');
  {
    const backendRenderPath = path.resolve(__dirname, '..', 'render.yaml');
    const backendRender = fs.readFileSync(backendRenderPath, 'utf8');

    // Verify WHATSAPP_VERIFY_TOKEN is sync: false, not hardcoded
    assert(
      !backendRender.includes('value: peyug_crm_webhook_verify_sec'),
      'Hardcoded webhook secret removed from backend render.yaml'
    );
    assert(
      backendRender.includes('key: WHATSAPP_VERIFY_TOKEN\n        sync: false') ||
      backendRender.includes('key: WHATSAPP_VERIFY_TOKEN\r\n        sync: false'),
      'WHATSAPP_VERIFY_TOKEN configured with sync: false in render.yaml'
    );
    assert(
      backendRender.includes('key: JWT_SECRET\n        generateValue: true') ||
      backendRender.includes('key: JWT_SECRET\r\n        generateValue: true'),
      'JWT_SECRET uses secure dynamic generation (generateValue: true) in render.yaml'
    );
  }

  // =========================================================================
  // SUITE 5: DEVELOPER ONBOARDING TEMPLATES (.ENV.EXAMPLE)
  // =========================================================================
  console.log('\n--- Suite 5: Developer Templates (.env.example) Sanitization ---');
  {
    const envExamplePath = path.resolve(__dirname, '..', '.env.example');
    const envExample = fs.readFileSync(envExamplePath, 'utf8');

    // Ensure all sensitive keys have obvious placeholder values
    assert(envExample.includes('JWT_SECRET=your_super_secret_jwt_key_here_change_in_production'), '.env.example uses obvious placeholder for JWT_SECRET');
    assert(envExample.includes('RAZORPAY_KEY_SECRET=your_razorpay_key_secret'), '.env.example uses obvious placeholder for RAZORPAY_KEY_SECRET');
    assert(envExample.includes('EMAIL_PASS=your_email_password'), '.env.example uses obvious placeholder for EMAIL_PASS');
    assert(envExample.includes('<password>'), '.env.example uses template bracket for MongoDB password');
  }

  // =========================================================================
  // SUITE 6: PRE-COMMIT HOOK INSTALLER VERIFICATION
  // =========================================================================
  console.log('\n--- Suite 6: Pre-Commit Hook Installer ---');
  {
    installHooks();
    const gitDir = path.resolve(__dirname, '..', '.git');
    const preCommitHook = path.join(gitDir, 'hooks', 'pre-commit');
    assert(fs.existsSync(preCommitHook), 'Pre-commit hook script installed in .git/hooks/pre-commit');

    const hookContent = fs.readFileSync(preCommitHook, 'utf8');
    assert(hookContent.includes('secretScanner.js --staged'), 'Pre-commit hook runs secret scanner on staged changes');
  }

  // =========================================================================
  // SUITE 7: FULL REPOSITORY SECRET SCAN PASS VERIFICATION
  // =========================================================================
  console.log('\n--- Suite 7: Full Repository Secret Scan Pass ---');
  {
    const scanResult = runSecretScan(path.resolve(__dirname, '..'));
    assert(scanResult.passed === true, 'Active repository tracked files pass automated secret scanner with 0 violations');
  }

  console.log('\n================================================================');
  console.log(`SECRET SCANNING RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal secret scanning test suite error:', err);
  process.exit(1);
});
