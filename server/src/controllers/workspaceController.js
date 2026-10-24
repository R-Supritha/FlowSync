const Workspace = require('../models/Workspace');
const User = require('../models/User');
const { deleteWorkspaceData } = require('../utils/workspaceCleanup');

const ROLES = ['Admin', 'Manager', 'Member', 'Viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MAX_DESCRIPTION = 500;

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

const memberOf = (workspace, userId) => workspace.members.find((m) => m.user.toString() === String(userId));
const adminCount = (workspace) => workspace.members.filter((m) => m.role === 'Admin').length;

async function createWorkspace(req, res) {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Workspace name is required' });
    }

    const workspace = await Workspace.create({
      name,
      description,
      owner: req.user.id,
      members: [{ user: req.user.id, role: 'Admin' }],
    });

    res.status(201).json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create workspace', error: error.message });
  }
}

async function getMyWorkspaces(req, res) {
  try {
    const workspaces = await Workspace.find({ 'members.user': req.user.id });
    res.json({ success: true, workspaces });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch workspaces', error: error.message });
  }
}

async function inviteMember(req, res) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { role } = req.body;
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const mine = memberOf(workspace, req.user.id);
    if (!mine || (mine.role !== 'Admin' && mine.role !== 'Manager')) {
      return res.status(403).json({ success: false, message: 'Only Admin or Manager can invite members' });
    }

    if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address');
    if (role !== undefined && !ROLES.includes(role)) return fail(res, 400, `role must be one of ${ROLES.join(', ')}`);
    // Only an Admin can make another Admin, so a Manager cannot promote people above themselves.
    if (role === 'Admin' && mine.role !== 'Admin') return fail(res, 403, 'Only Admin can invite someone as Admin');

    const userToInvite = await User.findOne({ email });
    if (!userToInvite) {
      return res.status(404).json({ success: false, message: 'No user found with that email' });
    }

    const alreadyMember = workspace.members.some(
      (m) => m.user.toString() === userToInvite._id.toString()
    );
    if (alreadyMember) {
      return res.status(409).json({ success: false, message: 'User is already a member' });
    }

    workspace.members.push({ user: userToInvite._id, role: role || 'Member' });
    await workspace.save();

    res.json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to invite member', error: error.message });
  }
}

async function removeMember(req, res) {
  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const mine = memberOf(workspace, req.user.id);
    if (!mine || mine.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only Admin can remove members' });
    }

    const target = memberOf(workspace, req.params.userId);
    if (!target) return fail(res, 404, 'That person is not a member of this workspace');
    if (target.role === 'Admin' && adminCount(workspace) === 1) {
      return fail(res, 400, 'A workspace must keep at least one Admin. Make someone else Admin first.');
    }

    workspace.members = workspace.members.filter(
      (m) => m.user.toString() !== req.params.userId
    );
    await workspace.save();

    res.json({ success: true, workspace });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove member', error: error.message });
  }
}

// PATCH /workspaces/:id   body: { name?, description? }   (Admin or Manager) - workspace settings
async function updateWorkspace(req, res) {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return fail(res, 404, 'Workspace not found');
    const mine = memberOf(workspace, req.user.id);
    if (!mine) return fail(res, 404, 'Workspace not found');
    if (mine.role !== 'Admin' && mine.role !== 'Manager') return fail(res, 403, 'Only Admin or Manager can change workspace settings');

    const body = req.body || {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return fail(res, 400, 'Workspace name is required');
      if (name.length > MAX_NAME) return fail(res, 400, `Workspace name can have at most ${MAX_NAME} characters`);
      workspace.name = name;
    }
    if (body.description !== undefined) {
      const description = typeof body.description === 'string' ? body.description.trim() : null;
      if (description === null) return fail(res, 400, 'description must be text');
      if (description.length > MAX_DESCRIPTION) return fail(res, 400, `Description can have at most ${MAX_DESCRIPTION} characters`);
      workspace.description = description;
    }
    if (body.name === undefined && body.description === undefined) return fail(res, 400, 'Nothing to change');

    await workspace.save();
    return res.json({ success: true, workspace });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update workspace', error: error.message });
  }
}

// PATCH /workspaces/:id/members/:userId   body: { role }   (Admin only)
async function updateMemberRole(req, res) {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return fail(res, 404, 'Workspace not found');
    const mine = memberOf(workspace, req.user.id);
    if (!mine) return fail(res, 404, 'Workspace not found');
    if (mine.role !== 'Admin') return fail(res, 403, 'Only Admin can change roles');

    const { role } = req.body || {};
    if (!ROLES.includes(role)) return fail(res, 400, `role must be one of ${ROLES.join(', ')}`);
    const target = memberOf(workspace, req.params.userId);
    if (!target) return fail(res, 404, 'That person is not a member of this workspace');
    if (target.role === 'Admin' && role !== 'Admin' && adminCount(workspace) === 1) {
      return fail(res, 400, 'A workspace must keep at least one Admin. Make someone else Admin first.');
    }

    target.role = role;
    await workspace.save();
    return res.json({ success: true, workspace });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to change the role', error: error.message });
  }
}

// DELETE /workspaces/:id   body: { confirmName }   (Admin only)
// Removes the workspace and everything in it. The caller must type the workspace name to confirm.
async function deleteWorkspace(req, res) {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return fail(res, 404, 'Workspace not found');
    const mine = memberOf(workspace, req.user.id);
    if (!mine) return fail(res, 404, 'Workspace not found');
    if (mine.role !== 'Admin') return fail(res, 403, 'Only Admin can delete a workspace');

    const confirmName = req.body && typeof req.body.confirmName === 'string' ? req.body.confirmName.trim() : '';
    if (confirmName !== workspace.name) return fail(res, 400, 'Type the exact workspace name to confirm the deletion');

    const deleted = await deleteWorkspaceData(workspace._id);
    await workspace.deleteOne();
    return res.json({ success: true, deleted });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete the workspace', error: error.message });
  }
}

module.exports = { createWorkspace, getMyWorkspaces, inviteMember, removeMember, updateWorkspace, updateMemberRole, deleteWorkspace, ROLES };
