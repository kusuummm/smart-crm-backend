/**
 * Automated Secret Scanner Utility
 * Scans codebase, configuration files, and staged changes for exposed credentials:
 * - High-entropy API keys (AWS, OpenAI, Google/Gemini, Meta, GitHub, Slack)
 * - Database connection URIs with embedded passwords (MongoDB, PostgreSQL, MySQL)
 * - Private encryption keys (RSA, EC, PGP, SSH)
 * - Payment gateway secrets (Razorpay, Stripe)
 * - Hardcoded JWT and authentication secrets
 *
 * Designed for:
 * 1. Pre-commit hooks to block secret commits
 * 2. CI/CD automated pipeline scanning
 * 3. Repository security compliance audits
 *
 * NOTE: Never outputs raw secret values; all findings are masked with secure redaction.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SECRET_RULES = [
  {
    name: 'Google API / Gemini API Key',
    regex: /AIza[0-9A-Za-z\-_]{35}/g,
    severity: 'CRITICAL',
  },
  {
    name: 'AWS Access Key ID',
    regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
    severity: 'CRITICAL',
  },
  {
    name: 'AWS Secret Access Key Assignment',
    regex: /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[:=]\s*['"]?([A-Za-z0-9\/+=]{40})['"]?/gi,
    severity: 'CRITICAL',
  },
  {
    name: 'MongoDB Connection String with Password',
    regex: /mongodb(?:\+srv)?:\/\/[a-zA-Z0-9_\-\.]+:(?:[^@\s\/]+)@[a-zA-Z0-9_\-\.]+/gi,
    severity: 'CRITICAL',
  },
  {
    name: 'PostgreSQL / MySQL URI with Password',
    regex: /(?:postgres(?:ql)?|mysql):\/\/[a-zA-Z0-9_\-\.]+:(?:[^@\s\/]+)@[a-zA-Z0-9_\-\.]+/gi,
    severity: 'CRITICAL',
  },
  {
    name: 'Meta / WhatsApp Graph Access Token',
    regex: /EAA[a-zA-Z0-9]{50,}/g,
    severity: 'CRITICAL',
  },
  {
    name: 'OpenAI Secret API Key',
    regex: /sk-[a-zA-Z0-9\-_]{20,}/g,
    severity: 'CRITICAL',
  },
  {
    name: 'Razorpay Key Secret Assignment',
    regex: /(?:RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET)\s*[:=]\s*['"]?([a-zA-Z0-9]{20,})['"]?/gi,
    severity: 'CRITICAL',
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g,
    severity: 'CRITICAL',
  },
  {
    name: 'Slack API Token',
    regex: /xox[baprs]-[0-9]{12}-[0-9]{12}-[a-zA-Z0-9]{24}/g,
    severity: 'CRITICAL',
  },
  {
    name: 'Private Encryption Key Header',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    severity: 'CRITICAL',
  },
  {
    name: 'Hardcoded JWT Secret Assignment',
    regex: /(?:JWT_SECRET|jwt_secret)\s*[:=]\s*['"]([^'"\s\n]{16,})['"]/gi,
    severity: 'HIGH',
  },
];

const IGNORED_PATHS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.env.example',
  'package-lock.json',
  'secretScanner.js', // Exclude self
  'testFileUploadSecurity.js', // Contains defanged test vectors
  'testSecretScanning.js', // Contains test vectors for rule verification
  'testDatabaseRlsAndTenantIsolation.js', // Contains mock service account test assertions
];

const IGNORED_PLACEHOLDERS = [
  'your_',
  '<username>',
  '<password>',
  'change_in_production',
  'placeholder',
  'example',
  'test_secret',
  'undefined',
  'null',
];

function maskValue(val) {
  if (!val || val.length <= 6) return '******';
  return val.substring(0, 3) + '...' + val.substring(val.length - 3);
}

function isGitIgnored(filePath, rootDir) {
  try {
    const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
    execSync(`git check-ignore "${relative}"`, { cwd: rootDir, stdio: 'pipe' });
    return true; // Exit code 0 means ignored
  } catch (_) {
    return false; // Exit code 1 means not ignored
  }
}

function scanFile(filePath) {
  const issues = [];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return issues; // Binary or unreadable file
  }

  const lines = content.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    for (const rule of SECRET_RULES) {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(line)) !== null) {
        const rawToken = match[1] || match[0];

        // Check if placeholder
        const isPlaceholder = IGNORED_PLACEHOLDERS.some((p) =>
          rawToken.toLowerCase().includes(p)
        );
        if (isPlaceholder) continue;

        issues.push({
          file: filePath,
          line: lineNum + 1,
          rule: rule.name,
          severity: rule.severity,
          masked: maskValue(rawToken),
          length: rawToken.length,
        });
      }
    }
  }

  return issues;
}

function getTrackedFiles(rootDir) {
  try {
    const output = execSync('git ls-files', { cwd: rootDir, encoding: 'utf8' });
    return output.split('\n').map((f) => f.trim()).filter(Boolean);
  } catch (_) {
    return null;
  }
}

function getStagedFiles(rootDir) {
  try {
    const output = execSync('git diff --cached --name-only', { cwd: rootDir, encoding: 'utf8' });
    return output.split('\n').map((f) => f.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function runSecretScan(targetDir = process.cwd(), { scanAll = false, stagedOnly = false } = {}) {
  console.log('\n================================================================');
  console.log(`RUNNING AUTOMATED SECRET SCANNER: ${targetDir}`);
  console.log('================================================================\n');

  let filesToScan = [];
  const rootDir = path.resolve(targetDir);

  if (stagedOnly) {
    const staged = getStagedFiles(rootDir);
    console.log(`Scanning ${staged.length} staged file(s) for pre-commit verification...`);
    filesToScan = staged.map((f) => path.join(rootDir, f));
  } else if (!scanAll) {
    const tracked = getTrackedFiles(rootDir);
    if (tracked) {
      console.log(`Scanning ${tracked.length} git-tracked file(s)...`);
      filesToScan = tracked.map((f) => path.join(rootDir, f));
    }
  }

  // Fallback to directory scan if not a git repo or scanAll requested
  if (filesToScan.length === 0 && !stagedOnly) {
    console.log('Scanning directory tree (respecting .gitignore)...');
    function collectFiles(dir) {
      const list = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(rootDir, fullPath).replace(/\\/g, '/');

        if (IGNORED_PATHS.some((p) => relative === p || relative.startsWith(p + '/'))) {
          continue;
        }

        if (isGitIgnored(fullPath, rootDir)) {
          continue;
        }

        if (entry.isDirectory()) {
          list.push(...collectFiles(fullPath));
        } else if (entry.isFile()) {
          list.push(fullPath);
        }
      }
      return list;
    }
    filesToScan = collectFiles(rootDir);
  }

  let totalIssues = [];
  for (const filePath of filesToScan) {
    const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
    if (IGNORED_PATHS.some((p) => relative === p || relative.startsWith(p + '/'))) {
      continue;
    }
    if (fs.existsSync(filePath)) {
      totalIssues = totalIssues.concat(scanFile(filePath));
    }
  }

  if (totalIssues.length === 0) {
    console.log(`✓ PASS: Scanned ${filesToScan.length} file(s). No unmasked secrets or credentials detected.\n`);
    return { passed: true, issues: [] };
  }

  console.error(`✗ FAIL: Detected ${totalIssues.length} potential exposed secret(s):\n`);
  for (const issue of totalIssues) {
    console.error(`  [${issue.severity}] ${issue.rule}`);
    console.error(`    File:   ${issue.file}:${issue.line}`);
    console.error(`    Token:  ${issue.masked} (length: ${issue.length})\n`);
  }

  return { passed: false, issues: totalIssues };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const stagedOnly = args.includes('--staged');
  const scanAll = args.includes('--all');
  const result = runSecretScan(process.cwd(), { stagedOnly, scanAll });
  if (!result.passed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

module.exports = { runSecretScan, scanFile, SECRET_RULES };
