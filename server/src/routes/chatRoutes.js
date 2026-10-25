const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { createLimiter } = require('../utils/rateWindow');
const c = require('../controllers/chatController');

// Mounted at /api, before the general request limiter (chat polls and streams a lot, like the activity feed).
const router = express.Router();

// at most 30 reactions per person in 10 seconds
const reactLimit = createLimiter({ windowMs: 10 * 1000, max: 30, message: 'You are reacting too fast.' });

// at most 20 messages per person in 10 seconds
const sendLimit = createLimiter({ windowMs: 10 * 1000, max: 20, message: 'You are sending messages too fast.' });

router.get('/workspaces/:workspaceId/channels', protect, validateObjectId('workspaceId'), c.listChannels); // FR26
router.post('/workspaces/:workspaceId/channels', protect, validateObjectId('workspaceId'), c.createChannel); // FR26
router.get('/workspaces/:workspaceId/chat/stream', protect, validateObjectId('workspaceId'), c.stream); // FR27
router.patch('/channels/:id', protect, validateObjectId('id'), c.updateChannel); // FR26
router.delete('/channels/:id', protect, validateObjectId('id'), c.deleteChannel); // FR26
router.delete('/channels/:id/messages', protect, validateObjectId('id'), c.clearChannel); // FR27 clear chat
router.get('/channels/:id/messages', protect, validateObjectId('id'), c.listMessages); // FR27
router.post('/channels/:id/messages', protect, validateObjectId('id'), sendLimit, c.sendMessage); // FR27
router.post('/channels/:id/read', protect, validateObjectId('id'), c.markRead); // FR27
router.patch('/messages/:id', protect, validateObjectId('id'), c.editMessage); // FR27
router.delete('/messages/:id', protect, validateObjectId('id'), c.deleteMessage); // FR27
router.post('/messages/:id/reactions', protect, validateObjectId('id'), reactLimit, c.reactToMessage); // FR28 reactions

// for tests
router.resetLimits = () => { sendLimit.reset(); reactLimit.reset(); };

module.exports = router;
