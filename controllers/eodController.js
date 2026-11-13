const asyncHandler = require('express-async-handler');
const EodReport = require('../models/EodReport');
const User = require('../models/User');
const CallHistory = require('../models/CallHistory');
const FollowUp = require('../models/FollowUp');
const Lead = require('../models/Lead');

const getTodayDateString = () => new Date().toISOString().split('T')[0];

// Helper: parse call duration string
const parseSeconds = (dur) => {
  if (!dur) return 0;
  if (typeof dur === 'number') return dur;
  const str = String(dur).trim().toLowerCase();
  let total = 0;
  const mMatch = str.match(/(\d+)\s*m/);
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  const sMatch = str.match(/(\d+)\s*s/);
  if (sMatch) total += parseInt(sMatch[1], 10);
  if (!mMatch && !sMatch) {
    const num = parseInt(str, 10);
    if (!isNaN(num)) total += num;
  }
  return total;
};

const formatSeconds = (sec) => {
  if (!sec || sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

// @desc    Submit or update Member's EOD Report for a date
// @route   POST /api/eod
// @access  Private
const submitEod = asyncHandler(async (req, res) => {
  const {
    date = getTodayDateString(),
    callsMade = 0,
    callsConnected = 0,
    talkTime = '0s',
    leadsGenerated = 0,
    dealsClosed = 0,
    followUpsDone = 0,
    meetingsScheduled = 0,
    keyAchievements = '',
    challenges = '',
    planForTomorrow = '',
    status = 'submitted',
  } = req.body;

  const updateData = {
    userId: req.user._id,
    userName: req.user.name || req.user.email,
    userEmail: req.user.email || '',
    userRole: req.user.role || 'member',
    date,
    callsMade: Number(callsMade) || 0,
    callsConnected: Number(callsConnected) || 0,
    talkTime: String(talkTime || '0s'),
    leadsGenerated: Number(leadsGenerated) || 0,
    dealsClosed: Number(dealsClosed) || 0,
    followUpsDone: Number(followUpsDone) || 0,
    meetingsScheduled: Number(meetingsScheduled) || 0,
    keyAchievements: String(keyAchievements || ''),
    challenges: String(challenges || ''),
    planForTomorrow: String(planForTomorrow || ''),
    status: status === 'draft' ? 'draft' : 'submitted',
    submittedAt: new Date(),
  };

  const eod = await EodReport.findOneAndUpdate(
    { userId: req.user._id, date },
    updateData,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.status(200).json({
    success: true,
    message: 'End of Day (EOD) sheet saved successfully',
    eod,
  });
});

// @desc    Get member's today EOD + auto-calculated live CRM telephony metrics for today
// @route   GET /api/eod/today
// @access  Private
const getMyTodayEod = asyncHandler(async (req, res) => {
  const targetDate = req.query.date || getTodayDateString();

  // Find existing EOD report if already submitted
  const existingEod = await EodReport.findOne({
    userId: req.user._id,
    date: targetDate,
  });

  // Calculate live telephony metrics from the CRM database for today
  const [calls, followUps, leads] = await Promise.all([
    CallHistory.find({
      calledBy: req.user._id,
      date: targetDate,
    }).lean(),
    FollowUp.find({
      createdBy: req.user._id,
      date: targetDate,
      status: 'completed',
    }).lean(),
    Lead.find({
      telecallerId: req.user._id,
      createdAt: {
        $gte: new Date(`${targetDate}T00:00:00.000Z`),
        $lte: new Date(`${targetDate}T23:59:59.999Z`),
      },
    }).lean(),
  ]);

  const callsMade = calls.length;
  const connectedCalls = calls.filter((c) =>
    ['connected', 'answered'].includes((c.status || c.callStatus || '').toLowerCase())
  );
  const callsConnected = connectedCalls.length;
  const totalDurationSec = connectedCalls.reduce(
    (sum, c) => sum + parseSeconds(c.duration),
    0
  );
  const talkTime = formatSeconds(totalDurationSec);
  const followUpsDone = followUps.length;
  const leadsGenerated = leads.length;
  const dealsClosed = leads.filter((l) => /converted|won/i.test(l.status || '')).length;

  res.status(200).json({
    success: true,
    date: targetDate,
    existingEod,
    autoMetrics: {
      callsMade,
      callsConnected,
      talkTime,
      followUpsDone,
      leadsGenerated,
      dealsClosed,
    },
  });
});

// @desc    Get member's EOD submission history
// @route   GET /api/eod/history
// @access  Private
const getMyEodHistory = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 30);
  const skip = (page - 1) * limit;

  const [eods, total] = await Promise.all([
    EodReport.find({ userId: req.user._id })
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EodReport.countDocuments({ userId: req.user._id }),
  ]);

  res.status(200).json({
    success: true,
    eods,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
  });
});

