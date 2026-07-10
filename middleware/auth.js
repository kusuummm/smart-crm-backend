const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Session = require('../models/Session');

// Verifies the JWT sent in the Authorization header and attaches the user to req.user
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      res.status(401);
      throw new Error('Not authorized, user no longer exists');
    }
    if (user.status !== 'active') {
      res.status(403);
      throw new Error('Account is disabled. Contact your administrator.');
    }

    // Confirm this specific session hasn't been logged out / revoked from
    // another device. Without this check, "revoke session" would only be
    // cosmetic - the old token would keep working until it expired.
    if (decoded.sid) {
      const session = await Session.findOneAndUpdate(
        { tokenId: decoded.sid },
        { lastSeenAt: new Date() }
      );
      if (!session) {
        res.status(401);
        throw new Error('Session expired or was signed out from another device. Please log in again.');
      }
      req.sessionId = decoded.sid;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401);
    throw new Error(error.message || 'Not authorized, token invalid or expired');
  }
});

// Restricts a route to specific roles, e.g. authorize('admin')
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403);
      throw new Error(`Role '${req.user?.role}' is not allowed to access this resource`);
    }
    next();
  };
};

module.exports = { protect, authorize };
