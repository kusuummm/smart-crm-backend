const express = require('express');
const router = express.Router();
const { createCall, getCalls, updateCall, deleteCall } = require('../controllers/callHistoryController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/').post(createCall).get(getCalls);
router.route('/:id').put(updateCall).delete(authorize('admin'), deleteCall);

module.exports = router;
