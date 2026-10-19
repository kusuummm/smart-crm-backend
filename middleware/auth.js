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
    if (user.status !== 'active' || user.isApproved === false) {
      res.status(403);
      throw new Error('Account is pending administrator approval or disabled. Contact your administrator.');
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

    // Keep user's real-time presence updated
    if (!user.isOnline || !user.lastActive || Date.now() - new Date(user.lastActive).getTime() > 60000) {
      User.updateOne({ _id: user._id }, { $set: { isOnline: true, lastActive: new Date() } }).catch(() => {});
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401);
    throw new Error(error.message || 'Not authorized, token invalid or expired');
  }
});

// Role hierarchy definitions
const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
  telecaller: 1,
  user: 1,
};

// Restricts a route to specific roles or higher in hierarchy, e.g. authorize('admin')
const authorize = (...roles) => {
  const normalizedAllowed = roles.map((r) => (r || '').toLowerCase());
  const minRequiredLevel = Math.min(...normalizedAllowed.map((r) => ROLE_HIERARCHY[r] || 1));

  return (req, res, next) => {
    if (!req.user) {
      res.status(401);
      throw new Error('Not authorized, no user found');
    }

    const userRole = (req.user.role || '').toLowerCase();
    const userLevel = ROLE_HIERARCHY[userRole] || 1;

    // Check exact match or hierarchy level
    const isDirectMatch = normalizedAllowed.includes(userRole);
    const hasHierarchyAccess = userLevel >= minRequiredLevel;

    if (!isDirectMatch && !hasHierarchyAccess) {
      res.status(403);
      throw new Error(`Role '${req.user?.role}' is not allowed to access this resource`);
    }
    next();
  };
};

module.exports = { protect, authorize, ROLE_HIERARCHY };

