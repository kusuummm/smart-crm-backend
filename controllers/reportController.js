const asyncHandler = require('express-async-handler');
const FollowUp = require('../models/FollowUp');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
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
// @access  Private
const dailyFollowUpReport = asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const format = req.query.format || 'json';

  const filter = { date };
  if (req.user.role === 'telecaller') filter.createdBy = req.user._id;

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
// @access  Private
const monthlyReport = asyncHandler(async (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1; // 1-12
  const format = req.query.format || 'json';

  const prefix = `${year}-${String(month).padStart(2, '0')}`; // 'YYYY-MM'

  const filter = { date: new RegExp(`^${prefix}`) };
  if (req.user.role === 'telecaller') filter.createdBy = req.user._id;

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
// @access  Private
const leadConversionReport = asyncHandler(async (req, res) => {
  const format = req.query.format || 'json';
  const filter = {};
  if (req.user.role === 'telecaller') filter.telecallerId = req.user._id;

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
  const telecallers = await User.find({ role: 'telecaller' });

  const rows = await Promise.all(
    telecallers.map(async (tc) => {
      const [customerCount, leadsConverted, followUpsCompleted] = await Promise.all([
        Customer.countDocuments({ telecallerId: tc._id }),
        Lead.countDocuments({ telecallerId: tc._id, status: 'converted' }),
        FollowUp.countDocuments({ createdBy: tc._id, status: 'completed' }),
      ]);

      return {
        name: tc.name,
        email: tc.email,
        status: tc.status,
        customersHandled: customerCount,
        leadsConverted,
        followUpsCompleted,
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
  ];

  await respondWithReport(res, {
    filename: 'telecaller-performance-report',
    sheetName: 'Telecaller Performance',
    columns,
    rows,
    format,
  });
});

module.exports = { dailyFollowUpReport, monthlyReport, leadConversionReport, telecallerPerformanceReport };
