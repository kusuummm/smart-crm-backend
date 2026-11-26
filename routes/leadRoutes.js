const express = require('express');
const router = express.Router();
const {
  createLead,
  getLeads,
  getLeadById,
  updateLeadStatus,
  deleteLead,
  bulkImportLeads,
} = require('../controllers/leadController');
const {
  getLeadEmails,
  sendCustomerEmail,
  receiveInboundEmail,
} = require('../controllers/emailController');
const { protect, authorize } = require('../middleware/auth');
const { uploadExportLimiter } = require('../middleware/rateLimiter');

router.use(protect);

router.post('/bulk-import', authorize('manager'), uploadExportLimiter, bulkImportLeads);
router.route('/').post(authorize('admin', 'telecaller', 'member', 'manager'), createLead).get(getLeads);
router.route('/:id').get(getLeadById).delete(authorize('admin'), deleteLead);
router.put('/:id/status', updateLeadStatus);

// Email communication routes for leads
router.get('/:id/emails', getLeadEmails);
router.post('/:id/send-email', (req, res, next) => {
  req.body.leadId = req.params.id;
  next();
}, sendCustomerEmail);
router.post('/:id/receive-email', (req, res, next) => {
  req.body.leadId = req.params.id;
  next();
}, receiveInboundEmail);

module.exports = router;
