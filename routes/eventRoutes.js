const express = require('express');
const router = express.Router();
const {
  createEvent,
  getEvents,
  getUpcomingEvents,
  updateEvent,
  triggerReminder,
  deleteEvent,
} = require('../controllers/eventController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/upcoming', getUpcomingEvents);
router.route('/').post(createEvent).get(getEvents);
router.route('/:id').put(updateEvent).delete(deleteEvent);
router.post('/:id/remind', triggerReminder);

module.exports = router;
