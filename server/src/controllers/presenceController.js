const mongoose = require('mongoose');
const User = require('../models/User');
const Task = require('../models/Task');
const Presence = require('../models/Presence');
const Workspace = require('../models/Workspace');
const ActivityLog = require('../models/ActivityLog');
const { isWorkspaceMember, serverError } = require('../utils/access');
const { resolvePresence, IDLE_AFTER_MS } = require('../utils/presence');
const {
  VISIBILITY_LEVELS,
  readPrivacy,
  makeViewerGate,
  sharedWorkspaces,
  visibleWorkspaceIds,
} = require('../utils/privacy');

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

// Newest event per actor in the last 15 minutes (used for Active/Idle and optional work-mode inference).
async function latestEvents(actorIds, workspaceIds) {
  const since = new Date(Date.now() - IDLE_AFTER_MS);
  const events = await ActivityLog.find({
    actor: { $in: actorIds },
    workspace: { $in: workspaceIds },
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .select('actor type meta createdAt')
    .lean();
  const latest = new Map();
  for (const e of events) {
    const key = String(e.actor);
    if (!latest.has(key)) latest.set(key, e);
  }
  return latest;
}

async function myWorkspaceIds(userId) {
  const list = await Workspace.find({ 'members.user': userId }).select('_id').lean();
  return list.map((w) => w._id);
}

async function describe(userId, user, presence, workspaceIds) {
  const latest = await latestEvents([userId], workspaceIds);
  const resolved = resolvePresence({
    presence,
    lastEvent: latest.get(String(userId)),
    inferMode: readPrivacy(user).inferWorkMode,
  });
  let workingOn = null;
  if (presence && presence.workingOn && resolved.status !== 'Offline') {
    workingOn = await Task.findById(presence.workingOn).select('title').lean();
  }
  return { ...resolved, workingOn };
}

// POST /presence/heartbeat - the app calls this about once a minute while open.
// Body: { "active": true|false } - false when the tab is open but hidden/unfocused.
async function heartbeat(req, res) {
  try {
    const { active } = req.body || {};
    if (active !== undefined && typeof active !== 'boolean') return fail(res, 400, 'active must be true or false');

    const now = new Date();
    const set = { lastSeenAt: now };
    if (active !== false) set.lastActiveAt = now;

    const presence = await Presence.findOneAndUpdate(
      { user: req.user.id },
      { $set: set },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const user = await User.findById(req.user.id).select('privacy');
    res.json({ success: true, presence: await describe(req.user.id, user, presence, await myWorkspaceIds(req.user.id)) });
  } catch (error) {
    serverError(res, 'Failed to record heartbeat', error);
  }
}

// PUT /presence/status
// Body (any of): { status: "Active"|"Idle"|"Offline"|"Do Not Disturb"|"auto",
//                  workMode: "Coding"|"Reviewing"|"Testing"|"Designing"|null,
//                  workingOn: "<taskId>"|null }
async function setStatus(req, res) {
  try {
    const { status, workMode, workingOn } = req.body || {};
    if (status === undefined && workMode === undefined && workingOn === undefined) {
      return fail(res, 400, 'Provide status, workMode or workingOn');
    }

    const set = {};
    const unset = {};

    if (status !== undefined) {
      if (status === 'auto') unset.manualStatus = '';
      else if (Presence.STATUSES.includes(status)) set.manualStatus = status;
      else return fail(res, 400, `status must be "auto" or one of: ${Presence.STATUSES.join(', ')}`);
    }

    if (workMode !== undefined) {
      if (workMode === null || workMode === '') unset.workMode = '';
      else if (Presence.WORK_MODES.includes(workMode)) set.workMode = workMode;
      else return fail(res, 400, `workMode must be null or one of: ${Presence.WORK_MODES.join(', ')}`);
    }

    if (workingOn !== undefined) {
      if (workingOn === null || workingOn === '') {
        unset.workingOn = '';
      } else {
        if (!mongoose.isValidObjectId(workingOn)) return fail(res, 400, 'workingOn must be a task id');
        const task = await Task.findById(workingOn).select('workspace');
        if (!task || !(await isWorkspaceMember(task.workspace, req.user.id))) return fail(res, 404, 'Task not found');
        set.workingOn = workingOn;
      }
    }

    // Changing your status counts as being here right now.
    const now = new Date();
    set.lastSeenAt = now;
    set.lastActiveAt = now;

    const update = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;

    const presence = await Presence.findOneAndUpdate({ user: req.user.id }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    const user = await User.findById(req.user.id).select('privacy');
    res.json({ success: true, presence: await describe(req.user.id, user, presence, await myWorkspaceIds(req.user.id)) });
  } catch (error) {
    serverError(res, 'Failed to update status', error);
  }
}

// GET /presence/me
async function getMyPresence(req, res) {
  try {
    const [presence, user] = await Promise.all([
      Presence.findOne({ user: req.user.id }),
      User.findById(req.user.id).select('privacy'),
    ]);
    res.json({ success: true, presence: await describe(req.user.id, user, presence, await myWorkspaceIds(req.user.id)) });
  } catch (error) {
    serverError(res, 'Failed to fetch presence', error);
  }
}

// GET /workspaces/:workspaceId/presence - everyone in the workspace, filtered by each person's privacy setting
async function getWorkspacePresence(req, res) {
  try {
    const workspace = await Workspace.findById(req.params.workspaceId).select('members').lean();
    const isMember = workspace && workspace.members.some((m) => String(m.user) === String(req.user.id));
    if (!isMember) return fail(res, 404, 'Workspace not found');

    const memberIds = workspace.members.map((m) => m.user);
    const [users, presences, latest, canSee] = await Promise.all([
      User.find({ _id: { $in: memberIds } }).select('name email avatarUrl privacy').lean(),
      Presence.find({ user: { $in: memberIds } }).lean(),
      latestEvents(memberIds, [workspace._id]),
      makeViewerGate(req.user.id, [workspace]),
    ]);
    const presenceByUser = new Map(presences.map((p) => [String(p.user), p]));

    const taskIds = presences.map((p) => p.workingOn).filter(Boolean);
    const tasks = taskIds.length ? await Task.find({ _id: { $in: taskIds } }).select('title').lean() : [];
    const taskById = new Map(tasks.map((t) => [String(t._id), t]));

    const members = users.map((u) => {
      const privacy = readPrivacy(u);
      const base = { user: { _id: u._id, name: u.name, email: u.email, avatarUrl: u.avatarUrl || '' } };
      if (!canSee(u._id, privacy.statusVisibility)) return { ...base, hidden: true };

      const presence = presenceByUser.get(String(u._id));
      const resolved = resolvePresence({
        presence,
        lastEvent: latest.get(String(u._id)),
        inferMode: privacy.inferWorkMode,
      });
      const task = presence && presence.workingOn && resolved.status !== 'Offline' ? taskById.get(String(presence.workingOn)) : null;
      return { ...base, hidden: false, ...resolved, workingOn: task ? { _id: task._id, title: task.title } : null };
    });

    res.json({ success: true, members });
  } catch (error) {
    serverError(res, 'Failed to fetch workspace presence', error);
  }
}

// GET /users/:id/presence
async function getUserPresence(req, res) {
  try {
    const targetId = req.params.id;
    const shared = await sharedWorkspaces(req.user.id, targetId);
    if (!shared.length) return fail(res, 404, 'User not found');
    const user = await User.findById(targetId).select('name email privacy');
    if (!user) return fail(res, 404, 'User not found');

    const privacy = readPrivacy(user);
    const visibleIds = await visibleWorkspaceIds(req.user.id, targetId, privacy.statusVisibility, shared);
    const base = { _id: user._id, name: user.name };
    if (!visibleIds.length) return res.json({ success: true, user: base, hidden: true });

    const presence = await Presence.findOne({ user: targetId });
    res.json({ success: true, user: base, hidden: false, presence: await describe(targetId, user, presence, visibleIds) });
  } catch (error) {
    serverError(res, 'Failed to fetch presence', error);
  }
}

// GET /settings/privacy
async function getPrivacy(req, res) {
  try {
    const user = await User.findById(req.user.id).select('privacy');
    if (!user) return fail(res, 404, 'User not found');
    res.json({ success: true, privacy: readPrivacy(user), levels: VISIBILITY_LEVELS });
  } catch (error) {
    serverError(res, 'Failed to fetch privacy settings', error);
  }
}

// PUT /settings/privacy - { statusVisibility?, contributionVisibility?, inferWorkMode? }
async function updatePrivacy(req, res) {
  try {
    const body = req.body || {};
    const set = {};

    for (const field of ['statusVisibility', 'contributionVisibility']) {
      if (body[field] !== undefined) {
        if (!VISIBILITY_LEVELS.includes(body[field])) {
          return fail(res, 400, `${field} must be one of: ${VISIBILITY_LEVELS.join(', ')}`);
        }
        set[`privacy.${field}`] = body[field];
      }
    }
    if (body.inferWorkMode !== undefined) {
      if (typeof body.inferWorkMode !== 'boolean') return fail(res, 400, 'inferWorkMode must be true or false');
      set['privacy.inferWorkMode'] = body.inferWorkMode;
    }
    if (!Object.keys(set).length) return fail(res, 400, 'No valid privacy fields to update');

    const user = await User.findByIdAndUpdate(req.user.id, { $set: set }, { new: true, runValidators: true }).select('privacy');
    if (!user) return fail(res, 404, 'User not found');
    res.json({ success: true, privacy: readPrivacy(user) });
  } catch (error) {
    serverError(res, 'Failed to update privacy settings', error);
  }
}

module.exports = {
  heartbeat,
  setStatus,
  getMyPresence,
  getWorkspacePresence,
  getUserPresence,
  getPrivacy,
  updatePrivacy,
};