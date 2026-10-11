const IDLE_AFTER_MS = 15 * 60 * 1000; // no activity for 15 minutes -> Idle
const OFFLINE_AFTER_MS = 3 * 60 * 1000; // no heartbeat for 3 minutes -> Offline

// Work mode guessed from the user's most recent project event (only if they opted in).
function inferWorkMode(event) {
  if (!event) return null;
  if (event.type === 'commit_pushed') return 'Coding';
  if (['pr_opened', 'pr_merged', 'review_submitted'].includes(event.type)) return 'Reviewing';
  if (event.type === 'task_status_changed' && event.meta) {
    if (event.meta.to === 'Testing') return 'Testing';
    if (event.meta.to === 'Review') return 'Reviewing';
  }
  return null;
}

// presence: Presence doc/lean (or null). lastEvent: newest ActivityLog event for the user (or null).
function resolvePresence({ presence, lastEvent, inferMode = false, now = Date.now() }) {
  const seenAt = presence && presence.lastSeenAt ? new Date(presence.lastSeenAt).getTime() : 0;
  const connected = seenAt > 0 && now - seenAt <= OFFLINE_AFTER_MS;
  const manual = presence && presence.manualStatus;

  let status;
  let source = 'auto';
  if (manual === 'Offline' || manual === 'Do Not Disturb') {
    status = manual;
    source = 'manual';
  } else if (!connected) {
    status = 'Offline';
  } else if (manual) {
    status = manual;
    source = 'manual';
  } else {
    const activeAt = Math.max(
      presence && presence.lastActiveAt ? new Date(presence.lastActiveAt).getTime() : 0,
      lastEvent ? new Date(lastEvent.createdAt).getTime() : 0
    );
    status = now - activeAt <= IDLE_AFTER_MS ? 'Active' : 'Idle';
  }

  let workMode = null;
  let workModeSource = null;
  if (status !== 'Offline') {
    if (presence && presence.workMode) {
      workMode = presence.workMode;
      workModeSource = 'manual';
    } else if (inferMode && lastEvent && now - new Date(lastEvent.createdAt).getTime() <= IDLE_AFTER_MS) {
      workMode = inferWorkMode(lastEvent);
      workModeSource = workMode ? 'auto' : null;
    }
  }

  return { status, source, workMode, workModeSource };
}

module.exports = { IDLE_AFTER_MS, OFFLINE_AFTER_MS, inferWorkMode, resolvePresence };