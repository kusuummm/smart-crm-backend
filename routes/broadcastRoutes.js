const express = require('express');
const router = express.Router();
const {
  getBroadcasts,
  createBroadcast,
  retryBroadcast,
} = require('../controllers/broadcastController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getBroadcasts)
  .post(createBroadcast);

router.post('/:id/retry', retryBroadcast);

module.exports = router;
