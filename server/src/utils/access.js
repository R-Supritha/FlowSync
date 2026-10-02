const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');

const MANAGER_ROLES = ['Admin', 'Manager'];

const isManagerRole = (role) => MANAGER_ROLES.includes(role);
const canWrite = (role) => role === 'Admin' || role === 'Manager' || role === 'Member';

// Returns the user's role inside the workspace, or null if the workspace
// does not exist / the user is not a member (we don't leak which one).
async function getWorkspaceRole(workspaceId, userId) {
  if (!mongoose.isValidObjectId(workspaceId)) return null;
  const workspace = await Workspace.findById(workspaceId).select('members');
  if (!workspace) return null;
  const member = workspace.members.find((m) => m.user.toString() === String(userId));
  return member ? member.role : null;
}

async function isWorkspaceMember(workspaceId, userId) {
  return (await getWorkspaceRole(workspaceId, userId)) !== null;
}

function parseDate(value) {
  // undefined -> not provided, null/'' -> clear, Date -> ok, 'invalid' -> bad input
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

function serverError(res, message, error) {
  return res.status(500).json({ success: false, message, error: error.message });
}

module.exports = {
  isManagerRole,
  canWrite,
  getWorkspaceRole,
  isWorkspaceMember,
  parseDate,
  serverError,
};
