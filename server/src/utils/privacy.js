const Workspace = require('../models/Workspace');
const Team = require('../models/Team');
const { isManagerRole } = require('./access');

// everyone = anyone who shares a workspace with you
// team     = people on at least one of your teams
// managers = Admins/Managers of the workspace
// private  = only you
const VISIBILITY_LEVELS = ['everyone', 'team', 'managers', 'private'];

// Weekly contribution dots are opt-in (FR16: "not forced on by default").
// Live status is on for teammates by default; change either default here.
const DEFAULT_PRIVACY = {
  statusVisibility: 'team',
  contributionVisibility: 'private',
  inferWorkMode: false,
};

function readPrivacy(user) {
  const p = (user && user.privacy) || {};
  return {
    statusVisibility: p.statusVisibility || DEFAULT_PRIVACY.statusVisibility,
    contributionVisibility: p.contributionVisibility || DEFAULT_PRIVACY.contributionVisibility,
    inferWorkMode: typeof p.inferWorkMode === 'boolean' ? p.inferWorkMode : DEFAULT_PRIVACY.inferWorkMode,
  };
}

// Builds a sync checker `canSee(targetId, level)` for one viewer across the given workspaces
// (lean docs with `_id` and `members`).
async function makeViewerGate(viewerId, workspaces) {
  const ids = workspaces.map((w) => w._id);
  const isManager = workspaces.some((w) =>
    w.members.some((m) => String(m.user) === String(viewerId) && isManagerRole(m.role))
  );
  const teams = await Team.find({ workspace: { $in: ids }, 'members.user': viewerId }).select('members.user').lean();
  const teammates = new Set();
  teams.forEach((t) => t.members.forEach((m) => teammates.add(String(m.user))));

  return function canSee(targetId, level) {
    if (String(targetId) === String(viewerId)) return true;
    switch (level) {
      case 'everyone':
        return true;
      case 'managers':
        return isManager;
      case 'team':
        return teammates.has(String(targetId));
      default:
        return false;
    }
  };
}

function sharedWorkspaces(viewerId, targetId) {
  return Workspace.find({ $and: [{ 'members.user': viewerId }, { 'members.user': targetId }] })
    .select('name members')
    .lean();
}

// Shared workspaces in which the viewer may see the target's data at `level`.
// Checked per workspace so being a Manager in one workspace never exposes another.
async function visibleWorkspaceIds(viewerId, targetId, level, workspaces) {
  const ids = [];
  for (const w of workspaces) {
    const canSee = await makeViewerGate(viewerId, [w]);
    if (canSee(targetId, level)) ids.push(w._id);
  }
  return ids;
}

module.exports = {
  VISIBILITY_LEVELS,
  DEFAULT_PRIVACY,
  readPrivacy,
  makeViewerGate,
  sharedWorkspaces,
  visibleWorkspaceIds,
};