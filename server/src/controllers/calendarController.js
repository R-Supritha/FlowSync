const Project = require('../models/Project');
const Task = require('../models/Task');
const Workspace = require('../models/Workspace');
const { getWorkspaceRole, serverError } = require('../utils/access');
const { rangeFor } = require('../utils/dateRange');

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

function milestonesInRange(project, start, end) {
  return project.milestones
    .filter((m) => m.targetDate >= start && m.targetDate < end)
    .map((m) => ({
      _id: m._id,
      type: 'milestone',
      title: m.title,
      date: m.targetDate,
      completed: m.completed,
      project: project._id,
      projectName: project.name,
    }));
}

function tasksToEvents(tasks, projectNameById) {
  return tasks.map((t) => ({
    _id: t._id,
    type: 'task',
    title: t.title,
    date: t.deadline,
    priority: t.priority,
    status: t.status,
    project: t.project,
    projectName: projectNameById.get(String(t.project)),
  }));
}

// GET /projects/:projectId/calendar?view=week|month&date=YYYY-MM-DD
async function getProjectCalendar(req, res) {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return fail(res, 404, 'Project not found');
    const role = await getWorkspaceRole(project.workspace, req.user.id);
    if (!role) return fail(res, 404, 'Project not found');

    const range = rangeFor(req.query.view, req.query.date);
    if (!range) return fail(res, 400, 'Invalid date');
    const { start, end } = range;

    const tasks = await Task.find({
      project: project._id,
      isArchived: false,
      deadline: { $gte: start, $lt: end },
    }).select('title deadline priority status project');

    const events = [
      ...tasksToEvents(tasks, new Map([[String(project._id), project.name]])),
      ...milestonesInRange(project, start, end),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ success: true, view: req.query.view === 'month' ? 'month' : 'week', range: { start, end }, events });
  } catch (error) {
    serverError(res, 'Failed to fetch calendar', error);
  }
}

// GET /workspaces/:workspaceId/calendar?view=week|month&date=YYYY-MM-DD
// Aggregates deadlines and milestones across every active project in the workspace.
async function getWorkspaceCalendar(req, res) {
  try {
    const role = await getWorkspaceRole(req.params.workspaceId, req.user.id);
    if (!role) return fail(res, 404, 'Workspace not found');

    const range = rangeFor(req.query.view, req.query.date);
    if (!range) return fail(res, 400, 'Invalid date');
    const { start, end } = range;

    const projects = await Project.find({ workspace: req.params.workspaceId, isArchived: false });
    const projectIds = projects.map((p) => p._id);
    const nameById = new Map(projects.map((p) => [String(p._id), p.name]));

    const tasks = await Task.find({
      project: { $in: projectIds },
      isArchived: false,
      deadline: { $gte: start, $lt: end },
    }).select('title deadline priority status project');

    const events = [
      ...tasksToEvents(tasks, nameById),
      ...projects.flatMap((p) => milestonesInRange(p, start, end)),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ success: true, view: req.query.view === 'month' ? 'month' : 'week', range: { start, end }, events });
  } catch (error) {
    serverError(res, 'Failed to fetch calendar', error);
  }
}

module.exports = { getProjectCalendar, getWorkspaceCalendar };
