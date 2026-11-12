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

// Telecallers, Managers, and Admins can all ping heartbeat to stay online
router.post('/heartbeat', protect, heartbeat);

// Any authenticated user can view users/leads directory (e.g. for reassigning leads or transferring customers)
router.get('/', protect, getUsers);

// Management & Reporting routes accessible to Managers, Admins, and Owners
router.get('/callers-progress-report', protect, authorize('manager'), getCallersProgressReport);
router.get('/callers-progress-detail', protect, authorize('manager'), getCallersProgressDetail);
router.post('/reassign-workload', protect, authorize('manager'), reassignWorkload);
router.get('/audit-logs', protect, authorize('manager'), getAuditLogs);
router.get('/system-overview', protect, authorize('manager'), getSystemOverview);

// All user administration modification routes strictly require admin/owner privileges
router.use(protect, authorize('admin'));

router.post('/', createUser);
router.put('/:id/approve', approveUser);
router.put('/:id/reject', rejectUser);
router.route('/:id').get(getUserById).put(updateUser).delete(deleteUser);
router.put('/:id/reset-password', resetPassword);
router.put('/:id/status', toggleUserStatus);

module.exports = router;
