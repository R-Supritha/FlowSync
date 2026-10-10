const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const {
  heartbeat,
  setStatus,
  getMyPresence,
  getWorkspacePresence,
  getUserPresence,
  getPrivacy,
  updatePrivacy,
} = require('../controllers/presenceController');

// Mounted at /api
const router = express.Router();

router.post('/presence/heartbeat', protect, heartbeat);
router.put('/presence/status', protect, setStatus);
router.get('/presence/me', protect, getMyPresence);
router.get('/workspaces/:workspaceId/presence', protect, validateObjectId('workspaceId'), getWorkspacePresence);
router.get('/users/:id/presence', protect, validateObjectId('id'), getUserPresence);

// Privacy controls shared with FR16 (and later FR22 Settings).
router.get('/settings/privacy', protect, getPrivacy);
router.put('/settings/privacy', protect, updatePrivacy);

module.exports = router;