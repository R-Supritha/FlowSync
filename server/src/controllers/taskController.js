const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const {
  isManagerRole,
  canWrite,
  getWorkspaceRole,
  isWorkspaceMember,
  parseDate,
  serverError,
} = require('../utils/access');
const { wouldCreateCycle } = require('../utils/taskDependencies');
const { notify } = require('../utils/notify');

const PRIORITIES = ['Low', 'Medium', 'High'];
const DONE_STATUS = 'Done';

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

async function loadProjectForUser(projectId, userId, res) {
  const project = await Project.findById(projectId);
  if (!project) return fail(res, 404, 'Project not found');
  const role = await getWorkspaceRole(project.workspace, userId);
  if (!role) return fail(res, 404, 'Project not found');
  return { project, role };
}

// Loads a task, its project and the caller's workspace role.
async function loadTask(req, res) {
  const task = await Task.findById(req.params.id);
  if (!task) return fail(res, 404, 'Task not found');
  const project = await Project.findById(task.project);
  const role = project && (await getWorkspaceRole(project.workspace, req.user.id));
  if (!role) return fail(res, 404, 'Task not found');
  return { task, project, role };
}

// Admin/Manager can modify any task; a Member only tasks they reported or are assigned to.
function canModifyTask(role, task, userId) {
  if (isManagerRole(role)) return true;
  if (role !== 'Member') return false;
  const uid = String(userId);
  return String(task.reporter) === uid || (task.assignee && String(task.assignee) === uid);
}

function denyModify(res) {
  return fail(res, 403, 'You do not have permission to modify this task');
}

// Validates and normalises the editable task fields. Returns { data } or { error }.
// Only fields present in `body` appear in `data`, so it works for create and partial update.
async function validateTaskFields(body, project) {
  const data = {};

  if (body.title !== undefined) {
    if (!String(body.title).trim()) return { error: 'Task title cannot be empty' };
    data.title = body.title;
  }
  if (body.description !== undefined) data.description = body.description;

  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) {
      return { error: `Priority must be one of: ${PRIORITIES.join(', ')}` };
    }
    data.priority = body.priority;
  }

  if (body.status !== undefined) {
    if (!project.columns.includes(body.status)) {
      return { error: `Status must be one of: ${project.columns.join(', ')}` };
    }
    data.status = body.status;
  }

  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels) || body.labels.some((l) => typeof l !== 'string')) {
      return { error: 'labels must be an array of strings' };
    }
    data.labels = [...new Set(body.labels.map((l) => l.trim()).filter(Boolean))];
  }

  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) return { error: 'attachments must be an array' };
    data.attachments = body.attachments.map((a) => ({ name: a && a.name, url: a && a.url }));
  }

  for (const field of ['estimatedHours', 'actualHours']) {
    if (body[field] !== undefined) {
      const n = Number(body[field]);
      if (!Number.isFinite(n) || n < 0) return { error: `${field} must be a non-negative number` };
      data[field] = n;
    }
  }

  const deadline = parseDate(body.deadline);
  if (deadline === 'invalid') return { error: 'Invalid deadline' };
  if (deadline !== undefined) data.deadline = deadline || undefined;

  if (body.checklist !== undefined) {
    if (!Array.isArray(body.checklist) || body.checklist.some((c) => !c || !String(c.text || '').trim())) {
      return { error: 'Each checklist item needs a text' };
    }
    data.checklist = body.checklist.map((c) => ({ text: c.text, done: Boolean(c.done) }));
  }

  if (body.subtasks !== undefined) {
    if (!Array.isArray(body.subtasks) || body.subtasks.some((s) => !s || !String(s.title || '').trim())) {
      return { error: 'Each subtask needs a title' };
    }
    data.subtasks = body.subtasks.map((s) => ({ title: s.title, done: Boolean(s.done) }));
  }

  if (body.milestone !== undefined) {
    if (body.milestone === null || body.milestone === '') {
      data.milestone = undefined;
    } else if (!project.milestones.id(body.milestone)) {
      return { error: 'Milestone does not belong to this project' };
    } else {
      data.milestone = body.milestone;
    }
  }

  if (body.assignee !== undefined) {
    if (body.assignee === null || body.assignee === '') {
      data.assignee = undefined;
    } else if (
      !mongoose.isValidObjectId(body.assignee) ||
      !(await isWorkspaceMember(project.workspace, body.assignee))
    ) {
      return { error: 'Assignee must be a member of the workspace' };
    } else {
      data.assignee = body.assignee;
    }
  }

  return { data };
}

