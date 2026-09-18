const Workspace = require('../models/Workspace');

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

module.exports = { createWorkspace, getMyWorkspaces };