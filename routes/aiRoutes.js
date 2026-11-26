const express = require('express');
const router = express.Router();
const {
  processAiChat,
  confirmAction,
  analyzeDocument,
  getAvailableTools,
} = require('../controllers/aiController');
const { protect } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const { concurrencyLimiter, requestTimeoutMiddleware } = require('../middleware/resourceProtection');

router.use(protect);
router.use(aiLimiter);
router.use(concurrencyLimiter({ maxConcurrent: 10, name: 'AI prompt and analysis requests' }));
router.use(requestTimeoutMiddleware(60));

router.post('/chat', processAiChat);
router.post('/confirm-action', confirmAction);
router.post('/analyze-document', analyzeDocument);
router.get('/tools', getAvailableTools);

module.exports = router;
