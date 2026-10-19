const asyncHandler = require('express-async-handler');
const FollowUp = require('../models/FollowUp');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const CallHistory = require('../models/CallHistory');
const { buildExcelBuffer, buildCsv } = require('../utils/exportHelper');

// Shared helper: sends report rows either as JSON, or as a downloadable
// .xlsx / .csv file, based on the `format` query param.
const respondWithReport = async (res, { filename, sheetName, columns, rows, format }) => {
  if (format === 'excel') {
    const buffer = await buildExcelBuffer(sheetName, columns, rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.send(Buffer.from(buffer));
  }

  if (format === 'csv') {
    const csv = buildCsv(columns, rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csv);
  }

  return res.json({ success: true, count: rows.length, rows });
};

// @desc    Daily follow-up report for a given date (defaults to today)
// @route   GET /api/reports/daily-followups?date=YYYY-MM-DD&format=json|excel|csv
// @access  Private (Telecaller only - strictly isolated)
const dailyFollowUpReport = asyncHandler(async (req, res) => {
  if (req.user.role === 'admin') {
    res.status(403);
    throw new Error('Access denied: Administrators cannot access telecaller activity reports');
  }

  const date = req.query.date || new Date().toISOString().split('T')[0];
  const format = req.query.format || 'json';

  // Strict isolation: callers can ONLY access their own follow-up reports
  const filter = { date, createdBy: req.user._id };

  const followUps = await FollowUp.find(filter).sort({ time: 1 });

  const columns = [
    { header: 'Customer Name', key: 'customerName', width: 25 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Time', key: 'time', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Remarks', key: 'remarks', width: 35 },
    { header: 'Next Follow-up', key: 'nextFollowUp', width: 15 },
    { header: 'Created By', key: 'createdByName', width: 20 },
  ];

  const rows = followUps.map((f) => f.toObject());

  await respondWithReport(res, {
    filename: `daily-followups-${date}`,
    sheetName: 'Daily Follow-ups',
    columns,
    rows,
    format,
  });
});

// @desc    Monthly report - follow-up and call activity summary for a given month
// @route   GET /api/reports/monthly?year=2026&month=7&format=json|excel|csv
// @access  Private (Telecaller only - strictly isolated)
const monthlyReport = asyncHandler(async (req, res) => {
  if (req.user.role === 'admin') {
    res.status(403);
    throw new Error('Access denied: Administrators cannot access telecaller activity reports');
  }

  const now = new Date();
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1; // 1-12
  const format = req.query.format || 'json';

  const prefix = `${year}-${String(month).padStart(2, '0')}`; // 'YYYY-MM'

  // Strict isolation: callers can ONLY access their own monthly reports
  const filter = { date: new RegExp(`^${prefix}`), createdBy: req.user._id };

  const followUps = await FollowUp.find(filter).sort({ date: 1 });

  const pending = followUps.filter((f) => f.status === 'pending').length;
  const completed = followUps.filter((f) => f.status === 'completed').length;

  const columns = [
    { header: 'Customer Name', key: 'customerName', width: 25 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Time', key: 'time', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Remarks', key: 'remarks', width: 35 },
  ];

  const rows = followUps.map((f) => f.toObject());

  if (format === 'json') {
    return res.json({
      success: true,
      month: prefix,
      summary: { total: followUps.length, pending, completed },
      rows,
    });
  }

  await respondWithReport(res, {
    filename: `monthly-report-${prefix}`,
    sheetName: `Monthly Report ${prefix}`,
    columns,
    rows,
    format,
  });
});

// @desc    Lead conversion report - breakdown of leads by status, with conversion rate
// @route   GET /api/reports/lead-conversion?format=json|excel|csv
// @access  Private (Telecaller only - strictly isolated)
const leadConversionReport = asyncHandler(async (req, res) => {
  if (req.user.role === 'admin') {
    res.status(403);
    throw new Error('Access denied: Administrators cannot access telecaller conversion reports');
  }

  const format = req.query.format || 'json';
  // Strict isolation: telecaller can only access their own leads
  const filter = { telecallerId: req.user._id };

  const leads = await Lead.find(filter);

  const statusCounts = leads.reduce((acc, lead) => {
    acc[lead.status] = (acc[lead.status] || 0) + 1;
    return acc;
  }, {});

  const total = leads.length;
  const converted = statusCounts['converted'] || 0;
  const conversionRate = total > 0 ? ((converted / total) * 100).toFixed(2) : '0.00';

  const columns = [
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Count', key: 'count', width: 10 },
  ];
  const rows = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

  if (format === 'json') {
    return res.json({ success: true, total, converted, conversionRate: `${conversionRate}%`, breakdown: rows });
  }

  await respondWithReport(res, {
    filename: 'lead-conversion-report',
    sheetName: 'Lead Conversion',
    columns,
    rows,
    format,
  });
});

// @desc    Telecaller performance report - customers handled, leads converted, follow-ups completed, calls made
// @route   GET /api/reports/telecaller-performance?format=json|excel|csv
// @access  Private/Admin
const telecallerPerformanceReport = asyncHandler(async (req, res) => {
  const format = req.query.format || 'json';
  const telecallers = await User.find({
    role: { $in: ['telecaller', 'Telecaller', 'member', 'Member', 'manager', 'Manager', 'lead', 'Lead'] },
  });

  const rows = await Promise.all(
    telecallers.map(async (tc) => {
      const [customerCount, leadsConverted, followUpsCompleted, callsMade] = await Promise.all([
        Customer.countDocuments({ $or: [{ telecallerId: tc._id }, { assignedTelecaller: tc.name }] }),
        Lead.countDocuments({ telecallerId: tc._id, status: 'converted' }),
        FollowUp.countDocuments({ createdBy: tc._id, status: 'completed' }),
        CallHistory.countDocuments({ calledBy: tc._id }),
      ]);

      return {
        name: tc.name,
        email: tc.email,
        status: tc.status,
        customersHandled: customerCount,
        leadsConverted,
        followUpsCompleted,
        callsMade,
      };
    })
  );

  const columns = [
    { header: 'Telecaller', key: 'name', width: 22 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Customers Handled', key: 'customersHandled', width: 18 },
    { header: 'Leads Converted', key: 'leadsConverted', width: 16 },
    { header: 'Follow-ups Completed', key: 'followUpsCompleted', width: 20 },
    { header: 'Calls Logged', key: 'callsMade', width: 16 },
  ];

  await respondWithReport(res, {
    filename: 'telecaller-performance-report',
    sheetName: 'Telecaller Performance',
    columns,
    rows,
    format,
  });
});

// @desc    Get detailed performance report & graph data for a specific telecaller
// @route   GET /api/reports/telecaller/:id/graph
// @access  Private/Admin
const getTelecallerReportGraph = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tc = await User.findById(id);
  if (!tc) {
    res.status(404);
    throw new Error('Telecaller not found');
  }

  const [customerCount, leads, followUps, calls] = await Promise.all([
    Customer.countDocuments({ $or: [{ telecallerId: tc._id }, { assignedTelecaller: tc.name }] }),
    Lead.find({ telecallerId: tc._id }),
    FollowUp.find({ createdBy: tc._id }),
    CallHistory.find({ calledBy: tc._id }),
  ]);

  const totalLeads = leads.length;
  const convertedLeads = leads.filter((l) => l.status === 'converted').length;
  const inProgressLeads = leads.filter((l) => l.status === 'in_progress' || l.status === 'contacted').length;
  const newLeads = leads.filter((l) => l.status === 'new').length;

  const totalCalls = calls.length;
  const connectedCalls = calls.filter((c) => c.status === 'connected').length;
  const missedCalls = calls.filter((c) => c.status === 'missed').length;
  const busyCalls = calls.filter((c) => c.status === 'busy').length;

  const totalFollowUps = followUps.length;
  const completedFollowUps = followUps.filter((f) => f.status === 'completed').length;
  const pendingFollowUps = followUps.filter((f) => f.status === 'pending').length;

  // Generate last 7 days daily activity
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dailyActivity = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayLabel = daysOfWeek[d.getDay()];

    const dayCalls = calls.filter((c) => c.date === dateStr).length;
    const dayFollowUps = followUps.filter((f) => f.date === dateStr).length;
    const dayLeads = leads.filter(
      (l) => l.createdAt && new Date(l.createdAt).toISOString().split('T')[0] === dateStr
    ).length;

    dailyActivity.push({
      date: dateStr,
      day: dayLabel,
      calls: dayCalls,
      followUps: dayFollowUps,
      leads: dayLeads,
    });
  }

  // Pipeline stage breakdown
  const stageBreakdown = [
    { name: 'New Leads', value: newLeads, color: '#3B82F6' },
    { name: 'In Progress', value: inProgressLeads, color: '#F59E0B' },
    { name: 'Converted', value: convertedLeads, color: '#10B981' },
    { name: 'Other', value: Math.max(0, totalLeads - newLeads - inProgressLeads - convertedLeads), color: '#8B5CF6' },
  ];

  res.json({
    success: true,
    telecaller: {
      _id: tc._id,
      name: tc.name,
      email: tc.email,
      phone: tc.phone || '',
      role: tc.role || 'telecaller',
      status: tc.status,
      isApproved: tc.isApproved,
      isOnline: tc.isOnline,
      createdAt: tc.createdAt,
      lastActive: tc.lastActive,
    },
    metrics: {
      customersHandled: customerCount,
      totalLeads,
      convertedLeads,
      conversionRate: totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0',
      totalCalls,
      connectedCalls,
      connectRate: totalCalls > 0 ? ((connectedCalls / totalCalls) * 100).toFixed(1) : '0',
      totalFollowUps,
      completedFollowUps,
      pendingFollowUps,
      followUpRate: totalFollowUps > 0 ? ((completedFollowUps / totalFollowUps) * 100).toFixed(1) : '0',
    },
    dailyActivity,
    stageBreakdown,
  });
});

module.exports = {
  dailyFollowUpReport,
  monthlyReport,
  leadConversionReport,
  telecallerPerformanceReport,
  getTelecallerReportGraph,
};
