const express = require('express');
const router = express.Router();
const {
  submitEod,
  getMyTodayEod,
  getMyEodHistory,
  getAllEods,
  getEodSummary,
  reviewEod,
  deleteEod,
} = require('../controllers/eodController');
const { protect, authorize } = require('../middleware/auth');

// All EOD routes require authentication
router.use(protect);

// Member Endpoints
router.post('/', submitEod);
router.get('/today', getMyTodayEod);
router.get('/history', getMyEodHistory);

// Admin & Manager Oversight Endpoints
router.get('/admin/all', authorize('manager'), getAllEods);
router.get('/admin/summary', authorize('manager'), getEodSummary);
router.put('/:id/review', authorize('manager'), reviewEod);
router.delete('/:id', authorize('admin'), deleteEod);

module.exports = router;
