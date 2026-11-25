const asyncHandler = require('express-async-handler');
const SystemConfig = require('../models/SystemConfig');

// @desc    Get workspace settings
// @route   GET /api/settings
// @access  Private
const getSettings = asyncHandler(async (req, res) => {
  let doc = await SystemConfig.findOne({ key: 'workspace_settings' });
  const defaultSettings = {
    notifications: {
      soundEnabled: true,
      soundTheme: 'subtle_crystal',
      volume: 80,
      browserPush: true,
      emailDigest: true,
      smsAlerts: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    },
    callRecording: {
      enabled: true,
      consentBeep: true,
      noiseSuppression: true,
      waveformVisuals: true,
    },
    memberSettings: {
      autoAssign: true,
      maxDailyCalls: 100,
    },
    adminSettings: {
      mandatoryRecording: true,
      strictAuditLog: true,
    },
  };
  res.json({ success: true, settings: doc?.value || defaultSettings });
});

// @desc    Save workspace settings
// @route   POST /api/settings
// @access  Private
const saveSettings = asyncHandler(async (req, res) => {
  const doc = await SystemConfig.findOneAndUpdate(
    { key: 'workspace_settings' },
    { value: req.body },
    { upsert: true, new: true }
  );
  res.json({ success: true, settings: doc.value, message: 'Settings saved to database' });
});

module.exports = {
  getSettings,
  saveSettings,
};
