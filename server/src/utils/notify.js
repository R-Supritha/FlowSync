const Notification = require('../models/Notification');

// Fire-and-forget: notification delivery must never break the action that triggered it
// (e.g. a failed notification should not stop a task assignment from saving).
// Never notifies a user about their own action.
async function notify({ user, actor, type, message, link }) {
  try {
    if (!user || String(user) === String(actor)) return null;
    return await Notification.create({ user, type, message, link });
  } catch (error) {
    console.error('notify() failed:', error.message);
    return null;
  }
}

module.exports = { notify };
