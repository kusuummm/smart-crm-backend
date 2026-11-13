const asyncHandler = require('express-async-handler');
const Automation = require('../models/Automation');
const AutomationLog = require('../models/AutomationLog');
const { handleMissedCall, seedDefaultAutomations } = require('../services/automationService');

// @desc    Get all automations and aggregated execution stats
// @route   GET /api/automations
// @access  Private
const getAutomations = asyncHandler(async (req, res) => {
  // Ensure default automations exist
  await seedDefaultAutomations();

  const automations = await Automation.find().sort({ createdAt: -1 });

  const totalAutomations = automations.length;
  const activeCount = automations.filter((a) => a.status === 'Active').length;
  const totalSuccess = automations.reduce((sum, a) => sum + (a.successCount || 0), 0);
  const totalFailed = automations.reduce((sum, a) => sum + (a.failedCount || 0), 0);
  const totalRuns = totalSuccess + totalFailed;
  const successRate = totalRuns > 0 ? ((totalSuccess / totalRuns) * 100).toFixed(1) + '%' : '100%';

  res.json({
    success: true,
    automations,
    stats: {
      totalAutomations,
      activeCount,
      totalSuccess,
      totalFailed,
      successRate,
    },
  });
});

// @desc    Get automation execution logs
// @route   GET /api/automations/logs
// @access  Private
const getAutomationLogs = asyncHandler(async (req, res) => {
  const { status, automationKey, page = 1, limit = 15 } = req.query;
  const filter = {};

  if (status && status !== 'all') {
    filter.status = status;
  }
  if (automationKey && automationKey !== 'all') {
    filter.automationKey = automationKey;
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 15, 1);

  const [logs, total] = await Promise.all([
    AutomationLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    AutomationLog.countDocuments(filter),
  ]);

  res.json({
    success: true,
    logs,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum) || 1,
    },
  });
});

// @desc    Update an automation (toggle status, edit template text)
// @route   PUT /api/automations/:id
// @access  Private
const updateAutomation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, messageText, name, sendTo } = req.body;

  let automation = await Automation.findById(id);
  if (!automation) {
    res.status(404);
    throw new Error('Automation not found');
  }

  if (status !== undefined) {
    automation.status = status;
  }
  if (messageText !== undefined) {
    automation.messageText = messageText;
  }
  if (name !== undefined) {
    automation.name = name;
  }
  if (sendTo !== undefined) {
    automation.sendTo = sendTo;
  }

  await automation.save();

  res.json({
    success: true,
    message: `Automation "${automation.name}" updated successfully!`,
    automation,
  });
});

// @desc    Test trigger an automation (e.g. simulate missed call)
// @route   POST /api/automations/test-trigger
// @access  Private
const testTriggerAutomation = asyncHandler(async (req, res) => {
  const { key = 'missed_call', customerPhone, customerName } = req.body;

  if (key === 'missed_call') {
    const phone = customerPhone || req.user.phone || '+91 99999 88888';
    const name = customerName || 'Valued Test Client';

    const result = await handleMissedCall({
      customerPhone: phone,
      customerName: name,
      telecallerId: req.user._id,
      telecallerName: req.user.name,
    });

    return res.json({
      success: true,
      message: `Simulated Missed Call automation for ${phone}. Check WhatsApp logs and follow-up queue!`,
      result,
    });
  }

  res.status(400);
  throw new Error(`Automation key "${key}" is not supported for test trigger`);
});

module.exports = {
  getAutomations,
  getAutomationLogs,
  updateAutomation,
  testTriggerAutomation,
};
