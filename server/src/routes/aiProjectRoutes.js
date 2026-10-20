const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { generatePlan, createProjectFromPlan } = require('../controllers/aiProjectController');

// Mounted at /api
const router = express.Router();

router.post('/ai/generate-plan', protect, generatePlan);
router.post(
  '/workspaces/:workspaceId/projects/generate',
  protect,
  validateObjectId('workspaceId'),
  createProjectFromPlan
);

module.exports = router;
