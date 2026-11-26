const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { getSettings, saveSettings } = require('../controllers/settingsController');

router.use(protect);
router.route('/').get(getSettings).post(authorize('admin', 'owner'), saveSettings);

module.exports = router;
