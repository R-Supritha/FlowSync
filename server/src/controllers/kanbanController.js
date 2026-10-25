const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const { canWrite, isManagerRole, getWorkspaceRole, serverError } = require('../utils/access');

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

// GET /projects/:projectId/board - every column, with its tasks in position order.
// Supports the same filters as the task list (assignee, priority, label, search) so the
// board can be narrowed without losing empty columns.
async function getBoard(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project } = loaded;

    const filter = { project: project._id, isArchived: false };
    const { priority, assignee, label, search } = req.query;
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

    const tasks = await Task.find(filter)
      .populate('assignee', 'name email')
      .sort({ position: 1, createdAt: 1 });

    const tasksByColumn = {};
    for (const column of project.columns) tasksByColumn[column] = [];
    for (const task of tasks) {
      if (!tasksByColumn[task.status]) tasksByColumn[task.status] = []; // defensive: stale status
      tasksByColumn[task.status].push(task);
    }

    res.json({ success: true, columns: project.columns, tasksByColumn });
  } catch (error) {
    serverError(res, 'Failed to fetch board', error);
  }
}

// PUT /projects/:projectId/columns - replace the column list (add/reorder/remove, and
// rename for any empty column). A column name that disappears from the new list is
// blocked if tasks still sit in it, since the API can't tell a rename from a removal -
// move those tasks to another column first, then rename.
async function updateColumns(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;

    if (!isManagerRole(role)) return fail(res, 403, 'Only Admin or Manager can manage board columns');

    const { columns } = req.body;
    if (!Array.isArray(columns) || columns.some((c) => typeof c !== 'string' || !c.trim())) {
      return fail(res, 400, 'columns must be a non-empty array of column names');
    }
    const clean = columns.map((c) => c.trim());
    if (new Set(clean).size !== clean.length) return fail(res, 400, 'Column names must be unique');
    if (clean.length === 0) return fail(res, 400, 'A board needs at least one column');

    const removed = project.columns.filter((c) => !clean.includes(c));
    if (removed.length) {
      const stillUsed = await Task.countDocuments({ project: project._id, status: { $in: removed } });
      if (stillUsed > 0) {
        return fail(
          res,
          400,
          `Cannot remove column(s) [${removed.join(', ')}] - ${stillUsed} task(s) still use them. Move those tasks first.`
        );
      }
    }

    project.columns = clean;
    await project.save();

    res.json({ success: true, project });
  } catch (error) {
    serverError(res, 'Failed to update columns', error);
  }
}

// PATCH /projects/:projectId/board/reorder - set the card order within one column after a drag-drop.
async function reorderColumn(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;

    if (!canWrite(role)) return fail(res, 403, 'Viewers have read-only access');

    const { status, orderedTaskIds } = req.body;
    if (!project.columns.includes(status)) {
      return fail(res, 400, `status must be one of: ${project.columns.join(', ')}`);
    }
    if (!Array.isArray(orderedTaskIds) || orderedTaskIds.some((id) => !mongoose.isValidObjectId(id))) {
      return fail(res, 400, 'orderedTaskIds must be an array of task ids');
    }

    // Archived tasks are hidden from the board, so they must not count here (otherwise a column that
    // holds an archived task could never be reordered).
    const existing = await Task.find({ project: project._id, status, isArchived: false }).select('_id');
    const existingIds = new Set(existing.map((t) => String(t._id)));
    const givenIds = new Set(orderedTaskIds.map(String));
    if (existingIds.size !== givenIds.size || [...existingIds].some((id) => !givenIds.has(id))) {
      return fail(res, 400, 'orderedTaskIds must include exactly the tasks currently in this column');
    }

    await Promise.all(
      orderedTaskIds.map((id, index) => Task.updateOne({ _id: id }, { position: index }))
    );

    const tasks = await Task.find({ project: project._id, status, isArchived: false }).sort({ position: 1 });
    res.json({ success: true, status, tasks });
  } catch (error) {
    serverError(res, 'Failed to reorder column', error);
  }
}

module.exports = { getBoard, updateColumns, reorderColumn };
