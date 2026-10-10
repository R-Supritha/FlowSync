const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { getProjectAnalytics, getWorkspaceAnalytics } = require('../controllers/analyticsController');

// Mounted at /api
const router = express.Router();

router.get('/projects/:projectId/analytics', protect, validateObjectId('projectId'), getProjectAnalytics);
router.get('/workspaces/:workspaceId/analytics', protect, validateObjectId('workspaceId'), getWorkspaceAnalytics);

module.exports = router;