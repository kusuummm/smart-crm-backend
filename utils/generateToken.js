const crypto = require('crypto');
const {
  signAccessToken,
  signRefreshToken,
  hashToken,
} = require('./jwtSecurity');

/**
 * Generates both an access token and a refresh token for authenticated sessions.
 * Access token: Short-lived (15m), carries user id, role, sid, type: 'access'.
 * Refresh token: Long-lived (7d), carries user id, role, sid, family, type: 'refresh'.
 * Returns both tokens, sid, family, and token hash for Session persistence.
 */
const generateToken = (userId, role, sid = crypto.randomUUID(), family = null) => {
  const sessionFamily = family || crypto.randomUUID();
  const { token, jti: accessJti } = signAccessToken(userId, role, sid);
  const { refreshToken, jti: refreshJti } = signRefreshToken(userId, role, sid, sessionFamily);

  return {
    token,
    accessToken: token,
    refreshToken,
    sid,
    family: sessionFamily,
    accessJti,
    refreshJti,
    refreshTokenHash: hashToken(refreshToken),
  };
};

module.exports = generateToken;
