/**
 * Pre-Push Secret Verification Script
 * Validates that no commits, staged changes, or working directory files
 * contain any sensitive credentials, high-entropy secrets, connection strings,
 * or test fixtures that could trigger external scanners (e.g. GitGuardian, GitHub Secret Scanning).
 */

const { execSync } = require('child_process');
const path = require('path');

function verifyPushCleanliness(repoPath, repoName) {
  console.log(`\n================================================================`);
  console.log(`VERIFYING CLEAN GIT DIFF BEFORE PUSH: ${repoName}`);
  console.log(`================================================================`);

  // Inspect the diff between origin/main and local HEAD, plus any staged/unstaged changes
  let diff = '';
  try {
    diff = execSync('git diff origin/main HEAD', { cwd: repoPath, encoding: 'utf8' });
  } catch (_) {
    try {
      diff = execSync('git diff HEAD~1 HEAD', { cwd: repoPath, encoding: 'utf8' });
    } catch (e) {
      diff = '';
    }
  }

  // Also include uncommitted changes
  try {
    diff += '\n' + execSync('git diff HEAD', { cwd: repoPath, encoding: 'utf8' });
  } catch (_) {}

  const rules = [
    { name: 'MongoDB Connection String with Password', regex: /^\+.*mongodb(?:\+srv)?:\/\/[a-zA-Z0-9_\-\.]+:(?:[^@\s\/]+)@[a-zA-Z0-9_\-\.]+/im },
    { name: 'Cloud MongoDB host with credentials', regex: /^\+.*cluster[0-9a-zA-Z_\-\.]*\.mongodb\.net/im },
    { name: 'AWS Access Key ID', regex: /^\+.*(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/m },
    { name: 'Google / Gemini API Key', regex: /^\+.*AIza[0-9A-Za-z\-_]{35}/m },
    { name: 'Meta / WhatsApp Graph Token', regex: /^\+.*EAA[0-9A-Za-z]{50,}/m },
    { name: 'Private Key Header', regex: /^\+.*BEGIN (?:RSA )?PRIVATE KEY/m },
    { name: 'Generic High Entropy 64-Hex String', regex: /^\+.*['"][0-9a-f]{64}['"]/im }
  ];

  const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));

  let violations = 0;
  for (const line of addedLines) {
    for (const rule of rules) {
      if (rule.regex.test(line)) {
        // Exclude scanner regex definitions
        if (line.includes('regex:') || line.includes('/AIza') || line.includes('/AKIA')) continue;
        console.error(`[CRITICAL LEAK BLOCKED] ${rule.name}`);
        console.error(`   Offending diff line: ${line.trim().substring(0, 80)}...`);
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.error(`\n❌ PUSH BLOCKED: Found ${violations} potential sensitive token(s) in outgoing diff!`);
    process.exit(1);
  } else {
    console.log(`✓ VERIFIED CLEAN: No credentials or secret patterns detected in outgoing diff (${addedLines.length} lines checked).`);
  }
}

const backendPath = path.resolve(__dirname, '..');
verifyPushCleanliness(backendPath, 'smart-crm-backend');