// @desc    Admin/Manager: Get all members' EOD submissions
// @route   GET /api/eod/admin/all
// @access  Private (Manager, Admin, Owner)
const getAllEods = asyncHandler(async (req, res) => {
  const { date, userId, status, search, page = 1, limit = 50 } = req.query;
  const query = {};

  if (date) query.date = date;
  if (userId) query.userId = userId;
  if (status && status !== 'all') query.status = status;
  if (search) {
    query.$or = [
      { userName: { $regex: search, $options: 'i' } },
      { userEmail: { $regex: search, $options: 'i' } },
      { keyAchievements: { $regex: search, $options: 'i' } },
      { challenges: { $regex: search, $options: 'i' } },
    ];
  }

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.max(1, parseInt(limit, 10) || 50);
  const skip = (p - 1) * l;

  const [eods, total] = await Promise.all([
    EodReport.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(l)
      .lean(),
    EodReport.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    eods,
    total,
    page: p,
    pages: Math.ceil(total / l) || 1,
  });
});

// @desc    Admin/Manager: Daily EOD Summary (Submitted vs Missing members)
// @route   GET /api/eod/admin/summary?date=YYYY-MM-DD
// @access  Private (Manager, Admin, Owner)
const getEodSummary = asyncHandler(async (req, res) => {
  const targetDate = req.query.date || getTodayDateString();

  // Find all active team members / telecallers
  const members = await User.find({
    status: 'active',
    role: { $in: ['member', 'telecaller', 'user', 'caller'] },
  })
    .select('_id name email phone role isOnline')
    .lean();

  // Find all EOD reports for targetDate
  const eods = await EodReport.find({ date: targetDate }).lean();
  const eodMap = new Map();
  eods.forEach((e) => {
    eodMap.set(String(e.userId), e);
  });

  const submitted = [];
  const missing = [];

  members.forEach((m) => {
    const report = eodMap.get(String(m._id));
    if (report && report.status !== 'draft') {
      submitted.push({
        user: m,
        report,
      });
    } else {
      missing.push({
        user: m,
        report: report || null, // null or draft
      });
    }
  });

  // Calculate team aggregates across submitted reports
  const totals = eods.reduce(
    (acc, curr) => {
      acc.callsMade += curr.callsMade || 0;
      acc.callsConnected += curr.callsConnected || 0;
      acc.leadsGenerated += curr.leadsGenerated || 0;
      acc.dealsClosed += curr.dealsClosed || 0;
      acc.followUpsDone += curr.followUpsDone || 0;
      acc.meetingsScheduled += curr.meetingsScheduled || 0;
      return acc;
    },
    {
      callsMade: 0,
      callsConnected: 0,
      leadsGenerated: 0,
      dealsClosed: 0,
      followUpsDone: 0,
      meetingsScheduled: 0,
    }
  );

  res.status(200).json({
    success: true,
    date: targetDate,
    totalMembers: members.length,
    submittedCount: submitted.length,
    missingCount: missing.length,
    submissionRate:
      members.length > 0
        ? `${Math.round((submitted.length / members.length) * 100)}%`
        : '0%',
    submitted,
    missing,
    totals,
  });
});

// @desc    Admin/Manager: Review and add feedback to an EOD report
// @route   PUT /api/eod/:id/review
// @access  Private (Manager, Admin, Owner)
const reviewEod = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { adminFeedback = '', status = 'reviewed' } = req.body;

  const eod = await EodReport.findById(id);
  if (!eod) {
    res.status(404);
    throw new Error('EOD Report not found');
  }

  eod.adminFeedback = adminFeedback;
  eod.status = status;
  eod.reviewedBy = req.user._id;
  eod.reviewedByName = req.user.name || req.user.email;
  eod.reviewedAt = new Date();

  await eod.save();

  res.status(200).json({
    success: true,
    message: 'EOD report reviewed successfully',
    eod,
  });
});

// @desc    Admin/Owner: Delete an EOD report
// @route   DELETE /api/eod/:id
// @access  Private (Admin, Owner)
const deleteEod = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const eod = await EodReport.findById(id);
  if (!eod) {
    res.status(404);
    throw new Error('EOD Report not found');
  }

  await eod.deleteOne();

  res.status(200).json({
    success: true,
    message: 'EOD report deleted',
  });
});

module.exports = {
  submitEod,
  getMyTodayEod,
  getMyEodHistory,
  getAllEods,
  getEodSummary,
  reviewEod,
  deleteEod,
};
