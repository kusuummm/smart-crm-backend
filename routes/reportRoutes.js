const express = require('express');
const router = express.Router();
const {
  dailyFollowUpReport,
  monthlyReport,
  leadConversionReport,
  telecallerPerformanceReport,
  getTelecallerReportGraph,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.get('/daily-followups', dailyFollowUpReport);
router.get('/monthly', monthlyReport);
router.get('/lead-conversion', leadConversionReport);
router.get('/telecaller-performance', authorize('admin'), telecallerPerformanceReport);
router.get('/telecaller/:id/graph', authorize('admin'), getTelecallerReportGraph);

module.exports = router;
