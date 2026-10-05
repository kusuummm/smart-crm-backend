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
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

// Specific named routes must come before parameterized /:id routes
router.post('/reassign-workload', reassignWorkload);
router.get('/system-overview', getSystemOverview);
router.get('/audit-logs', getAuditLogs);

router.route('/').post(createUser).get(getUsers);
router.route('/:id').get(getUserById).put(updateUser).delete(deleteUser);
router.put('/:id/reset-password', resetPassword);
router.put('/:id/status', toggleUserStatus);

module.exports = router;
