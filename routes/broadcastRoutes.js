const express = require('express');
const router = express.Router();
const {
  getBroadcasts,
  createBroadcast,
  retryBroadcast,
} = require('../controllers/broadcastController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(authorize('manager'), getBroadcasts)
  .post(authorize('admin'), createBroadcast);

router.post('/:id/retry', authorize('admin'), retryBroadcast);

module.exports = router;
