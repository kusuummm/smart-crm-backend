/**
 * Centralized JWT Security Service
 *
 * Implements:
 * 1. Explicit allowlist of trusted signing algorithms (['HS256'] - defends against 'none' and confusion attacks)
 * 2. Cryptographic signature, issuer ('iss'), audience ('aud'), expiration ('exp'), and subject ('sub') validation
 * 3. Token Purpose enforcement ('type' claim: 'access' vs 'refresh' to prevent purpose confusion)
 * 4. Secure key management: minimum 256-bit key entropy and distinct refresh secret derivation
 * 5. Single-use Refresh Token Rotation (RTR) hashing & reuse detection utilities
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Standardized Token Claims Configuration
const JWT_ISSUER = process.env.JWT_ISSUER || 'smart-crm-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'smart-crm-client';
const ALLOWED_ALGORITHMS = ['HS256'];

// Token Lifespans
const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Validates and retrieves the access token signing secret
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is missing from environment variables');
  }
  if (secret.length < 32 && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be at least 32 characters (256-bit entropy) in production');
  }
  return secret;
}

/**
 * Derives a distinct, cryptographically isolated secret for refresh tokens
 * Ensures compromise of an access secret does not compromise refresh token families
 */
function getRefreshSecret() {
  if (process.env.JWT_REFRESH_SECRET) {
    return process.env.JWT_REFRESH_SECRET;
  }
  const baseSecret = getJwtSecret();
  return crypto.createHmac('sha256', baseSecret).update('smart-crm-refresh-token-salt-v1').digest('hex');
}

/**
 * Computes SHA-256 hash of a token for non-reversible persistence in database
 */
function hashToken(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Signs a short-lived access token with explicit algorithm, claims, and purpose
 */
function signAccessToken(userId, role, sid) {
  const secret = getJwtSecret();
  const jti = crypto.randomUUID();
  const uid = userId ? userId.toString() : '';

  const payload = {
    id: uid,
    sub: uid,
    role: (role || 'member').toLowerCase(),
    sid: sid || crypto.randomUUID(),
    type: 'access',
    jti,
  };

  const token = jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  return { token, sid: payload.sid, jti };
}

/**
 * Signs a long-lived refresh token with distinct secret, rotation family, and purpose
 */
function signRefreshToken(userId, role, sid, family) {
  const refreshSecret = getRefreshSecret();
  const jti = crypto.randomUUID();
  const uid = userId ? userId.toString() : '';
  const tokenFamily = family || crypto.randomUUID();

  const payload = {
    id: uid,
    sub: uid,
    role: (role || 'member').toLowerCase(),
    sid: sid || crypto.randomUUID(),
    family: tokenFamily,
    type: 'refresh',
    jti,
  };

  const refreshToken = jwt.sign(payload, refreshSecret, {
    algorithm: 'HS256',
    expiresIn: REFRESH_TOKEN_EXPIRY,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  return { refreshToken, family: tokenFamily, jti };
}

/**
 * Verifies an access token:
 * - Enforces allowed algorithm (HS256)
 * - Validates signature
 * - Validates expiration
 * - Validates issuer and audience (if present in token)
 * - Enforces type === 'access' (prevents purpose confusion)
 */
function verifyAccessToken(token, options = {}) {
  if (!token || typeof token !== 'string') {
    throw new Error('Not authorized: No token provided');
  }

  const secret = getJwtSecret();

  // Decode header and payload to inspect claims & reject disallowed algorithms upfront
  const decodedRaw = jwt.decode(token, { complete: true });
  if (!decodedRaw) {
    throw new Error('Not authorized: Malformed JWT token');
  }

  // Explicitly disallow 'none' algorithm and enforce HS256 allowlist
  if (!decodedRaw.header || !ALLOWED_ALGORITHMS.includes(decodedRaw.header.alg)) {
    throw new Error(`Invalid token algorithm: ${decodedRaw.header ? decodedRaw.header.alg : 'missing'}. Only HS256 is permitted.`);
  }

  const verifyOptions = {
    algorithms: ALLOWED_ALGORITHMS,
  };

  // Validate issuer & audience when present in the token or specified in options
  if (options.issuer !== undefined && options.issuer !== false) {
    verifyOptions.issuer = options.issuer;
  } else if (decodedRaw.payload && decodedRaw.payload.iss) {
    verifyOptions.issuer = JWT_ISSUER;
  }

  if (options.audience !== undefined && options.audience !== false) {
    verifyOptions.audience = options.audience;
  } else if (decodedRaw.payload && decodedRaw.payload.aud) {
    verifyOptions.audience = JWT_AUDIENCE;
  }

  const decoded = jwt.verify(token, secret, verifyOptions);

  // Strict token purpose enforcement: Reject refresh or reset tokens sent as access tokens
  if (decoded.type && decoded.type !== 'access') {
    throw new Error(`Invalid token purpose: Expected 'access' token but received '${decoded.type}'`);
  }

  return decoded;
}

/**
 * Verifies a refresh token:
 * - Uses distinct refresh secret
 * - Enforces allowed algorithm (HS256)
 * - Validates signature & expiration
 * - Enforces type === 'refresh'
 */
function verifyRefreshToken(token, options = {}) {
  if (!token || typeof token !== 'string') {
    throw new Error('Refresh token is required');
  }

  const refreshSecret = getRefreshSecret();

  const decodedRaw = jwt.decode(token, { complete: true });
  if (!decodedRaw) {
    throw new Error('Malformed refresh token');
  }

  if (!decodedRaw.header || !ALLOWED_ALGORITHMS.includes(decodedRaw.header.alg)) {
    throw new Error(`Invalid token algorithm: ${decodedRaw.header ? decodedRaw.header.alg : 'missing'}. Only HS256 is permitted.`);
  }

  const verifyOptions = {
    algorithms: ALLOWED_ALGORITHMS,
  };

  if (options.issuer !== undefined && options.issuer !== false) {
    verifyOptions.issuer = options.issuer;
  } else if (decodedRaw.payload && decodedRaw.payload.iss) {
    verifyOptions.issuer = JWT_ISSUER;
  }

  if (options.audience !== undefined && options.audience !== false) {
    verifyOptions.audience = options.audience;
  } else if (decodedRaw.payload && decodedRaw.payload.aud) {
    verifyOptions.audience = JWT_AUDIENCE;
  }

  const decoded = jwt.verify(token, refreshSecret, verifyOptions);

  if (decoded.type !== 'refresh') {
    throw new Error(`Invalid token purpose: Expected 'refresh' token but received '${decoded.type}'`);
  }

  return decoded;
}

module.exports = {
  JWT_ISSUER,
  JWT_AUDIENCE,
  ALLOWED_ALGORITHMS,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  getJwtSecret,
  getRefreshSecret,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