// Checks ids exist in the same project. Returns unique id strings or { error }.
async function validateDependencies(dependencies, project, taskId) {
  if (!Array.isArray(dependencies)) return { error: 'dependencies must be an array of task ids' };
  if (dependencies.some((d) => !mongoose.isValidObjectId(d))) {
    return { error: 'dependencies must contain valid task ids' };
  }
  const ids = [...new Set(dependencies.map(String))];
  if (taskId && ids.includes(String(taskId))) return { error: 'A task cannot depend on itself' };

  const found = await Task.countDocuments({ _id: { $in: ids }, project: project._id });
  if (found !== ids.length) return { error: 'All dependencies must be existing tasks in the same project' };

  if (taskId) {
    const getDeps = async (id) => {
      const t = await Task.findById(id).select('dependencies');
      return t ? t.dependencies : [];
    };
    if (await wouldCreateCycle(taskId, ids, getDeps)) {
      return { error: 'These dependencies would create a circular dependency' };
    }
  }
  return { ids };
}

async function nextPosition(projectId, status) {
  const last = await Task.findOne({ project: projectId, status }).sort({ position: -1 }).select('position');
  return last ? last.position + 1 : 0;
}

function applyCompletion(task) {
  if (task.status === DONE_STATUS) {
    if (!task.completedAt) task.completedAt = new Date();
  } else {
    task.completedAt = undefined;
  }
}

// ---------- Handlers ----------

async function createTask(req, res) {
  try {
    const loaded = await loadProjectForUser(req.params.projectId, req.user.id, res);
    if (!loaded) return;
    const { project, role } = loaded;

    if (!canWrite(role)) return fail(res, 403, 'Viewers have read-only access');
    if (project.isArchived) return fail(res, 400, 'Cannot add tasks to an archived project');
    if (!req.body.title || !String(req.body.title).trim()) {
      return fail(res, 400, 'Task title is required');
    }

    const { data, error } = await validateTaskFields(req.body, project);
    if (error) return fail(res, 400, error);

    if (req.body.dependencies !== undefined) {
      const deps = await validateDependencies(req.body.dependencies, project, null);
      if (deps.error) return fail(res, 400, deps.error);
      data.dependencies = deps.ids;
    }

    const status = data.status || (project.columns.includes('Backlog') ? 'Backlog' : project.columns[0]);
    const task = new Task({
      ...data,
      status,
      project: project._id,
      workspace: project.workspace,
      reporter: req.user.id,
      position: await nextPosition(project._id, status),
    });
    applyCompletion(task);
    await task.save();

    if (task.assignee) {
      await notify({
        user: task.assignee,
        actor: req.user.id,
        type: 'task_assigned',
        message: `You were assigned to "${task.title}"`,
        link: { workspace: project.workspace, project: project._id, task: task._id },
      });
    }

    res.status(201).json({ success: true, task });
  } catch (error) {
    serverError(res, 'Failed to create task', error);
  }
}

async function getProjectTasks(req, res) {
  try {
    const loaded = await loadProjectForUser(req.params.projectId, req.user.id, res);
    if (!loaded) return;
    const { project } = loaded;

    const { status, priority, assignee, label, search } = req.query;
    const filter = { project: project._id, isArchived: req.query.archived === 'true' };

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (label) filter.labels = label;
    if (assignee) {
      if (assignee !== 'unassigned' && !mongoose.isValidObjectId(assignee)) {
        return fail(res, 400, 'Invalid assignee');
      }
      filter.assignee = assignee === 'unassigned' ? null : assignee;
    }
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { description: rx }];
    }
    if (req.query.dueBefore || req.query.dueAfter) {
      const before = parseDate(req.query.dueBefore);
      const after = parseDate(req.query.dueAfter);
      if (before === 'invalid' || after === 'invalid') return fail(res, 400, 'Invalid due date filter');
      filter.deadline = {};
      if (before) filter.deadline.$lte = before;
      if (after) filter.deadline.$gte = after;
    }

    // Pagination keeps large boards responsive (NFR: performance).
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('assignee', 'name email')
        .populate('reporter', 'name email')
        .sort({ position: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Task.countDocuments(filter),
    ]);

    res.json({ success: true, tasks, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    serverError(res, 'Failed to fetch tasks', error);
  }
}

async function getTask(req, res) {
  try {
    const loaded = await loadTask(req, res);
    if (!loaded) return;
    const { task } = loaded;

    await task.populate([
      { path: 'assignee', select: 'name email' },
      { path: 'reporter', select: 'name email' },
      { path: 'dependencies', select: 'title status' },
    ]);
    // Tasks that are waiting on this one.
    const blocks = await Task.find({ dependencies: task._id }).select('title status');

    res.json({ success: true, task, blocks });
  } catch (error) {
    serverError(res, 'Failed to fetch task', error);
  }
}

