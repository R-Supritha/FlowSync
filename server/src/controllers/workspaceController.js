const Workspace = require('../models/Workspace');
const User = require('../models/User');

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
    const { email, role } = req.body;
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const isAdminOrManager = workspace.members.some(
      (m) => m.user.toString() === req.user.id && (m.role === 'Admin' || m.role === 'Manager')
    );
    if (!isAdminOrManager) {
      return res.status(403).json({ success: false, message: 'Only Admin or Manager can invite members' });
    }

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

    const isAdmin = workspace.members.some(
      (m) => m.user.toString() === req.user.id && m.role === 'Admin'
    );
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Only Admin can remove members' });
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

module.exports = { createWorkspace, getMyWorkspaces, inviteMember, removeMember };