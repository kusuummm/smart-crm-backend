const express = require('express');
const router = express.Router();
const { createLead, getLeads, getLeadById, updateLeadStatus, deleteLead } = require('../controllers/leadController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/').post(createLead).get(getLeads);
router.route('/:id').get(getLeadById).delete(authorize('admin'), deleteLead);
router.put('/:id/status', updateLeadStatus);

module.exports = router;
