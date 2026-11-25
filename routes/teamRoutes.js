const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
} = require('../controllers/teamController');

router.use(protect);
router.route('/').get(getTeams).post(createTeam);
router.route('/:id').put(updateTeam).delete(deleteTeam);

module.exports = router;
