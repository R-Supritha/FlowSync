const { serverError } = require('../utils/access');
const Notification = require('../models/Notification');
const { createDeadlineReminders } = require('../utils/reminders');

async function getMyNotifications(req, res) {
  try {
    // Deadline reminders are created when the person opens the app (the bell asks regularly),
    // so no background timer is needed. A problem here must never stop the list from loading.
    await createDeadlineReminders(req.user.id).catch((error) => console.error('Deadline reminders failed:', error.message));

    const filter = { user: req.user.id };
    if (req.query.unread === 'true') filter.isRead = false;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user.id, isRead: false }),
    ]);

    res.json({ success: true, notifications, total, page, pages: Math.ceil(total / limit), unreadCount });
  } catch (error) {
    serverError(res, 'Failed to fetch notifications', error);
  }
}

async function markRead(req, res) {
  try {
    const notification = await Notification.findOne({ _id: req.params.id, user: req.user.id });
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });

    notification.isRead = true;
    await notification.save();
    res.json({ success: true, notification });
  } catch (error) {
    serverError(res, 'Failed to update notification', error);
  }
}

async function markAllRead(req, res) {
  try {
    const result = await Notification.updateMany({ user: req.user.id, isRead: false }, { isRead: true });
    res.json({ success: true, updated: result.modifiedCount });
  } catch (error) {
    serverError(res, 'Failed to update notifications', error);
  }
}

async function deleteNotification(req, res) {
  try {
    const result = await Notification.deleteOne({ _id: req.params.id, user: req.user.id });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    serverError(res, 'Failed to delete notification', error);
  }
}

module.exports = { getMyNotifications, markRead, markAllRead, deleteNotification };
