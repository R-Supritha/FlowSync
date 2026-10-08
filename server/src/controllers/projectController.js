const Project = require('../models/Project');
const Task = require('../models/Task');
const { templates } = require('../config/projectTemplates');
const { isManagerRole, getWorkspaceRole, parseDate, serverError } = require('../utils/access');

const DAY_MS = 24 * 60 * 60 * 1000;

// Loads a project and the caller's role in its workspace.
// Sends the error response itself and returns null if access is not possible.
async function loadProject(req, res) {
  const project = await Project.findById(req.params.id);
  if (!project) {
    res.status(404).json({ success: false, message: 'Project not found' });
    return null;
  }
  const role = await getWorkspaceRole(project.workspace, req.user.id);
  if (!role) {
    res.status(404).json({ success: false, message: 'Project not found' });
    return null;
  }
  return { project, role };
}

function requireManager(role, res, action) {
  if (isManagerRole(role)) return true;
  res.status(403).json({ success: false, message: `Only Admin or Manager can ${action}` });
  return false;
}

async function listTemplates(req, res) {
  const list = Object.entries(templates).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    columns: t.columns,
    labels: t.labels,
    milestones: t.milestones,
  }));
  res.json({ success: true, templates: list });
}

async function createProject(req, res) {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(workspaceId, req.user.id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    if (!requireManager(role, res, 'create projects')) return;

    const { name, description, template } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }

    const templateId = template || 'blank';
    const tpl = templates[templateId];
    if (!tpl) {
      return res.status(400).json({
        success: false,
        message: `Unknown template. Available: ${Object.keys(templates).join(', ')}`,
      });
    }

    const startDate = parseDate(req.body.startDate);
    const deadline = parseDate(req.body.deadline);
    if (startDate === 'invalid' || deadline === 'invalid') {
      return res.status(400).json({ success: false, message: 'Invalid startDate or deadline' });
    }
    const start = startDate || new Date();
    if (deadline && deadline < start) {
      return res.status(400).json({ success: false, message: 'Deadline cannot be before the start date' });
    }

    const project = await Project.create({
      workspace: workspaceId,
      name,
      description,
      startDate: start,
      deadline: deadline || undefined,
      template: templateId,
      columns: tpl.columns,
      labels: tpl.labels,
      milestones: tpl.milestones.map((m) => ({
        title: m.title,
        targetDate: new Date(start.getTime() + m.offsetDays * DAY_MS),
      })),
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, project });
  } catch (error) {
    serverError(res, 'Failed to create project', error);
  }
}

async function getWorkspaceProjects(req, res) {
  try {
    const role = await getWorkspaceRole(req.params.workspaceId, req.user.id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    // Archived projects are hidden unless explicitly requested.
    const archived = req.query.archived === 'true';
    const projects = await Project.find({
      workspace: req.params.workspaceId,
      isArchived: archived,
    }).sort({ createdAt: -1 });

    res.json({ success: true, projects });
  } catch (error) {
    serverError(res, 'Failed to fetch projects', error);
  }
}

async function getProject(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    res.json({ success: true, project: loaded.project });
  } catch (error) {
    serverError(res, 'Failed to fetch project', error);
  }
}

async function updateProject(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!requireManager(role, res, 'edit projects')) return;

    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) {
        return res.status(400).json({ success: false, message: 'Project name cannot be empty' });
      }
      project.name = req.body.name;
    }
    if (req.body.description !== undefined) project.description = req.body.description;

    const startDate = parseDate(req.body.startDate);
    const deadline = parseDate(req.body.deadline);
    if (startDate === 'invalid' || deadline === 'invalid') {
      return res.status(400).json({ success: false, message: 'Invalid startDate or deadline' });
    }
    if (startDate) project.startDate = startDate;
    if (deadline !== undefined) project.deadline = deadline || undefined;

    if (project.deadline && project.deadline < project.startDate) {
      return res.status(400).json({ success: false, message: 'Deadline cannot be before the start date' });
    }

    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    serverError(res, 'Failed to update project', error);
  }
}

async function deleteProject(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!requireManager(role, res, 'delete projects')) return;

    // Deletion is destructive: the caller must explicitly confirm.
    if (req.query.confirm !== 'true') {
      return res.status(400).json({
        success: false,
        message: 'Deleting a project permanently removes all its tasks. Repeat the request with ?confirm=true to proceed.',
      });
    }

    const { deletedCount } = await Task.deleteMany({ project: project._id });
    await project.deleteOne();

    res.json({ success: true, message: 'Project deleted', tasksDeleted: deletedCount });
  } catch (error) {
    serverError(res, 'Failed to delete project', error);
  }
}

function setArchived(value) {
  return async function (req, res) {
    try {
      const loaded = await loadProject(req, res);
      if (!loaded) return;
      const { project, role } = loaded;
      if (!requireManager(role, res, value ? 'archive projects' : 'restore projects')) return;

      project.isArchived = value;
      project.archivedAt = value ? new Date() : undefined;
      await project.save();

      res.json({ success: true, project });
    } catch (error) {
      serverError(res, `Failed to ${value ? 'archive' : 'restore'} project`, error);
    }
  };
}

// ---------- Milestones ----------

async function addMilestone(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!requireManager(role, res, 'manage milestones')) return;

    const { title, description } = req.body;
    const targetDate = parseDate(req.body.targetDate);
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Milestone title is required' });
    }
    if (!targetDate || targetDate === 'invalid') {
      return res.status(400).json({ success: false, message: 'A valid targetDate is required' });
    }

    project.milestones.push({ title, description, targetDate });
    await project.save();

    res.status(201).json({ success: true, milestone: project.milestones[project.milestones.length - 1], project });
  } catch (error) {
    serverError(res, 'Failed to add milestone', error);
  }
}

async function updateMilestone(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!requireManager(role, res, 'manage milestones')) return;

    const milestone = project.milestones.id(req.params.milestoneId);
    if (!milestone) {
      return res.status(404).json({ success: false, message: 'Milestone not found' });
    }

    if (req.body.title !== undefined) {
      if (!String(req.body.title).trim()) {
        return res.status(400).json({ success: false, message: 'Milestone title cannot be empty' });
      }
      milestone.title = req.body.title;
    }
    if (req.body.description !== undefined) milestone.description = req.body.description;
    if (req.body.completed !== undefined) milestone.completed = Boolean(req.body.completed);

    const targetDate = parseDate(req.body.targetDate);
    if (targetDate === 'invalid' || targetDate === null) {
      return res.status(400).json({ success: false, message: 'targetDate must be a valid date' });
    }
    if (targetDate) milestone.targetDate = targetDate;

    await project.save();
    res.json({ success: true, milestone, project });
  } catch (error) {
    serverError(res, 'Failed to update milestone', error);
  }
}

async function deleteMilestone(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!requireManager(role, res, 'manage milestones')) return;

    const milestone = project.milestones.id(req.params.milestoneId);
    if (!milestone) {
      return res.status(404).json({ success: false, message: 'Milestone not found' });
    }

    milestone.deleteOne();
    await project.save();
    // Tasks linked to the removed milestone simply become unlinked.
    await Task.updateMany({ project: project._id, milestone: req.params.milestoneId }, { $unset: { milestone: 1 } });

    res.json({ success: true, project });
  } catch (error) {
    serverError(res, 'Failed to delete milestone', error);
  }
}

module.exports = {
  listTemplates,
  createProject,
  getWorkspaceProjects,
  getProject,
  updateProject,
  deleteProject,
  archiveProject: setArchived(true),
  unarchiveProject: setArchived(false),
  addMilestone,
  updateMilestone,
  deleteMilestone,
};
