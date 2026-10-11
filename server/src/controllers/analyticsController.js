const Project = require('../models/Project');
const Task = require('../models/Task');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const ActivityLog = require('../models/ActivityLog');
const { getWorkspaceRole, serverError } = require('../utils/access');
const { readPrivacy, makeViewerGate } = require('../utils/privacy');
const {
  round,
  startOfDay,
  addDays,
  isDone,
  weeklyVelocity,
  averageCompletion,
  burnSeries,
  workload,
  deadlineRisk,
  forecastFinish,
  projectHealth,
} = require('../utils/analyticsMath');

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

const clampInt = (value, fallback, min, max) => Math.min(Math.max(parseInt(value, 10) || fallback, min), max);

// Archived tasks only matter if they were finished (they still count towards velocity).
const taskScope = (projectFilter) => ({
  ...projectFilter,
  $or: [{ isArchived: false }, { status: 'Done' }],
});

const TASK_FIELDS =
  'project title status priority assignee deadline estimatedHours actualHours dependencies createdAt updatedAt completedAt';

// Numbers shared by the project view and the workspace roll-up.
function coreMetrics(project, tasks, now) {
  const open = tasks.filter((t) => !isDone(t));
  const done = tasks.filter(isDone);
  const overdue = open.filter((t) => t.deadline && new Date(t.deadline) < now);
  const risk = deadlineRisk(open, tasks, project.columns, now);
  const velocity = weeklyVelocity(tasks, 6, now);
  const forecast = forecastFinish({
    openCount: open.length,
    velocity,
    projectCreatedAt: project.createdAt,
    deadline: project.deadline,
    now,
  });
  const health = projectHealth({
    total: tasks.length,
    open: open.length,
    overdue: overdue.length,
    atRisk: risk.filter((r) => !r.overdue).length,
    forecast,
    deadline: project.deadline,
    now,
  });
  return { open, done, overdue, risk, velocity, forecast, health };
}

function countBy(tasks, field) {
  const out = {};
  for (const t of tasks) out[t[field]] = (out[t[field]] || 0) + 1;
  return out;
}

