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

// Bulk operations - MUST come before /:id parameter route
router.post('/bulk-assign', authorize('admin'), bulkAssignCustomers);
router.post('/bulk-delete', bulkDeleteCustomers);

router.route('/').post(createCustomer).get(getCustomers);
router.route('/:id').get(getCustomerById).put(updateCustomer).delete(deleteCustomer);

module.exports = router;
