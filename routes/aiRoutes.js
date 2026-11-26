const express = require('express');
const router = express.Router();
const {
  processAiChat,
  confirmAction,
  analyzeDocument,
  getAvailableTools,
} = require('../controllers/aiController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/chat', processAiChat);
router.post('/confirm-action', confirmAction);
router.post('/analyze-document', analyzeDocument);
router.get('/tools', getAvailableTools);

module.exports = router;
