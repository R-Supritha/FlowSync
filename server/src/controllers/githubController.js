const Project = require('../models/Project');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const GithubLink = require('../models/GithubLink');
const GithubEvent = require('../models/GithubEvent');
const ActivityLog = require('../models/ActivityLog');
const { publish } = require('../utils/activityBus');
const { categoryFor } = require('../utils/activity');
const { canWrite, isManagerRole, getWorkspaceRole, serverError } = require('../utils/access');
const { encrypt, decrypt } = require('../utils/tokenCrypto');
const { GithubError, getRepo, listCommits, listPulls } = require('../utils/githubClient');
const { parseRepo, buildEvents } = require('../utils/githubEvents');

const DAY = 24 * 60 * 60 * 1000;
const FIRST_SYNC_DAYS = 14; // how far back the very first sync looks
const OVERLAP_MS = 10 * 60 * 1000; // re-check the last 10 minutes; duplicates are skipped anyway

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

// Only these fields ever leave the server. The token is never one of them.
function publicLink(link) {
  return {
    repo: link.repoFullName,
    defaultBranch: link.defaultBranch,
    linkedBy: link.linkedBy,
    lastSyncedAt: link.lastSyncedAt,
    lastSyncSummary: link.lastSyncSummary,
    linkedAt: link.createdAt,
  };
}

// POST /projects/:projectId/github   body: { repo, token }
async function linkRepository(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!isManagerRole(role)) return fail(res, 403, 'Only Admin or Manager can link a repository');
    if (project.isArchived) return fail(res, 400, 'Archived projects cannot be linked');

    const body = req.body || {};
    const repo = parseRepo(body.repo);
    if (!repo) return fail(res, 400, 'repo must look like "owner/name" or a github.com link');
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (token.length < 20 || token.length > 400 || /\s/.test(token)) {
      return fail(res, 400, 'token must be a GitHub access token (no spaces)');
    }

    let repoInfo;
    try {
      repoInfo = await getRepo(token, repo.owner, repo.name);
    } catch (error) {
      if (error instanceof GithubError) return fail(res, error.status, error.message);
      throw error;
    }

    const existing = await GithubLink.findOne({ project: project._id }).select('repoFullName lastSyncedAt');
    const sameRepo = Boolean(existing) && existing.repoFullName === repoInfo.full_name;

    // Linking again replaces the token (use this when a token expires).
    const link = await GithubLink.findOneAndUpdate(
      { project: project._id },
      {
        workspace: project.workspace,
        repoFullName: repoInfo.full_name,
        defaultBranch: repoInfo.default_branch,
        tokenEncrypted: encrypt(token),
        linkedBy: req.user.id,
        lastSyncedAt: sameRepo ? existing.lastSyncedAt : null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    res.status(existing ? 200 : 201).json({
      success: true,
      link: publicLink(link),
      repository: { private: Boolean(repoInfo.private) },
    });
  } catch (error) {
    serverError(res, 'Failed to link repository', error);
  }
}

// GET /projects/:projectId/github
async function getLink(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const link = await GithubLink.findOne({ project: loaded.project._id })
      .populate('linkedBy', 'name email')
      .lean();
    if (!link) return res.json({ success: true, linked: false });
    res.json({ success: true, linked: true, link: publicLink(link) });
  } catch (error) {
    serverError(res, 'Failed to load repository link', error);
  }
}

// DELETE /projects/:projectId/github
async function unlinkRepository(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    if (!isManagerRole(loaded.role)) return fail(res, 403, 'Only Admin or Manager can unlink a repository');
    const result = await GithubLink.deleteOne({ project: loaded.project._id });
    if (result.deletedCount === 0) return fail(res, 404, 'This project is not linked to a GitHub repository');
    res.json({ success: true, message: 'Repository unlinked. Activity already recorded is kept.' });
  } catch (error) {
    serverError(res, 'Failed to unlink repository', error);
  }
}

// POST /projects/:projectId/github/sync
// Pulls recent commits and pull requests and records them in the activity log.
async function syncRepository(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const { project, role } = loaded;
    if (!canWrite(role)) return fail(res, 403, 'Viewers cannot sync a repository');
    if (project.isArchived) return fail(res, 400, 'Archived projects cannot be synced');

    const link = await GithubLink.findOne({ project: project._id }).select('+tokenEncrypted');
    if (!link) return fail(res, 404, 'This project is not linked to a GitHub repository');

    const token = decrypt(link.tokenEncrypted);
    const [owner, name] = link.repoFullName.split('/');
    const now = new Date();
    const since = link.lastSyncedAt
      ? new Date(link.lastSyncedAt.getTime() - OVERLAP_MS)
      : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY);

    let commits;
    let pulls;
    try {
      [commits, pulls] = await Promise.all([
        listCommits(token, owner, name, since),
        listPulls(token, owner, name),
      ]);
    } catch (error) {
      if (error instanceof GithubError) return fail(res, error.status, error.message);
      throw error;
    }

    const events = buildEvents({ repo: link.repoFullName, commits, pulls, since });

    // Match GitHub usernames to FlowSync users through the githubUsername on their profile.
    const workspace = await Workspace.findById(project.workspace).select('members').lean();
    const memberIds = workspace.members.map((m) => m.user);
    const users = await User.find({ _id: { $in: memberIds }, githubUsername: { $nin: ['', null] } })
      .select('githubUsername')
      .lean();
    const byLogin = new Map(users.map((u) => [u.githubUsername.toLowerCase(), u._id]));

    const recorded = { commits: 0, prsOpened: 0, prsMerged: 0 };
    const unmatched = new Set();
    let duplicates = 0;

    for (const ev of events) {
      try {
        await GithubEvent.create({ project: project._id, key: ev.key });
      } catch (error) {
        if (error && error.code === 11000) {
          duplicates += 1;
          continue;
        }
        throw error;
      }

      const matchedId = ev.login ? byLogin.get(ev.login.toLowerCase()) : null;
      if (ev.login && !matchedId) unmatched.add(ev.login);

      try {
        const doc = await ActivityLog.create({
          workspace: project.workspace,
          project: project._id,
          // Commits by people without a matching profile are credited to whoever linked the repo.
          actor: matchedId || link.linkedBy,
          type: ev.type,
          category: categoryFor(ev.type),
          message: matchedId || !ev.login ? ev.message : `${ev.message} (by @${ev.login})`,
          meta: { ...ev.meta, matchedUser: Boolean(matchedId) },
          createdAt: ev.date, // the real commit / PR time, so the weekly dots land on the right day
        });
        await doc.populate('actor', 'name email');
        publish(doc.toObject());
      } catch (error) {
        await GithubEvent.deleteOne({ project: project._id, key: ev.key }); // let the next sync retry it
        throw error;
      }

      if (ev.type === 'commit_pushed') recorded.commits += 1;
      else if (ev.type === 'pr_opened') recorded.prsOpened += 1;
      else if (ev.type === 'pr_merged') recorded.prsMerged += 1;
    }

    link.lastSyncedAt = now;
    link.lastSyncSummary = recorded;
    await link.save();

    res.json({
      success: true,
      repo: link.repoFullName,
      since,
      fetched: { commits: commits.length, pullRequests: pulls.length },
      recorded,
      skippedAlreadyRecorded: duplicates,
      unmatchedGithubUsers: [...unmatched],
      lastSyncedAt: now,
    });
  } catch (error) {
    serverError(res, 'Failed to sync repository', error);
  }
}

module.exports = { linkRepository, getLink, unlinkRepository, syncRepository };