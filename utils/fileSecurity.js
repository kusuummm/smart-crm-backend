/**
 * File Security Utility
 * Defends against:
 * - Extension spoofing (validates file signatures / magic bytes)
 * - Malware / webshell payloads (scans buffer for suspicious scripts & commands)
 * - Path traversal (sanitizes filenames and enforces canonical directory containment)
 * - Unrestricted file size & prohibited executable formats
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Permitted extensions and their canonical MIME types
const ALLOWED_FILE_TYPES = {
  '.pdf': {
    mime: 'application/pdf',
    description: 'Adobe Portable Document Format',
    signatures: [
      { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2D] }, // %PDF-
    ],
  },
  '.jpg': {
    mime: 'image/jpeg',
    description: 'JPEG Image',
    signatures: [
      { offset: 0, bytes: [0xFF, 0xD8, 0xFF] }, // JPEG SOI marker
    ],
  },
  '.jpeg': {
    mime: 'image/jpeg',
    description: 'JPEG Image',
    signatures: [
      { offset: 0, bytes: [0xFF, 0xD8, 0xFF] }, // JPEG SOI marker
    ],
  },
  '.png': {
    mime: 'image/png',
    description: 'PNG Image',
    signatures: [
      { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }, // \x89PNG\r\n\x1a\n
    ],
  },
  '.webp': {
    mime: 'image/webp',
    description: 'WebP Image',
    signatures: [
      {
        offset: 0,
        bytes: [0x52, 0x49, 0x46, 0x46], // 'RIFF'
        subCheck: (buf) => buf.length >= 12 && buf.subarray(8, 12).toString('ascii') === 'WEBP',
      },
    ],
  },
  '.docx': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    description: 'Microsoft Word OpenXML Document',
    signatures: [
      { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK\x03\x04 (ZIP container)
    ],
  },
  '.doc': {
    mime: 'application/msword',
    description: 'Microsoft Word Document (Legacy)',
    signatures: [
      { offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }, // OLE compound document
    ],
  },
};

// Prohibited dangerous extensions that should never be permitted
const PROHIBITED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.bin', '.elf', '.msi', '.com', '.scr',
  '.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps',
  '.js', '.mjs', '.cjs', '.ts', '.vbs', '.vbe', '.wsf', '.wsh', '.ps1', '.psm1',
  '.html', '.htm', '.xhtml', '.shtml', '.svg', '.xml',
  '.jar', '.war', '.jsp', '.jspx', '.asp', '.aspx', '.cer', '.csr',
  '.py', '.pyc', '.rb', '.pl', '.cgi',
]);

// Known binary executable signatures to immediately reject
const DANGEROUS_MAGIC_NUMBERS = [
  { name: 'Windows PE Executable / DLL', offset: 0, bytes: [0x4D, 0x5A] }, // MZ
  { name: 'Linux ELF Executable', offset: 0, bytes: [0x7F, 0x45, 0x4C, 0x46] }, // \x7FELF
  { name: 'Mach-O / Java Class', offset: 0, bytes: [0xCA, 0xFE, 0xBA, 0xBE] },
  { name: 'Shell Script Shebang', offset: 0, bytes: [0x23, 0x21] }, // #!
];

/**
 * Validates whether the buffer matches the expected file signature for the given extension
 */
function validateFileSignature(buffer, extension) {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, reason: 'File buffer is empty (0 bytes)' };
  }

  // 1. Check against dangerous executable magic numbers
  for (const dangerous of DANGEROUS_MAGIC_NUMBERS) {
    if (buffer.length >= dangerous.offset + dangerous.bytes.length) {
      let matches = true;
      for (let i = 0; i < dangerous.bytes.length; i++) {
        if (buffer[dangerous.offset + i] !== dangerous.bytes[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return {
          isValid: false,
          reason: `Detected prohibited executable signature: ${dangerous.name}`,
        };
      }
    }
  }

  // 2. Validate against expected signature for this extension
  const ext = (extension || '').toLowerCase().trim();
  const config = ALLOWED_FILE_TYPES[ext];
  if (!config) {
    return { isValid: false, reason: `Extension '${ext}' is not permitted in allowed whitelist` };
  }

  let signatureMatched = false;
  for (const sig of config.signatures) {
    if (buffer.length >= sig.offset + sig.bytes.length) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[sig.offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        if (sig.subCheck) {
          if (sig.subCheck(buffer)) {
            signatureMatched = true;
            break;
          }
        } else {
          signatureMatched = true;
          break;
        }
      }
    }
  }

  if (!signatureMatched) {
    return {
      isValid: false,
      reason: `File signature mismatch for '${ext}'. Header bytes do not match expected format.`,
    };
  }

  return { isValid: true, mime: config.mime };
}

