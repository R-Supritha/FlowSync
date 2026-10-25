// FR23 (stand-up report), FR24 (sprint planning) and FR25 (task breakdown).
const { postBotMessage } = require('../utils/chatBot');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Workspace = require('../models/Workspace');
const ActivityLog = require('../models/ActivityLog');
const { isManagerRole, canWrite, getWorkspaceRole, serverError } = require('../utils/access');
const { logTaskStatusChange } = require('../utils/activity');
const { AiUnavailableError, AiInvalidResponseError } = require('../services/aiService');
const { breakdownTask } = require('../services/breakdownService');
const { buildStandupFacts, generateStandupReport, WINDOWS, DEFAULT_WINDOW } = require('../services/standupService');
const { planSprint, parseSprintSettings, sprintNarrative } = require('../services/sprintService');

const MAX_APPLY = 50;
const SPRINT_COLUMN = 'To Do';

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

// AI problems are answered with 503 (unavailable) or 422 (unusable reply); anything else is a 500.
function aiProblem(res, error, fallbackMessage) {
  if (error instanceof AiUnavailableError) {
    return res.status(503).json({ success: false, message: error.message, aiUnavailable: true });
  }
  if (error instanceof AiInvalidResponseError) return fail(res, 422, error.message);
  return serverError(res, fallbackMessage, error);
}

async function loadProject(req, res) {
  const project = await Project.findById(req.params.projectId);
  if (!project) return fail(res, 404, 'Project not found');
  const role = await getWorkspaceRole(project.workspace, req.user.id);
  if (!role) return fail(res, 404, 'Project not found');
  return { project, role };
}

// Admin/Manager can change any task; a Member only tasks they reported or are assigned to.
function canModifyTask(role, task, userId) {
  if (isManagerRole(role)) return true;
  if (role !== 'Member') return false;
  const uid = String(userId);
  return String(task.reporter) === uid || (task.assignee && String(task.assignee) === uid);
}

// ---------------------------------------------------------------- FR25
// POST /api/tasks/:id/ai/breakdown   body: { hint? }
// Suggests subtasks. Nothing is saved: the client adds the chosen ones with the normal task update.
async function breakdown(req, res) {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return fail(res, 404, 'Task not found');
    const project = await Project.findById(task.project);
    const role = project && (await getWorkspaceRole(project.workspace, req.user.id));
    if (!role) return fail(res, 404, 'Task not found');
    if (!canModifyTask(role, task, req.user.id)) return fail(res, 403, 'You do not have permission to change this task');
    if (project.isArchived || task.isArchived) return fail(res, 400, 'Archived items cannot be changed');

    const hint = req.body && typeof req.body.hint === 'string' ? req.body.hint : '';
    const { subtasks } = await breakdownTask({ project, task, hint });
    return res.json({ success: true, subtasks, existingCount: (task.subtasks || []).length });
  } catch (error) {
    return aiProblem(res, error, 'Failed to break down the task');
  }
}

// ---------------------------------------------------------------- FR23
// POST /api/projects/:projectId/ai/standup   body: { windowHours?: 24|48|72|168, useAi?: boolean }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function standup(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project } = loaded;

    const body = req.body || {};
    const windowHours = body.windowHours === undefined ? DEFAULT_WINDOW : Number(body.windowHours);
    if (!WINDOWS.includes(windowHours)) return fail(res, 400, `windowHours must be one of ${WINDOWS.join(', ')}`);
    const useAi = body.useAi !== false;

    const now = new Date();
    const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
    const [activities, tasks] = await Promise.all([
      ActivityLog.find({ project: project._id, createdAt: { $gte: since } })
        .populate('actor', 'name')
        .sort({ createdAt: -1 })
        .limit(500)
        .lean(),
      Task.find({ project: project._id, isArchived: false })
        .select('title status deadline assignee dependencies')
        .populate('assignee', 'name')
        .lean(),
    ]);

    const facts = buildStandupFacts({ activities, tasks, now, windowHours });
    const report = await generateStandupReport({ facts, useAi });

    // FR30: when there is something to report, say in the project's chat that the stand-up is ready
    // (at most once every 6 hours, however often the page is opened)
    const sum = (key) => facts.people.reduce((n, p) => n + (p.counts[key] || 0), 0);
    const blockers = facts.people.reduce((n, p) => n + p.blockers.length, 0) + facts.team.unassignedBlockers.length;
    if (facts.people.length || blockers) {
      postBotMessage({
        workspace: project.workspace,
        project: project._id,
        actor: req.user.id,
        kind: 'standup',
        dedupeHours: 6,
        text: `📋 Stand-up ready for the last ${windowHours} hours: ${plural(facts.team.tasksCompleted, 'task')} completed, ${plural(sum('commits'), 'commit')}, ${plural(blockers, 'blocker')}. Open the Stand-up page for the full report.`,
      });
    }
    return res.json({ success: true, report });
  } catch (error) {
    return serverError(res, 'Failed to build the stand-up report', error);
  }
}