// GET /projects/:projectId/analytics?weeks=6&days=30&unit=tasks|hours
async function getProjectAnalytics(req, res) {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return fail(res, 404, 'Project not found');
    const role = await getWorkspaceRole(project.workspace, req.user.id);
    if (!role) return fail(res, 404, 'Project not found');

    const now = new Date();
    const weeks = clampInt(req.query.weeks, 6, 1, 26);
    const days = clampInt(req.query.days, 30, 7, 180);
    const unit = req.query.unit === 'hours' ? 'hours' : 'tasks';

    const tasks = await Task.find(taskScope({ project: project._id })).select(TASK_FIELDS).lean();
    const core = coreMetrics(project, tasks, now);
    const velocity = weeks === 6 ? core.velocity : weeklyVelocity(tasks, weeks, now);

    // Burn chart window: the last `days` days, but never before the project started.
    const today = startOfDay(now);
    const projectStart = startOfDay(project.startDate || project.createdAt);
    const windowStart = addDays(today, -(days - 1));
    const burn = burnSeries(tasks, projectStart > windowStart ? projectStart : windowStart, today, unit, project.deadline);

    // Workload per person.
    const rows = workload(core.open, core.done, now);
    const userIds = rows.map((r) => r.assignee).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } }).select('name email').lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const workloadRows = rows.map((r) => ({
      ...r,
      assignee: r.assignee ? userById.get(String(r.assignee)) || { _id: r.assignee } : null,
    }));

    // Team activity (last 7 days) - only people who chose to share their activity with this viewer.
    const since = addDays(now, -7);
    const [workspace, grouped] = await Promise.all([
      Workspace.findById(project.workspace).select('members').lean(),
      ActivityLog.aggregate([
        { $match: { project: project._id, createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$actor',
            events: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$category', 'completed'] }, 1, 0] } },
            collaboration: { $sum: { $cond: [{ $eq: ['$category', 'collaboration'] }, 1, 0] } },
            planning: { $sum: { $cond: [{ $eq: ['$category', 'planning'] }, 1, 0] } },
          },
        },
        { $sort: { events: -1 } },
      ]),
    ]);
    const canSee = await makeViewerGate(req.user.id, [workspace]);
    const actors = await User.find({ _id: { $in: grouped.map((g) => g._id) } }).select('name email privacy').lean();
    const actorById = new Map(actors.map((u) => [String(u._id), u]));

    const activityMembers = [];
    let hidden = { members: 0, events: 0 };
    for (const g of grouped) {
      const u = actorById.get(String(g._id));
      if (u && canSee(u._id, readPrivacy(u).contributionVisibility)) {
        activityMembers.push({
          user: { _id: u._id, name: u.name, email: u.email },
          events: g.events,
          completed: g.completed,
          collaboration: g.collaboration,
          planning: g.planning,
        });
      } else {
        hidden = { members: hidden.members + 1, events: hidden.events + g.events };
      }
    }

    res.json({
      success: true,
      project: { _id: project._id, name: project.name, deadline: project.deadline || null },
      health: core.health,
      totals: {
        tasks: tasks.length,
        completed: core.done.length,
        open: core.open.length,
        overdue: core.overdue.length,
        atRisk: core.risk.filter((r) => !r.overdue).length,
        completionRate: tasks.length ? round(core.done.length / tasks.length, 3) : 0,
        estimatedHours: round(tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0)),
        loggedHours: round(tasks.reduce((s, t) => s + (t.actualHours || 0), 0)),
        byStatus: countBy(tasks, 'status'),
        byPriority: countBy(tasks, 'priority'),
      },
      velocity,
      forecast: core.forecast,
      averageCompletionTime: averageCompletion(tasks),
      burn: { unit, days: burn.length, series: burn },
      workload: workloadRows,
      deadlineRisk: core.risk.slice(0, 20),
      teamActivity: { days: 7, members: activityMembers, others: hidden },
    });
  } catch (error) {
    serverError(res, 'Failed to build analytics', error);
  }
}

// GET /workspaces/:workspaceId/analytics - one health row per active project
async function getWorkspaceAnalytics(req, res) {
  try {
    const role = await getWorkspaceRole(req.params.workspaceId, req.user.id);
    if (!role) return fail(res, 404, 'Workspace not found');

    const now = new Date();
    const projects = await Project.find({ workspace: req.params.workspaceId, isArchived: false })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    const tasks = await Task.find(taskScope({ project: { $in: projects.map((p) => p._id) } }))
      .select(TASK_FIELDS)
      .lean();

    const byProject = new Map();
    for (const t of tasks) {
      const key = String(t.project);
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(t);
    }

    const rows = projects.map((p) => {
      const list = byProject.get(String(p._id)) || [];
      const core = coreMetrics(p, list, now);
      return {
        _id: p._id,
        name: p.name,
        deadline: p.deadline || null,
        health: core.health,
        totals: {
          tasks: list.length,
          completed: core.done.length,
          open: core.open.length,
          overdue: core.overdue.length,
          atRisk: core.risk.filter((r) => !r.overdue).length,
        },
        tasksPerWeek: core.forecast.tasksPerWeek,
        projectedFinish: core.forecast.projectedFinish,
      };
    });

    const sum = (field) => rows.reduce((s, r) => s + r.totals[field], 0);
    const healthCounts = {};
    rows.forEach((r) => {
      healthCounts[r.health.status] = (healthCounts[r.health.status] || 0) + 1;
    });

    res.json({
      success: true,
      totals: { projects: rows.length, tasks: sum('tasks'), completed: sum('completed'), open: sum('open'), overdue: sum('overdue'), atRisk: sum('atRisk') },
      healthCounts,
      projects: rows,
    });
  } catch (error) {
    serverError(res, 'Failed to build workspace analytics', error);
  }
}

module.exports = { getProjectAnalytics, getWorkspaceAnalytics };