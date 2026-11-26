const express = require('express');
const router = express.Router();
const {
  getAutomations,
  getAutomationLogs,
  updateAutomation,
  testTriggerAutomation,
} = require('../controllers/automationController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/').get(authorize('manager'), getAutomations);
router.route('/logs').get(authorize('manager'), getAutomationLogs);
router.route('/:id').put(authorize('admin'), updateAutomation);
router.route('/test-trigger').post(authorize('admin'), testTriggerAutomation);

module.exports = router;
