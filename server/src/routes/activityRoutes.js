const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { getProjectActivity, getWorkspaceActivity, streamProjectActivity } = require('../controllers/activityController');

// Mounted at /api
const router = express.Router();

router.get('/projects/:projectId/activity', protect, validateObjectId('projectId'), getProjectActivity);
router.get('/projects/:projectId/activity/stream', protect, validateObjectId('projectId'), streamProjectActivity);
router.get('/workspaces/:workspaceId/activity', protect, validateObjectId('workspaceId'), getWorkspaceActivity);

module.exports = router;