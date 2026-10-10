const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { getMyNotifications, markRead, markAllRead, deleteNotification } = require('../controllers/notificationController');

// Mounted at /api
const router = express.Router();

router.get('/notifications', protect, getMyNotifications);
router.patch('/notifications/read-all', protect, markAllRead);
router.patch('/notifications/:id/read', protect, validateObjectId('id'), markRead);
router.delete('/notifications/:id', protect, validateObjectId('id'), deleteNotification);

module.exports = router;
