const express = require('express');
const router = express.Router();
const {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  resetPassword,
  toggleUserStatus,
  deleteUser,
  reassignWorkload,
  getSystemOverview,
  getAuditLogs,
  approveUser,
  rejectUser,
  heartbeat,
  getCallersProgressReport,
  getCallersProgressDetail,
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');

// Telecallers and Admins can both ping heartbeat to stay online
router.post('/heartbeat', protect, heartbeat);

// Any authenticated user can view users/leads directory (e.g. for reassigning leads or transferring customers)
router.get('/', protect, getUsers);

// All management routes require admin privileges
router.use(protect, authorize('admin'));

// Specific named routes must come before parameterized /:id routes
router.post('/reassign-workload', reassignWorkload);
router.get('/system-overview', getSystemOverview);
router.get('/audit-logs', getAuditLogs);
router.get('/callers-progress-report', getCallersProgressReport);
router.get('/callers-progress-detail', getCallersProgressDetail);

router.post('/', createUser);
router.put('/:id/approve', approveUser);
router.put('/:id/reject', rejectUser);
router.route('/:id').get(getUserById).put(updateUser).delete(deleteUser);
router.put('/:id/reset-password', resetPassword);
router.put('/:id/status', toggleUserStatus);

module.exports = router;
