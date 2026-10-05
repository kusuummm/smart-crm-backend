const express = require('express');
const router = express.Router();
const {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  bulkAssignCustomers,
  bulkDeleteCustomers,
} = require('../controllers/customerController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Bulk operations (Admin only) - MUST come before /:id parameter route
router.post('/bulk-assign', authorize('admin'), bulkAssignCustomers);
router.post('/bulk-delete', authorize('admin'), bulkDeleteCustomers);

router.route('/').post(createCustomer).get(getCustomers);
router.route('/:id').get(getCustomerById).put(updateCustomer).delete(authorize('admin'), deleteCustomer);

module.exports = router;
