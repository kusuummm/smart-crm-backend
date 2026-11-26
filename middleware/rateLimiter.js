const rateLimit = require('express-rate-limit');

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.TEST_SUITE === 'true';

/**
 * Normalizes client IP address from request, removing IPv6 mapped IPv4 prefix.
 */
function getClientIp(req) {
  let ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip;
}

/**
 * Determines trusted proxy configuration based on environment:
 * - In production behind Render/Cloudflare/Nginx: trusts 1 hop by default (or custom TRUST_PROXY).
 * - Prevents client IP spoofing via attacker-forged X-Forwarded-For headers.
 */
function getTrustedProxyConfig() {
  const envVal = process.env.TRUST_PROXY;
  if (!envVal) {
    return 1; // Default to 1 hop (Render, Cloudflare, AWS ALB)
  }
  if (envVal.toLowerCase() === 'true') return true;
  if (envVal.toLowerCase() === 'false') return false;
  const num = parseInt(envVal, 10);
  if (!isNaN(num)) return num;
  return envVal.split(',').map((s) => s.trim());
}

/**
 * Distributed / compound rate limit key generator:
 * - If user is authenticated, rate limits by user ID to prevent botnet IP rotation evasion.
 * - Otherwise rate limits by validated client IP.
 */
function getRateLimitKey(req) {
  if (req.user && req.user._id) {
    return `user:${req.user._id}`;
  }
  return `ip:${getClientIp(req)}`;
}

/**
 * Standard 429 response formatter returning structured JSON.
 */
function createRateLimitHandler(customMessage, statusCode = 429) {
  return (req, res, next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(statusCode).json({
      success: false,
      message: customMessage || 'Too many requests. Please try again later.',
      retryAfter,
    });
  };
}

// ============================================================================
// RATE LIMITER TIERS
// ============================================================================

// 1. General API rate limiter for standard browsing & data retrieval
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTestEnv ? 10000 : 300, // 300 requests/min per IP in production
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler('Too many requests from this client. Please slow down.'),
});

// 2. Strict rate limiter for authentication & OTP endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestEnv ? 10000 : 25, // 25 attempts per 15 min
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    // If an email is provided in body, bind to email + IP to prevent targeted account lockouts
    const email = req.body && req.body.email ? String(req.body.email).toLowerCase().trim() : '';
    return email ? `auth:${getClientIp(req)}:${email}` : `auth:${getClientIp(req)}`;
  },
  handler: createRateLimitHandler(
    'Too many authentication attempts. Please wait 15 minutes before trying again.'
  ),
});

// 3. Password reset limiter (forgot-password OTP request & reset execution)
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestEnv ? 10000 : 5, // Strictly 5 requests per 15 min to prevent SMS/email bombing
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body && req.body.email ? String(req.body.email).toLowerCase().trim() : '';
    return email ? `reset:${getClientIp(req)}:${email}` : `reset:${getClientIp(req)}`;
  },
  handler: createRateLimitHandler(
    'Too many password reset requests. Please wait 15 minutes before requesting a new code.'
  ),
});

// 4. AI & Copilot rate limiter (protects LLM tokens, compute, and memory)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTestEnv ? 10000 : 30, // 30 requests per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(
    'AI query rate limit exceeded. Please wait a moment before sending another prompt.'
  ),
});

// 5. Heavy operations limiter: File Uploads, Document Exports, Excel Reports
const uploadExportLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTestEnv ? 10000 : 30, // 30 file/export requests per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(
    'File upload/export rate limit exceeded. Please wait a minute before submitting more files.'
  ),
});

// 6. High-capacity webhook limiter (Payment Gateways & Telephony Callbacks)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTestEnv ? 10000 : 1200, // 1,200 requests/min (20 req/sec) to handle legitimate webhook bursts without DoS
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `webhook:${getClientIp(req)}`,
  handler: createRateLimitHandler('Webhook ingestion threshold exceeded.', 429),
});

module.exports = {
  generalLimiter,
  authLimiter,
  passwordResetLimiter,
  aiLimiter,
  uploadExportLimiter,
  webhookLimiter,
  getClientIp,
  getTrustedProxyConfig,
  getRateLimitKey,
};
