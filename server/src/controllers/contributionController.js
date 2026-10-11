const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { serverError } = require('../utils/access');
const { weekRange } = require('../utils/dateRange');
const { startOfDay, addDays, parseDay, dayKey } = require('../utils/analyticsMath');
const { buildWeek, summarize, colorFor, countByCategory } = require('../utils/activity');
const { readPrivacy, sharedWorkspaces, visibleWorkspaceIds } = require('../utils/privacy');

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

// Who may see this person's dots, and from which workspaces (FR16 + FR17 privacy settings).
async function resolveAccess(req, res) {
  const viewerId = req.user.id;
  const targetId = req.params.id;

  const shared = await sharedWorkspaces(viewerId, targetId);
  if (!shared.length) return fail(res, 404, 'User not found');

  const target = await User.findById(targetId).select('name email privacy');
  if (!target) return fail(res, 404, 'User not found');

  let candidates = shared;
  if (req.query.workspaceId) {
    candidates = shared.filter((w) => String(w._id) === String(req.query.workspaceId));
    if (!candidates.length) return fail(res, 404, 'Workspace not found');
  }

  const level = readPrivacy(target).contributionVisibility;
  const workspaceIds = await visibleWorkspaceIds(viewerId, targetId, level, candidates);
  if (!workspaceIds.length) return fail(res, 403, 'This user has not shared their activity with you');

  return { target, workspaceIds };
}

// GET /users/:id/contributions?date=YYYY-MM-DD&workspaceId=...
async function getWeeklyContributions(req, res) {
  try {
    const day = parseDay(req.query.date);
    if (!day) return fail(res, 400, 'Invalid date');

    const access = await resolveAccess(req, res);
    if (!access) return;
    const { target, workspaceIds } = access;

    const { start, end } = weekRange(day);
    const events = await ActivityLog.find({
      actor: target._id,
      workspace: { $in: workspaceIds },
      createdAt: { $gte: start, $lt: end },
    })
      .select('type category createdAt')
      .lean();

    res.json({
      success: true,
      user: { _id: target._id, name: target.name },
      weekStart: dayKey(start),
      weekEnd: dayKey(addDays(end, -1)),
      days: buildWeek(events, start),
      totals: { ...countByCategory(events), total: events.length },
    });
  } catch (error) {
    serverError(res, 'Failed to fetch contributions', error);
  }
}

// GET /users/:id/contributions/day?date=YYYY-MM-DD - the events behind one dot
async function getDayContributions(req, res) {
  try {
    const day = parseDay(req.query.date);
    if (!day) return fail(res, 400, 'Invalid date');

    const access = await resolveAccess(req, res);
    if (!access) return;
    const { target, workspaceIds } = access;

    const start = startOfDay(day);
    const events = await ActivityLog.find({
      actor: target._id,
      workspace: { $in: workspaceIds },
      createdAt: { $gte: start, $lt: addDays(start, 1) },
    })
      .populate('project', 'name')
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    const counts = countByCategory(events);
    res.json({
      success: true,
      user: { _id: target._id, name: target.name },
      date: dayKey(start),
      color: colorFor(counts),
      counts,
      summary: summarize(events),
      events: events.map((e) => ({
        _id: e._id,
        type: e.type,
        category: e.category,
        message: e.message,
        project: e.project,
        taskTitle: e.taskTitle,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    serverError(res, 'Failed to fetch day contributions', error);
  }
}

module.exports = { getWeeklyContributions, getDayContributions };