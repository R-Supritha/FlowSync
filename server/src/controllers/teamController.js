const mongoose = require('mongoose');
const Team = require('../models/Team');
const TeamProject = require('../models/TeamProject');
const Project = require('../models/Project');
const { isManagerRole, getWorkspaceRole, isWorkspaceMember, serverError } = require('../utils/access');

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

async function loadTeam(req, res) {
  const team = await Team.findById(req.params.id);
  if (!team) return fail(res, 404, 'Team not found');
  const role = await getWorkspaceRole(team.workspace, req.user.id);
  if (!role) return fail(res, 404, 'Team not found');
  return { team, role };
}

function requireManager(role, res, action) {
  if (isManagerRole(role)) return true;
  fail(res, 403, `Only Admin or Manager can ${action}`);
  return false;
}

async function createTeam(req, res) {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(workspaceId, req.user.id);
    if (!role) return fail(res, 404, 'Workspace not found');
    if (!requireManager(role, res, 'create teams')) return;

    const { name, description } = req.body;
    if (!name || !String(name).trim()) return fail(res, 400, 'Team name is required');

    const team = await Team.create({
      workspace: workspaceId,
      name,
      description,
      members: [{ user: req.user.id, role: 'Admin' }],
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, team });
  } catch (error) {
    serverError(res, 'Failed to create team', error);
  }
}

async function getWorkspaceTeams(req, res) {
  try {
    const role = await getWorkspaceRole(req.params.workspaceId, req.user.id);
    if (!role) return fail(res, 404, 'Workspace not found');

    const teams = await Team.find({ workspace: req.params.workspaceId }).sort({ createdAt: -1 });
    res.json({ success: true, teams });
  } catch (error) {
    serverError(res, 'Failed to fetch teams', error);
  }
}

async function getTeam(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    res.json({ success: true, team: loaded.team });
  } catch (error) {
    serverError(res, 'Failed to fetch team', error);
  }
}

async function updateTeam(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    const { team, role } = loaded;
    if (!requireManager(role, res, 'edit teams')) return;

    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) return fail(res, 400, 'Team name cannot be empty');
      team.name = req.body.name;
    }
    if (req.body.description !== undefined) team.description = req.body.description;

    await team.save();
    res.json({ success: true, team });
  } catch (error) {
    serverError(res, 'Failed to update team', error);
  }
}

async function deleteTeam(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    const { team, role } = loaded;
    if (!requireManager(role, res, 'delete teams')) return;

    await TeamProject.deleteMany({ team: team._id });
    await team.deleteOne();

    res.json({ success: true, message: 'Team deleted' });
  } catch (error) {
    serverError(res, 'Failed to delete team', error);
  }
}

async function addTeamMember(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    const { team, role } = loaded;
    if (!requireManager(role, res, 'manage team members')) return;

    const { userId, role: memberRole } = req.body;
    if (!mongoose.isValidObjectId(userId)) return fail(res, 400, 'A valid userId is required');
    if (!(await isWorkspaceMember(team.workspace, userId))) {
      return fail(res, 400, 'User must already be a member of the workspace');
    }
    if (team.members.some((m) => String(m.user) === String(userId))) {
      return fail(res, 409, 'User is already on this team');
    }

    team.members.push({ user: userId, role: memberRole || 'Member' });
    await team.save();

    res.status(201).json({ success: true, team });
  } catch (error) {
    serverError(res, 'Failed to add team member', error);
  }
}

async function updateTeamMemberRole(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    const { team, role } = loaded;
    if (!requireManager(role, res, 'manage team members')) return;

    const member = team.members.find((m) => String(m.user) === req.params.userId);
    if (!member) return fail(res, 404, 'User is not on this team');
    if (!req.body.role) return fail(res, 400, 'role is required');

    member.role = req.body.role;
    await team.save();
    res.json({ success: true, team });
  } catch (error) {
    serverError(res, 'Failed to update member role', error);
  }
}

async function removeTeamMember(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    const { team, role } = loaded;
    if (!requireManager(role, res, 'manage team members')) return;

    team.members = team.members.filter((m) => String(m.user) !== req.params.userId);
    await team.save();

    res.json({ success: true, team });
  } catch (error) {
    serverError(res, 'Failed to remove team member', error);
  }
}

async function assignTeamToProject(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    const { team, role } = loaded;
    if (!requireManager(role, res, 'assign teams to projects')) return;

    const project = await Project.findById(req.params.projectId);
    if (!project || String(project.workspace) !== String(team.workspace)) {
      return fail(res, 404, 'Project not found in this workspace');
    }

    try {
      await TeamProject.create({ team: team._id, project: project._id });
    } catch (error) {
      if (error.code === 11000) return fail(res, 409, 'Team is already assigned to this project');
      throw error;
    }

    res.status(201).json({ success: true, message: 'Team assigned to project' });
  } catch (error) {
    serverError(res, 'Failed to assign team to project', error);
  }
}

async function unassignTeamFromProject(req, res) {
  try {
    const loaded = await loadTeam(req, res);
    if (!loaded) return;
    const { team, role } = loaded;
    if (!requireManager(role, res, 'unassign teams from projects')) return;

    await TeamProject.deleteOne({ team: team._id, project: req.params.projectId });
    res.json({ success: true, message: 'Team unassigned from project' });
  } catch (error) {
    serverError(res, 'Failed to unassign team from project', error);
  }
}

async function getProjectTeams(req, res) {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return fail(res, 404, 'Project not found');
    const role = await getWorkspaceRole(project.workspace, req.user.id);
    if (!role) return fail(res, 404, 'Project not found');

    const links = await TeamProject.find({ project: project._id }).populate('team');
    res.json({ success: true, teams: links.map((l) => l.team) });
  } catch (error) {
    serverError(res, 'Failed to fetch project teams', error);
  }
}

module.exports = {
  createTeam,
  getWorkspaceTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  assignTeamToProject,
  unassignTeamFromProject,
  getProjectTeams,
};
