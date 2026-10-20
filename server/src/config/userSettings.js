// Shared between the settings controller, the notification filter and the
// frontend (values are echoed through GET /api/settings).

const THEMES = ['system', 'light', 'dark', 'midnight', 'contrast'];
const LANGUAGES = [
  // Only languages whose UI strings actually exist belong here.
  { id: 'en', label: 'English' },
];

// Maps notification event types (see models/Notification.js) to preference keys.
const NOTIFICATION_PREF_KEYS = ['taskAssigned', 'taskUpdates', 'comments', 'mentions', 'dueDates'];

const DEFAULT_SETTINGS = {
  theme: 'system',
  fontSize: 14,
  language: 'en',
  notifications: {
    taskAssigned: true,
    taskUpdates: true,
    comments: true,
    mentions: true,
    dueDates: true,
  },
};

module.exports = { THEMES, LANGUAGES, NOTIFICATION_PREF_KEYS, DEFAULT_SETTINGS };
