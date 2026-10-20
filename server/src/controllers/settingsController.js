const User = require('../models/User');
const { VISIBILITY_LEVELS, readPrivacy } = require('../utils/privacy');
const { THEMES, LANGUAGES, DEFAULT_SETTINGS, NOTIFICATION_PREF_KEYS } = require('../config/userSettings');
const { serverError } = require('../utils/access');

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// Fills defaults for users created before settings existed (or who never saved).
function readSettings(user) {
  const s = (user && user.settings) || {};
  const n = s.notifications || {};
  const notifications = {};
  for (const key of NOTIFICATION_PREF_KEYS) {
    notifications[key] = typeof n[key] === 'boolean' ? n[key] : DEFAULT_SETTINGS.notifications[key];
  }
  return {
    theme: THEMES.includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
    fontSize: Number.isFinite(s.fontSize) ? s.fontSize : DEFAULT_SETTINGS.fontSize,
    language: LANGUAGES.some((l) => l.id === s.language) ? s.language : DEFAULT_SETTINGS.language,
    notifications,
  };
}

// GET /api/settings - one payload for the whole settings page.
async function getSettings(req, res) {
  try {
    const user = await User.findById(req.user.id).select('settings privacy').lean();
    if (!user) return fail(res, 404, 'User not found');
    res.json({
      success: true,
      settings: readSettings(user),
      // Distinguishes "never saved" from "saved the default values" so the
      // client does not clobber a locally stored theme with server defaults.
      configured: Boolean(user.settings && user.settings.configuredAt),
      privacy: readPrivacy(user),
      visibilityLevels: VISIBILITY_LEVELS,
      languages: LANGUAGES,
    });
  } catch (error) {
    serverError(res, 'Failed to load settings', error);
  }
}

// Validates one settings field; returns { value } or { error }.
function validateField(body, field) {
  if (body[field] === undefined) return null;

  if (field === 'theme') {
    if (!THEMES.includes(body.theme)) return { error: `theme must be one of: ${THEMES.join(', ')}` };
    return { value: body.theme };
  }
  if (field === 'fontSize') {
    const n = Number(body.fontSize);
    if (!Number.isFinite(n) || n < 12 || n > 22) return { error: 'fontSize must be a number between 12 and 22' };
    return { value: Math.round(n) };
  }
  if (field === 'language') {
    if (!LANGUAGES.some((l) => l.id === body.language)) {
      return { error: `language must be one of: ${LANGUAGES.map((l) => l.id).join(', ')}` };
    }
    return { value: body.language };
  }
  if (field === 'notifications') {
    const value = body.notifications;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 'notifications must be an object of true/false flags' };
    }
    const clean = {};
    for (const key of Object.keys(value)) {
      if (!NOTIFICATION_PREF_KEYS.includes(key)) {
        return { error: `Unknown notification preference: ${key}` };
      }
      if (typeof value[key] !== 'boolean') {
        return { error: `notifications.${key} must be true or false` };
      }
      clean[key] = value[key];
    }
    return { value: clean };
  }
  return null;
}

function validatePrivacy(body) {
  const set = {};
  for (const field of ['statusVisibility', 'contributionVisibility']) {
    if (body[field] !== undefined) {
      if (!VISIBILITY_LEVELS.includes(body[field])) {
        return { error: `${field} must be one of: ${VISIBILITY_LEVELS.join(', ')}` };
      }
      set[`privacy.${field}`] = body[field];
    }
  }
  if (body.inferWorkMode !== undefined) {
    if (typeof body.inferWorkMode !== 'boolean') return { error: 'inferWorkMode must be true or false' };
    set['privacy.inferWorkMode'] = body.inferWorkMode;
  }
  return { set };
}

// PUT /api/settings - updates the caller's own settings. The user id always
// comes from the auth token; a client-supplied id is ignored.
async function updateSettings(req, res) {
  try {
    const body = req.body || {};
    const set = {};

    for (const field of ['theme', 'fontSize', 'language']) {
      const result = validateField(body, field);
      if (result && result.error) return fail(res, 400, result.error);
      if (result) set[`settings.${field}`] = result.value;
    }

    const notifications = validateField(body, 'notifications');
    if (notifications && notifications.error) return fail(res, 400, notifications.error);
    if (notifications) {
      for (const [key, value] of Object.entries(notifications.value)) {
        set[`settings.notifications.${key}`] = value;
      }
    }

    const privacy = validatePrivacy(body);
    if (privacy.error) return fail(res, 400, privacy.error);
    Object.assign(set, privacy.set);

    // Any explicit save marks the settings as configured (even if they match defaults).
    const hasNonPrivacyUpdate = Object.keys(set).some((k) => k.startsWith('settings.'));
    if (hasNonPrivacyUpdate) set['settings.configuredAt'] = new Date();
    else if (!Object.keys(set).length) return fail(res, 400, 'No valid settings to update');

    const user = await User.findByIdAndUpdate(req.user.id, { $set: set }, { new: true, runValidators: true })
      .select('settings privacy')
      .lean();
    if (!user) return fail(res, 404, 'User not found');

    res.json({
      success: true,
      settings: readSettings(user),
      configured: true,
      privacy: readPrivacy(user),
    });
  } catch (error) {
    serverError(res, 'Failed to update settings', error);
  }
}

module.exports = { getSettings, updateSettings, readSettings };
