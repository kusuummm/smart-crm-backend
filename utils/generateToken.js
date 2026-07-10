const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Generates a signed JWT containing the user's id, role, and a unique
// session id (sid). The sid is what lets us list/revoke individual
// device sessions later - see models/Session.js and middleware/auth.js.
const generateToken = (userId, role, sid = crypto.randomUUID()) => {
  const token = jwt.sign({ id: userId, role, sid }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  return { token, sid };
};

module.exports = generateToken;
