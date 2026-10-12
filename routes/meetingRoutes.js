const express = require('express');
const router = express.Router();
const {
  createMeeting,
  getMeetings,
  updateMeeting,
  sendMeetingReminderNow,
  deleteMeeting,
} = require('../controllers/meetingController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .post(createMeeting)
  .get(getMeetings);

router.route('/:id')
  .put(updateMeeting)
  .delete(deleteMeeting);

router.post('/:id/send-reminder', sendMeetingReminderNow);

module.exports = router;
