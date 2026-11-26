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
  getCustomerCommunicationHistory,
} = require('../controllers/customerController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Bulk operations - MUST come before /:id parameter route
router.post('/bulk-assign', authorize('manager'), bulkAssignCustomers);
router.post('/bulk-delete', authorize('admin'), bulkDeleteCustomers);

// Unified customer communication history (calls, whatsapp, emails, notes, applications)
router.get('/:id/communication-history', getCustomerCommunicationHistory);
router.get('/:id/timeline', getCustomerCommunicationHistory);

router.route('/').post(createCustomer).get(getCustomers);
router.route('/:id').get(getCustomerById).put(updateCustomer).delete(authorize('admin'), deleteCustomer);

module.exports = router;
