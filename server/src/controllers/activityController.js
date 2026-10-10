const mongoose = require('mongoose');
const Project = require('../models/Project');
const ActivityLog = require('../models/ActivityLog');
const { getWorkspaceRole, parseDate, serverError } = require('../utils/access');
const { subscribe } = require('../utils/activityBus');

const PING_MS = 25000;

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

async function loadProject(req, res) {
  const project = await Project.findById(req.params.projectId);
  if (!project) return fail(res, 404, 'Project not found');
  const role = await getWorkspaceRole(project.workspace, req.user.id);
  if (!role) return fail(res, 404, 'Project not found');
  return { project, role };
}

// Shared by the project and workspace feeds. Adds the optional filters to `base`.
function applyFilters(base, query) {
  const filter = { ...base };

  if (query.type) {
    if (!ActivityLog.TYPES.includes(query.type)) {
      return { error: `type must be one of: ${ActivityLog.TYPES.join(', ')}` };
    }
    filter.type = query.type;
  }
  if (query.category) {
    if (!ActivityLog.CATEGORIES.includes(query.category)) {
      return { error: `category must be one of: ${ActivityLog.CATEGORIES.join(', ')}` };
    }
    filter.category = query.category;
  }
  if (query.actor) {
    if (!mongoose.isValidObjectId(query.actor)) return { error: 'Invalid actor' };
    filter.actor = query.actor;
  }

  // before = older than (for "load more"), since = newer than (for polling).
  const before = parseDate(query.before);
  const since = parseDate(query.since);
  if (before === 'invalid' || since === 'invalid') return { error: 'Invalid before/since date' };
  if (before || since) {
    filter.createdAt = {};
    if (before) filter.createdAt.$lt = before;
    if (since) filter.createdAt.$gt = since;
  }
  return { filter };
}

async function sendFeed(req, res, base) {
  const { filter, error } = applyFilters(base, req.query);
  if (error) return fail(res, 400, error);

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const activities = await ActivityLog.find(filter)
    .populate('actor', 'name email')
    .populate('project', 'name')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  res.json({
    success: true,
    activities,
    count: activities.length,
    // Pass this back as ?before= to load the next (older) page.
    nextBefore: activities.length === limit ? activities[activities.length - 1].createdAt : null,
  });
}

// GET /projects/:projectId/activity
async function getProjectActivity(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    await sendFeed(req, res, { project: loaded.project._id });
  } catch (error) {
    serverError(res, 'Failed to fetch activity feed', error);
  }
}

// GET /workspaces/:workspaceId/activity - every project in the workspace
async function getWorkspaceActivity(req, res) {
  try {
    const role = await getWorkspaceRole(req.params.workspaceId, req.user.id);
    if (!role) return fail(res, 404, 'Workspace not found');
    await sendFeed(req, res, { workspace: req.params.workspaceId });
  } catch (error) {
    serverError(res, 'Failed to fetch activity feed', error);
  }
}

// GET /projects/:projectId/activity/stream - Server-Sent Events, new events arrive as they happen.
async function streamProjectActivity(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const projectId = String(loaded.project._id);

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ project: projectId })}\n\n`);

    const unsubscribe = subscribe(projectId, (activity) => {
      res.write(`event: activity\ndata: ${JSON.stringify(activity)}\n\n`);
    });
    // Comment lines keep proxies/browsers from closing an idle connection.
    const timer = setInterval(() => res.write(': ping\n\n'), PING_MS);

    req.on('close', () => {
      clearInterval(timer);
      unsubscribe();
    });
  } catch (error) {
    if (res.headersSent) res.end();
    else serverError(res, 'Failed to open activity stream', error);
  }
}

module.exports = { getProjectActivity, getWorkspaceActivity, streamProjectActivity };