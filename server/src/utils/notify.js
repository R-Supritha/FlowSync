const Notification = require('../models/Notification');
const User = require('../models/User');

// Maps notification types to the recipient's preference flags (FR22).
// Unknown types (future events) are always delivered.
const PREF_BY_TYPE = {
  task_assigned: 'taskAssigned',
  status_changed: 'taskUpdates',
  comment_reply: 'comments',
  mention: 'mentions',
  deadline_approaching: 'dueDates',
};

// Fire-and-forget: notification delivery must never break the action that triggered it
// (e.g. a failed notification should not stop a task assignment from saving).
// Never notifies a user about their own action.
// Honours the recipient's per-category preferences from Settings.
async function notify({ user, actor, type, message, link }) {
  try {
    if (!user || String(user) === String(actor)) return null;

    const prefKey = PREF_BY_TYPE[type];
    if (prefKey) {
      const target = await User.findById(user).select('settings.notifications');
      const prefs = target && target.settings && target.settings.notifications;
      if (prefs && prefs[prefKey] === false) return null;
    }

    return await Notification.create({ user, type, message, link });
  } catch (error) {
    console.error('notify() failed:', error.message);
    return null;
  }
}

module.exports = { notify };
