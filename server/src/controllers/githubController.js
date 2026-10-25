const Project = require('../models/Project');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const Task = require('../models/Task');
const GithubLink = require('../models/GithubLink');
const GithubEvent = require('../models/GithubEvent');
const { notifyPullRequest } = require('../utils/githubNotify');
const { collectExtras } = require('../utils/githubExtras');
const { recordActivity, makeTaskIndex, applyEventToTasks, applyAuthorFallback, refFor, extractRefs } = require('../utils/githubTaskLinks');
const { canWrite, isManagerRole, getWorkspaceRole, serverError } = require('../utils/access');
const { encrypt, decrypt } = require('../utils/tokenCrypto');
const { GithubError, getRepo, listCommits, listPulls, getCommit, getPull, listPullFiles } = require('../utils/githubClient');
const { filterRealEvents, markerKey } = require('../utils/githubChanges');
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
    branchCount: link.branchesBaselined ? (link.knownBranches || []).length : null,
    recentNewBranches: (link.recentNewBranches || []).map((b) => ({ name: b.name, seenAt: b.seenAt })),
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

    const allEvents = buildEvents({ repo: link.repoFullName, commits, pulls, since });

    // Empty commits and empty pull requests do not count as progress: look at what each NEW
    // commit / pull request really changed, and leave the empty ones out (see utils/githubChanges.js).
    const knownKeys = new Set();
    if (allEvents.length) {
      const rows = await GithubEvent.find({
        project: project._id,
        key: { $in: allEvents.flatMap((ev) => [ev.key, markerKey(ev)]) },
      }).select('key').lean();
      rows.forEach((r) => knownKeys.add(r.key));
    }
    let checked;
    try {
      checked = await filterRealEvents({
        events: allEvents,
        knownKeys,
        extractRefs,
        getCommit: (sha) => getCommit(token, owner, name, sha),
        getPull: (number) => getPull(token, owner, name, number),
        getPullFiles: (number) => listPullFiles(token, owner, name, number),
      });
    } catch (error) {
      if (error instanceof GithubError) return fail(res, error.status, error.message);
      throw error;
    }
    // FR13: issues, releases and new branches. Optional: if the token cannot read one, the sync goes on and says so.
    let extras;
    try {
      extras = await collectExtras({ token, owner, name, repo: link.repoFullName, since, link });
    } catch (error) {
      if (error instanceof GithubError) return fail(res, error.status, error.message);
      throw error;
    }
    const events = [...checked.events, ...extras.events].sort((a, b) => a.date - b.date);
    for (const key of checked.markers) {
      try {
        await GithubEvent.create({ project: project._id, key });
      } catch (error) {
        if (!(error && error.code === 11000)) throw error;
      }
    }

    // Match GitHub usernames to FlowSync users through the githubUsername on their profile.
    const workspace = await Workspace.findById(project.workspace).select('members').lean();
    const memberIds = workspace.members.map((m) => m.user);
    const users = await User.find({ _id: { $in: memberIds }, githubUsername: { $nin: ['', null] } })
      .select('githubUsername')
      .lean();
    const byLogin = new Map(users.map((u) => [u.githubUsername.toLowerCase(), u._id]));

    // last-6-characters of every active task id, so FS-xxxxxx references can be resolved
    const activeTasks = events.length
      ? await Task.find({ project: project._id, isArchived: false }).select('_id title assignee reporter status').lean()
      : [];
    const taskIndex = makeTaskIndex(activeTasks);

    const recorded = { commits: 0, prsOpened: 0, prsMerged: 0, issuesOpened: 0, issuesClosed: 0, releases: 0, newBranches: extras.newBranches.length };
    const unmatched = new Set();
    const tasksMoved = [];
    const linkNotes = new Set(checked.notes);
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
      // Commits by people without a matching profile are credited to whoever linked the repo.
      const actor = matchedId || link.linkedBy;

      try {
        // 1. Move any task this commit / PR mentions (FR14). Done first, so a failure here
        //    leaves nothing half-recorded and the whole event is retried on the next sync.
        const linked = await applyEventToTasks({ ev, project, index: taskIndex, actor });
        tasksMoved.push(...linked.moved);
        linked.notes.forEach((n) => linkNotes.add(n));
        // keep our copy of the board up to date for the commits that follow in this sync
        for (const m of linked.moved) {
          const t = activeTasks.find((x) => refFor(x._id) === m.ref);
          if (t) t.status = m.to;
        }

        // 1b. A plain commit (no reference): link it to the author's one waiting task when that is
        //     unambiguous (see applyAuthorFallback). Only for people matched through their profile.
        const byAuthor = await applyAuthorFallback({ ev, project, tasks: activeTasks, userId: matchedId });
        tasksMoved.push(...byAuthor.moved);
        byAuthor.notes.forEach((n) => linkNotes.add(n));

        // 2. Record the commit / PR itself.
        await recordActivity({
          workspace: project.workspace,
          project: project._id,
          actor,
          type: ev.type,
          message: matchedId || !ev.login ? ev.message : `${ev.message} (by @${ev.login})`,
          meta: { ...ev.meta, matchedUser: Boolean(matchedId) },
          createdAt: ev.date, // the real commit / PR time, so the weekly dots land on the right day
        });
      } catch (error) {
        await GithubEvent.deleteOne({ project: project._id, key: ev.key }); // let the next sync retry it
        throw error;
      }

      // FR10: tell the people on the task about the pull request (never throws; see notify())
      if (ev.type === 'pr_opened' || ev.type === 'pr_merged') {
        await notifyPullRequest({ ev, project, tasks: activeTasks, index: taskIndex, authorId: matchedId });
      }

      if (ev.type === 'commit_pushed') recorded.commits += 1;
      else if (ev.type === 'pr_opened') recorded.prsOpened += 1;
      else if (ev.type === 'pr_merged') recorded.prsMerged += 1;
      else if (ev.type === 'issue_opened') recorded.issuesOpened += 1;
      else if (ev.type === 'issue_closed') recorded.issuesClosed += 1;
      else if (ev.type === 'release_published') recorded.releases += 1;
    }

    link.lastSyncedAt = now;
    link.lastSyncSummary = recorded;
    if (extras.branchNames) {
      link.knownBranches = extras.branchNames;
      link.branchesBaselined = true;
      if (extras.newBranches.length) {
        link.recentNewBranches = [...extras.newBranches.map((n) => ({ name: n, seenAt: now })), ...(link.recentNewBranches || [])].slice(0, 10);
      }
    }
    await link.save();

    res.json({
      success: true,
      repo: link.repoFullName,
      since,
      fetched: { commits: commits.length, pullRequests: pulls.length },
      newBranches: extras.newBranches,
      branchCount: extras.branchNames ? extras.branchNames.length : null,
      unavailable: extras.unavailable,
      notes: extras.notes,
      recorded,
      skippedAlreadyRecorded: duplicates,
      skippedNoChanges: checked.skipped,
      tasksMoved,
      taskLinkNotes: [...linkNotes].slice(0, 20),
      unmatchedGithubUsers: [...unmatched],
      lastSyncedAt: now,
    });
  } catch (error) {
    serverError(res, 'Failed to sync repository', error);
  }
}

// GET /projects/:projectId/github/task-refs
// The reference to put in a commit message, branch name or PR title for each task.
async function listTaskRefs(req, res) {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;
    const tasks = await Task.find({ project: loaded.project._id, isArchived: false })
      .select('title status')
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    res.json({
      success: true,
      howTo:
        'Put a task reference in a commit message, branch name or PR title, for example "FS-0140ad start login page". ' +
        'A linked commit moves the task to In Progress, an opened PR to Review and a merged PR to Done (tasks only move forward). ' +
        'A commit with no reference moves the author\'s only task in To Do to In Progress, if the author\'s GitHub username is on their profile and they are not already working on something; otherwise nothing is guessed.',
      tasks: tasks.map((t) => ({ _id: t._id, ref: refFor(t._id), title: t.title, status: t.status })),
    });
  } catch (error) {
    serverError(res, 'Failed to list task references', error);
  }
}

module.exports = { linkRepository, getLink, unlinkRepository, syncRepository, listTaskRefs };
