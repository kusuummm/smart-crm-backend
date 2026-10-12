const express = require('express');
const router = express.Router();
const { createLead, getLeads, getLeadById, updateLeadStatus, deleteLead, bulkImportLeads } = require('../controllers/leadController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.post('/bulk-import', authorize('admin'), bulkImportLeads);
router.route('/').post(authorize('admin'), createLead).get(getLeads);
router.route('/:id').get(getLeadById).delete(authorize('admin'), deleteLead);
router.put('/:id/status', updateLeadStatus);

module.exports = router;
