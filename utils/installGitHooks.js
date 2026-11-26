/**
 * Git Pre-Commit Hook Installer
 * Automatically configures a pre-commit hook that runs the secret scanner
 * before any commit is finalized, blocking accidental credential exposure.
 */

const fs = require('fs');
const path = require('path');

function installHooks() {
  const gitDir = path.resolve(__dirname, '..', '.git');
  if (!fs.existsSync(gitDir)) {
    console.log('Not a git repository or .git directory not found. Skipping hook installation.');
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const preCommitScript = `#!/bin/sh
# Automated Pre-Commit Secret Scanner
# Runs secret scanner against staged changes before committing.

echo "Running pre-commit secret scanner..."
node utils/secretScanner.js --staged

if [ $? -ne 0 ]; then
  echo ""
  echo "=================================================================="
  echo "COMMIT BLOCKED: Exposed secret or credential detected in staged files."
  echo "Remove or sanitize the secret before committing."
  echo "=================================================================="
  exit 1
fi

exit 0
`;

  const preCommitPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(preCommitPath, preCommitScript, { mode: 0o755 });
  console.log(`✓ Pre-commit secret scanning hook installed successfully at: ${preCommitPath}`);
}

if (require.main === module) {
  installHooks();
}

module.exports = { installHooks };
