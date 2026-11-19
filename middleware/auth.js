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

    // Role check: Only admin and member can access the CRM
    let normalizedRole = (user.role || '').toLowerCase().trim();
    if (normalizedRole === 'telecaller') normalizedRole = 'member';
    const isAllowedRole = ['admin', 'owner', 'member'].includes(normalizedRole);
    if (!isAllowedRole) {
      res.status(403);
      throw new Error('Access denied. Only admin and member accounts are authorized to access the CRM.');
    }

    const isAdmin = ['admin', 'owner'].includes(normalizedRole);
    if (user.status !== 'active' || (!isAdmin && user.isApproved === false)) {
      res.status(403);
      throw new Error('Account is pending administrator approval or disabled. Contact your administrator.');
    }

    // Confirm this specific session hasn't been logged out / revoked from
    // another device (Single-device policy for Admin enforcement).
    if (decoded.sid) {
      const session = await Session.findOneAndUpdate(
        { tokenId: decoded.sid },
        { lastSeenAt: new Date() }
      );
      if (!session) {
        res.status(401);
        const reason = isAdmin
          ? 'Your admin session was signed out because this admin account was logged into from another device. Admin accounts are restricted to one active device only.'
          : 'Session expired or was signed out from another device. Please log in again.';
        throw new Error(reason);
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
    if (!res.statusCode || res.statusCode === 200) {
      res.status(401);
    }
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

    let userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'telecaller') userRole = 'member';
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
