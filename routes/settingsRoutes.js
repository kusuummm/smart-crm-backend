const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getSettings, saveSettings } = require('../controllers/settingsController');

router.use(protect);
router.route('/').get(getSettings).post(saveSettings);

module.exports = router;
