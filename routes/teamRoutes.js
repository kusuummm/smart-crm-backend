const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
} = require('../controllers/teamController');

router.use(protect);
router.route('/').get(getTeams).post(authorize('admin', 'owner'), createTeam);
router.route('/:id').put(authorize('admin', 'owner'), updateTeam).delete(authorize('admin', 'owner'), deleteTeam);

module.exports = router;
