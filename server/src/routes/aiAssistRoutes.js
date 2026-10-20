const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { aiRateLimit } = require('../utils/aiThrottle');
const { breakdown, standup, sprintPlan, applySprint } = require('../controllers/aiAssistController');

// Mounted at /api
const router = express.Router();

router.post('/tasks/:id/ai/breakdown', protect, validateObjectId('id'), aiRateLimit, breakdown); // FR25
router.post('/projects/:projectId/ai/standup', protect, validateObjectId('projectId'), aiRateLimit, standup); // FR23
router.post('/projects/:projectId/ai/sprint-plan', protect, validateObjectId('projectId'), aiRateLimit, sprintPlan); // FR24
router.post('/projects/:projectId/sprint/apply', protect, validateObjectId('projectId'), applySprint); // FR24

module.exports = router;
