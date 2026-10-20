const Project = require('../models/Project');
const Task = require('../models/Task');
const { DEFAULT_COLUMNS } = require('../config/projectTemplates');
const { isManagerRole, getWorkspaceRole, serverError } = require('../utils/access');
const { logActivity } = require('../utils/activity');
const {
  generateProjectPlan,
  sanitizePlan,
  AiUnavailableError,
  AiInvalidResponseError,
  MAX_REQUIREMENTS_CHARS,
} = require('../services/aiService');

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// POST /api/ai/generate-plan  { requirements }
// Turns free-form requirements into a validated, structured plan (nothing is saved).
async function generatePlan(req, res) {
  try {
    const requirements = req.body && req.body.requirements;
    if (!requirements || !String(requirements).trim()) {
      return fail(res, 400, 'Requirements text is required');
    }
    if (String(requirements).length > MAX_REQUIREMENTS_CHARS) {
      return fail(res, 400, `Requirements are too long (max ${MAX_REQUIREMENTS_CHARS} characters)`);
    }

    try {
      const { plan, warnings } = await generateProjectPlan(requirements);
      res.json({ success: true, plan, warnings });
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        return res.status(503).json({ success: false, message: error.message, aiUnavailable: true });
      }
      if (error instanceof AiInvalidResponseError) {
        return fail(res, 422, error.message);
      }
      throw error;
    }
  } catch (error) {
    serverError(res, 'Failed to generate a project plan', error);
  }
}

// Creates every task for the plan; dependencies are wired in a second pass so
// "dependsOn" can reference any task. Returns the created task documents.
async function createPlanTasks(project, plan, userId) {
  const status = project.columns.includes('Backlog') ? 'Backlog' : project.columns[0];
  const created = [];

  for (let i = 0; i < plan.tasks.length; i += 1) {
    const t = plan.tasks[i];
    const task = new Task({
      project: project._id,
      workspace: project.workspace,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status,
      position: i,
      labels: t.labels,
      reporter: userId,
      estimatedHours: t.estimatedHours,
      subtasks: t.subtasks.map((title) => ({ title, done: false })),
      // Acceptance criteria ride the existing checklist field.
      checklist: t.acceptanceCriteria.map((text) => ({ text, done: false })),
      milestone: t.milestoneIndex !== null && project.milestones[t.milestoneIndex]
        ? project.milestones[t.milestoneIndex]._id
        : undefined,
    });
    await task.save();
    created.push(task);
  }

  for (let i = 0; i < plan.tasks.length; i += 1) {
    const deps = plan.tasks[i].dependsOn.map((di) => created[di]._id).filter(Boolean);
    if (deps.length) {
      created[i].dependencies = deps;
      await created[i].save();
    }
  }

  return created;
}

// POST /api/workspaces/:workspaceId/projects/generate
// Persists a confirmed (possibly user-edited) plan as a real project + tasks.
async function createProjectFromPlan(req, res) {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(workspaceId, req.user.id);
    if (!role) return fail(res, 404, 'Workspace not found');
    if (!isManagerRole(role)) {
      return fail(res, 403, 'Only Admin or Manager can create projects');
    }

    const body = req.body || {};
    const generationKey =
      typeof body.generationKey === 'string' && body.generationKey.trim()
        ? body.generationKey.trim().slice(0, 100)
        : null;
    if (!generationKey) {
      return fail(res, 400, 'generationKey is required to prevent duplicate project creation');
    }

    // Retried request? Return the project that this key already created.
    const existing = await Project.findOne({ generationKey, workspace: workspaceId });
    if (existing) {
      const tasks = await Task.find({ project: existing._id }).sort({ position: 1 });
      return res.json({ success: true, project: existing, tasks, duplicate: true });
    }

    let plan;
    try {
      ({ plan } = sanitizePlan(body.plan));
    } catch (error) {
      if (error instanceof AiInvalidResponseError) return fail(res, 400, error.message);
      throw error;
    }

    const start = new Date();
    const labels = [...new Set(plan.tasks.flatMap((t) => t.labels))].slice(0, 20);

    let project;
    let tasks;
    try {
      project = await Project.create({
        workspace: workspaceId,
        name: plan.name,
        description: plan.description,
        startDate: start,
        template: 'ai-generated',
        columns: DEFAULT_COLUMNS,
        labels,
        milestones: plan.milestones.map((m) => ({
          title: m.title,
          description: m.description,
          targetDate: new Date(start.getTime() + m.offsetDays * DAY_MS),
        })),
        createdBy: req.user.id,
        generationKey,
      });

      tasks = await createPlanTasks(project, plan, req.user.id);
    } catch (error) {
      // Roll back anything that was created so a failure never leaves a half-built project.
      if (project && project._id) {
        await Task.deleteMany({ project: project._id }).catch(() => {});
        await project.deleteOne().catch(() => {});
      }
      // Two racing requests with the same key: unique index fires; return the winner's project.
      if (error && error.code === 11000) {
        const winner = await Project.findOne({ generationKey, workspace: workspaceId });
        if (winner) {
          const winnerTasks = await Task.find({ project: winner._id }).sort({ position: 1 });
          return res.json({ success: true, project: winner, tasks: winnerTasks, duplicate: true });
        }
      }
      throw error;
    }

    await logActivity({
      workspace: project.workspace,
      project: project._id,
      actor: req.user.id,
      type: 'task_created',
      message: `created project "${project.name}" with ${tasks.length} AI-planned tasks`,
    });

    res.status(201).json({ success: true, project, tasks });
  } catch (error) {
    serverError(res, 'Failed to create the project from the plan', error);
  }
}

module.exports = { generatePlan, createProjectFromPlan };
