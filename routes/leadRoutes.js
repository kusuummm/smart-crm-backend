const express = require('express');
const router = express.Router();
const { createLead, getLeads, getLeadById, updateLeadStatus, deleteLead } = require('../controllers/leadController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/').post(createLead).get(getLeads);
router.route('/:id').get(getLeadById).delete(deleteLead);
router.put('/:id/status', updateLeadStatus);

module.exports = router;