// ---------------------------------------------------------------- FR24
// POST /api/projects/:projectId/ai/sprint-plan
//   body: { sprintDays?, people?, hoursPerPerson?, capacityHours?, useAi? }
async function sprintPlan(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!canWrite(role)) return fail(res, 403, 'Viewers have read-only access');
    if (project.isArchived) return fail(res, 400, 'Archived projects cannot be planned');

    const workspace = await Workspace.findById(project.workspace).select('members').lean();
    const defaultPeople = ((workspace && workspace.members) || []).filter((m) => m.role !== 'Viewer').length;
    const parsed = parseSprintSettings(req.body || {}, defaultPeople);
    if (parsed.error) return fail(res, 400, parsed.error);
    const settings = parsed.value;

    const tasks = await Task.find({ project: project._id, isArchived: false })
      .select('title status priority estimatedHours deadline position dependencies')
      .lean();
    const plan = planSprint({ tasks, capacityHours: settings.capacityHours, sprintDays: settings.sprintDays });

    const wantsAi = !req.body || req.body.useAi !== false;
    const ai = wantsAi && plan.sprint.tasks.length
      ? await sprintNarrative({ plan, projectName: project.name })
      : { used: false, requested: wantsAi };

    return res.json({ success: true, settings, ...plan, ai });
  } catch (error) {
    return serverError(res, 'Failed to plan the sprint', error);
  }
}

// POST /api/projects/:projectId/sprint/apply   body: { taskIds: [...] }
// "Start the sprint": moves the chosen Backlog tasks to the To Do column. Admin or Manager only.
async function applySprint(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!isManagerRole(role)) return fail(res, 403, 'Only Admin or Manager can start a sprint');
    if (project.isArchived) return fail(res, 400, 'Archived projects cannot be changed');

    const ids = req.body && req.body.taskIds;
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'taskIds must be a non-empty list');
    if (ids.length > MAX_APPLY) return fail(res, 400, `You can start at most ${MAX_APPLY} tasks at once`);
    if (ids.some((id) => !mongoose.isValidObjectId(id))) return fail(res, 400, 'taskIds contains an invalid id');
    if (!project.columns.includes(SPRINT_COLUMN)) {
      return fail(res, 400, `This project has no "${SPRINT_COLUMN}" column. Add one in the board column settings first.`);
    }

    const found = await Task.find({ _id: { $in: ids }, project: project._id });
    const byId = new Map(found.map((t) => [String(t._id), t]));
    const last = await Task.find({ project: project._id, status: SPRINT_COLUMN, isArchived: false }).sort({ position: -1 }).limit(1).lean();
    let position = last.length ? (last[0].position || 0) + 1 : 0;

    const moved = [];
    const skipped = [];
    for (const id of [...new Set(ids.map(String))]) {
      const task = byId.get(id);
      if (!task) { skipped.push({ _id: id, reason: 'Not found in this project' }); continue; }
      if (task.isArchived) { skipped.push({ _id: id, title: task.title, reason: 'The task is archived' }); continue; }
      if (task.status !== 'Backlog') { skipped.push({ _id: id, title: task.title, reason: `Already in ${task.status}` }); continue; }
      const previousStatus = task.status;
      task.status = SPRINT_COLUMN;
      task.position = position;
      position += 1;
      await task.save();
      await logTaskStatusChange({ task, project, actor: req.user.id, previousStatus });
      moved.push({ _id: String(task._id), title: task.title });
    }
    // FR30: announce the sprint in the project's chat (never throws, not waited for)
    if (moved.length) {
      const shown = moved.slice(0, 5).map((t) => `"${t.title}"`).join(', ');
      const more = moved.length > 5 ? ` and ${moved.length - 5} more` : '';
      postBotMessage({
        workspace: project.workspace,
        project: project._id,
        actor: req.user.id,
        kind: 'sprint',
        text: `🚀 Sprint started: ${moved.length} task${moved.length === 1 ? '' : 's'} moved to ${SPRINT_COLUMN}: ${shown}${more}`,
      });
    }
    return res.json({ success: true, target: SPRINT_COLUMN, moved, skipped });
  } catch (error) {
    return serverError(res, 'Failed to start the sprint', error);
  }
}

module.exports = { breakdown, standup, sprintPlan, applySprint };