/**
 * Scans buffer for webshells, embedded scripts, and malicious commands
 */
function scanBufferForMalware(buffer, extension) {
  if (!buffer || buffer.length === 0) {
    return { isSafe: false, reason: 'Empty file' };
  }

  // Only scan first 64KB for performance and efficiency
  const sampleLength = Math.min(buffer.length, 64 * 1024);
  const sampleString = buffer.subarray(0, sampleLength).toString('binary');
  const lowerSample = sampleString.toLowerCase();

  // 1. Embedded PHP tags
  if (lowerSample.includes('<?php') || lowerSample.includes('<?=')) {
    return { isSafe: false, reason: 'Embedded PHP tag detected' };
  }

  // 2. ASP / JSP tags
  if (lowerSample.includes('<%') && lowerSample.includes('%>')) {
    return { isSafe: false, reason: 'Embedded ASP/JSP server code detected' };
  }

  // 3. HTML script execution in non-HTML document
  if (lowerSample.includes('<script') || lowerSample.includes('javascript:')) {
    return { isSafe: false, reason: 'Embedded script tag or javascript URI detected' };
  }

  // 4. Common webshell command execution strings
  const dangerousTokens = [
    'eval(base64_decode',
    'passthru(',
    'shell_exec(',
    'system($_get',
    'system($_post',
    'cmd.exe /c',
    'powershell -enc',
  ];

  for (const token of dangerousTokens) {
    if (lowerSample.includes(token)) {
      return { isSafe: false, reason: `Suspicious execution pattern detected: ${token}` };
    }
  }

  return { isSafe: true };
}

/**
 * Validates and sanitizes original filename to prevent path traversal & double extension tricks
 */
function sanitizeFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') {
    return { isSafe: false, reason: 'Filename must be a non-empty string' };
  }

  // 1. Check for directory traversal sequences
  if (
    originalName.includes('..') ||
    originalName.includes('/') ||
    originalName.includes('\\') ||
    originalName.includes('\0') ||
    /%2e%2e|%2f|%5c/i.test(originalName)
  ) {
    return { isSafe: false, reason: 'Path traversal characters detected in filename' };
  }

  // 2. Strip dangerous control characters
  const cleanedName = originalName.replace(/[\x00-\x1F\x7F<>:"/\\|?*]/g, '_').trim();
  if (!cleanedName) {
    return { isSafe: false, reason: 'Filename became empty after stripping invalid characters' };
  }

  // 3. Extract and check extension
  const ext = path.extname(cleanedName).toLowerCase();
  if (!ext || !ALLOWED_FILE_TYPES[ext]) {
    return {
      isSafe: false,
      reason: `Disallowed or missing file extension: '${ext}'. Allowed: ${Object.keys(ALLOWED_FILE_TYPES).join(', ')}`,
    };
  }

  // 4. Check for double/hidden extensions (e.g., "document.php.pdf", "avatar.exe.jpg")
  const baseName = path.basename(cleanedName, ext);
  const parts = baseName.split('.');
  for (const part of parts.slice(1)) {
    const intermediateExt = `.${part.toLowerCase()}`;
    if (PROHIBITED_EXTENSIONS.has(intermediateExt)) {
      return {
        isSafe: false,
        reason: `Dangerous multi-extension detected: prohibited extension '${intermediateExt}' in filename`,
      };
    }
  }

  // 5. Generate a cryptographically random, non-executable storage filename
  const randomHex = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const safeStorageFilename = `${timestamp}-${randomHex}${ext}`;

  return {
    isSafe: true,
    safeStorageFilename,
    sanitizedOriginalName: cleanedName,
    extension: ext,
  };
}

/**
 * Validates that a requested file path is contained strictly within the base directory (guards against IDOR & traversal)
 */
function resolveSafeFilePath(baseDirectory, filename) {
  if (!filename || typeof filename !== 'string') {
    return null;
  }

  // Disallow any traversal or separator characters in filename
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    return null;
  }

  const baseResolved = path.resolve(baseDirectory);
  const fileResolved = path.resolve(baseDirectory, filename);

  // Strict boundary containment
  if (!fileResolved.startsWith(baseResolved)) {
    return null;
  }

  return fileResolved;
}

module.exports = {
  ALLOWED_FILE_TYPES,
  PROHIBITED_EXTENSIONS,
  validateFileSignature,
  scanBufferForMalware,
  sanitizeFilename,
  resolveSafeFilePath,
};