async function updateTask(req, res) {
  try {
    const loaded = await loadTask(req, res);
    if (!loaded) return;
    const { task, project, role } = loaded;

    if (!canModifyTask(role, task, req.user.id)) return denyModify(res);
    if (project.isArchived) return fail(res, 400, 'Cannot edit tasks in an archived project');

    const { data, error } = await validateTaskFields(req.body, project);
    if (error) return fail(res, 400, error);

    if (req.body.dependencies !== undefined) {
      const deps = await validateDependencies(req.body.dependencies, project, task._id);
      if (deps.error) return fail(res, 400, deps.error);
      data.dependencies = deps.ids;
    }

    const statusChanged = data.status && data.status !== task.status;
    task.set(data);
    if (statusChanged) {
      task.position = await nextPosition(project._id, task.status);
      applyCompletion(task);
    }
    await task.save();

    res.json({ success: true, task });
  } catch (error) {
    serverError(res, 'Failed to update task', error);
  }
}

async function deleteTask(req, res) {
  try {
    const loaded = await loadTask(req, res);
    if (!loaded) return;
    const { task, role } = loaded;

    const isReporter = String(task.reporter) === String(req.user.id);
    if (!isManagerRole(role) && !(role === 'Member' && isReporter)) {
      return fail(res, 403, 'Only Admin, Manager, or the task reporter can delete a task');
    }

    await task.deleteOne();
    // Anything that was blocked by this task is no longer blocked.
    await Task.updateMany({ dependencies: task._id }, { $pull: { dependencies: task._id } });

    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    serverError(res, 'Failed to delete task', error);
  }
}

async function assignTask(req, res) {
  try {
    const loaded = await loadTask(req, res);
    if (!loaded) return;
    const { task, project, role } = loaded;

    if (!canModifyTask(role, task, req.user.id)) return denyModify(res);
    if (req.body.assignee === undefined) return fail(res, 400, 'assignee is required (use null to unassign)');

    const { data, error } = await validateTaskFields({ assignee: req.body.assignee }, project);
    if (error) return fail(res, 400, error);

    task.assignee = data.assignee;
    await task.save();
    await task.populate('assignee', 'name email');

    if (data.assignee) {
      await notify({
        user: data.assignee,
        actor: req.user.id,
        type: 'task_assigned',
        message: `You were assigned to "${task.title}"`,
        link: { workspace: project.workspace, project: project._id, task: task._id },
      });
    }

    res.json({ success: true, task });
  } catch (error) {
    serverError(res, 'Failed to assign task', error);
  }
}

// Moves a task between Kanban columns (any non-Viewer may move cards on the board).
async function updateTaskStatus(req, res) {
  try {
    const loaded = await loadTask(req, res);
    if (!loaded) return;
    const { task, project, role } = loaded;

    if (!canWrite(role)) return fail(res, 403, 'Viewers have read-only access');
    if (project.isArchived) return fail(res, 400, 'Cannot move tasks in an archived project');

    const { status, position } = req.body;
    if (!project.columns.includes(status)) {
      return fail(res, 400, `Status must be one of: ${project.columns.join(', ')}`);
    }

    const previousStatus = task.status;
    task.status = status;
    if (position !== undefined) {
      const p = Number(position);
      if (!Number.isFinite(p) || p < 0) return fail(res, 400, 'position must be a non-negative number');
      task.position = p;
    } else if (status !== previousStatus) {
      task.position = await nextPosition(project._id, status);
    }
    applyCompletion(task);
    await task.save();

    res.json({ success: true, task, previousStatus });
  } catch (error) {
    serverError(res, 'Failed to update task status', error);
  }
}

function setTaskArchived(value) {
  return async function (req, res) {
    try {
      const loaded = await loadTask(req, res);
      if (!loaded) return;
      const { task, role } = loaded;

      if (!canModifyTask(role, task, req.user.id)) return denyModify(res);

      task.isArchived = value;
      await task.save();

      res.json({ success: true, task });
    } catch (error) {
      serverError(res, `Failed to ${value ? 'archive' : 'restore'} task`, error);
    }
  };
}

module.exports = {
  createTask,
  getProjectTasks,
  getTask,
  updateTask,
  deleteTask,
  assignTask,
  updateTaskStatus,
  archiveTask: setTaskArchived(true),
  unarchiveTask: setTaskArchived(false),
};
