const express = require('express');
const router = express.Router();
const {
  getAutomations,
  getAutomationLogs,
  updateAutomation,
  testTriggerAutomation,
} = require('../controllers/automationController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/').get(getAutomations);
router.route('/logs').get(getAutomationLogs);
router.route('/:id').put(updateAutomation);
router.route('/test-trigger').post(testTriggerAutomation);

module.exports = router;
