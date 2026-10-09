const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { getProjectCalendar, getWorkspaceCalendar } = require('../controllers/calendarController');

// Mounted at /api
const router = express.Router();

router.get('/projects/:projectId/calendar', protect, validateObjectId('projectId'), getProjectCalendar);
router.get('/workspaces/:workspaceId/calendar', protect, validateObjectId('workspaceId'), getWorkspaceCalendar);

module.exports = router;
