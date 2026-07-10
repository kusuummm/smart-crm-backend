const express = require('express');
const router = express.Router();
const {
  createFollowUp,
  getFollowUps,
  getTodayFollowUps,
  updateFollowUp,
  deleteFollowUp,
} = require('../controllers/followUpController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/today', getTodayFollowUps);
router.route('/').post(createFollowUp).get(getFollowUps);
router.route('/:id').put(updateFollowUp).delete(deleteFollowUp);

module.exports = router;
