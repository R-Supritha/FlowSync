const crypto = require('crypto');
const Project = require('../models/Project');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const Task = require('../models/Task');
const GithubLink = require('../models/GithubLink');
const GithubEvent = require('../models/GithubEvent');
const GithubTaskLink = require('../models/GithubTaskLink');
const GithubReview = require('../models/GithubReview');
const ReleaseNote = require('../models/ReleaseNote');
const { decrypt } = require('../utils/tokenCrypto');
const { getPull } = require('../utils/githubClient');
const { extractRefs, makeTaskIndex, refFor, recordActivity } = require('../utils/githubTaskLinks');
const { notifyPullRequest } = require('../utils/githubNotify');
const { reviewPullRequest } = require('./githubReviewService');
const {
  applyStatusTransition,
  classifyColumns,
  getGithubWorkflow,
  statusPosition,
  normalize,
} = require('./statusTransitionService');

const MAX_COMMITS_PER_PUSH = 100;

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function requireRealChanges() {
  return String(process.env.GITHUB_REQUIRE_CHANGES || 'true').trim().toLowerCase() !== 'false';
}

// GitHub push payloads include added/removed/modified file lists. If all three are present and
// empty, the commit changed nothing (the same rule the synchronize flow applies). If a test or a
// proxy omitted the lists, do not assume the commit is empty.
function commitChangedNoFiles(commit) {
  if (!requireRealChanges() || !commit) return false;
  const lists = [commit.added, commit.removed, commit.modified].filter(Array.isArray);
  if (lists.length === 0) return false;
  return lists.reduce((count, list) => count + list.length, 0) === 0;
}
const asDate = (value, fallback = new Date()) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
};
const sha7 = (sha) => String(sha || '').slice(0, 7);

async function findLinkedRepository(repoFullName) {
  return GithubLink.findOne({
    repoFullName: new RegExp(`^${escapeRegex(repoFullName)}$`, 'i'),
  }).select('+tokenEncrypted');
}

function tokenFor(link) {
  try {
    return link && link.tokenEncrypted ? decrypt(link.tokenEncrypted) : null;
  } catch (error) {
    console.error('Could not decrypt the GitHub token for a webhook:', error.message);
    return null;
  }
}

async function actorResolver(project, link) {
  let byLogin = new Map();
  try {
    const workspace = await Workspace.findById(project.workspace).select('members').lean();
    const ids = (workspace && workspace.members ? workspace.members : []).map((m) => m.user);
    const users = await User.find({ _id: { $in: ids }, githubUsername: { $nin: ['', null] } })
      .select('githubUsername')
      .lean();
    byLogin = new Map((users || []).map((u) => [String(u.githubUsername).toLowerCase(), u._id]));
  } catch (error) {
    console.error('Could not map GitHub users to FlowSync members:', error.message);
  }
  return (login) => (login && byLogin.get(String(login).toLowerCase())) || link.linkedBy;
}

function selectedFields() {
  return '_id title description status position assignee reporter checklist github isArchived';
}

async function loadActiveTasks(project) {
  return Task.find({ project: project._id, isArchived: false }).select(selectedFields()).lean();
}

function taskIdOf(row) {
  if (!row) return null;
  if (row.task && row.task._id) return row.task._id;
  return row.task || null;
}

async function queryRows(query) {
  if (!query) return [];
  const withLean = typeof query.lean === 'function' ? query.lean() : query;
  const rows = await withLean;
  return Array.isArray(rows) ? rows : [];
}

async function savedTaskIds({ project, repoFullName, prNumber, branch }) {
  const ids = [];
  try {
    if (prNumber != null) {
      const rows = await queryRows(
        GithubTaskLink.find({ project: project._id, repoFullName, prNumber }).select('task')
      );
      rows.forEach((row) => { const id = taskIdOf(row); if (id) ids.push(String(id)); });
    }
    if (branch) {
      const rows = await queryRows(
        GithubTaskLink.find({ project: project._id, repoFullName, branch }).select('task')
      );
      rows.forEach((row) => { const id = taskIdOf(row); if (id) ids.push(String(id)); });
    }
  } catch (error) {
    console.error('Could not read saved GitHub task links:', error.message);
  }
  return [...new Set(ids)];
}

async function saveTaskLink({ project, repoFullName, task, pr, branch, source = 'reference' }) {
  const filter = {
    project: project._id,
    repoFullName,
    task: task._id,
    ...(pr && pr.number != null ? { prNumber: pr.number } : {}),
    ...(!pr || pr.number == null ? { branch: branch || null } : {}),
  };
  const update = {
    $set: {
      workspace: project.workspace,
      ...(pr && pr.number != null ? { prNumber: pr.number, prUrl: pr.url || pr.html_url } : {}),
      ...(branch ? { branch } : {}),
      source,
      lastEventAt: new Date(),
    },
  };
  try {
    if (typeof GithubTaskLink.findOneAndUpdate === 'function') {
      await GithubTaskLink.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
    } else if (typeof GithubTaskLink.updateOne === 'function') {
      await GithubTaskLink.updateOne(filter, update, { upsert: true });
    }
  } catch (error) {
    if (!(error && error.code === 11000)) console.error('Could not save GitHub task link:', error.message);
  }
}

function taskTextsForPull(pull) {
  return [pull && pull.title, pull && pull.body, pull && pull.head && pull.head.ref, pull && pull.branch]
    .filter(Boolean)
    .join('\n');
}

// Explicit FS-xxxxxx references win. Only when the event has none do saved PR/branch links
// decide which task it belongs to. A title-resemblance guess is never used.
async function resolveTasks({ project, repoFullName, texts, pull, branch, index, activeTasks }) {
  const notes = new Set();
  const byId = new Map((activeTasks || []).map((task) => [String(task._id), task]));
  const chosen = new Map();
  let explicitCount = 0;

  for (const text of texts || []) {
    for (const key of extractRefs(text)) {
      explicitCount += 1;
      const ref = 'FS-' + key;
      const ids = index.get(key) || [];
      if (ids.length === 0) {
        notes.add(`${ref} matches no active task in this project`);
        continue;
      }
      if (ids.length > 1) {
        notes.add(`${ref} matches more than one task, so nothing was moved for it`);
        continue;
      }
      const task = byId.get(String(ids[0]));
      if (!task) {
        notes.add(`${ref} points at a task that was archived, so nothing was moved for it`);
        continue;
      }
      chosen.set(String(task._id), task);
    }
  }

  if (explicitCount === 0) {
    const saved = await savedTaskIds({ project, repoFullName, prNumber: pull && pull.number, branch });
    for (const id of saved) {
      const task = byId.get(String(id));
      if (task) chosen.set(String(task._id), task);
      else notes.add(`${refFor(id)} was linked before but is archived or missing, so nothing was moved`);
    }
  }

  const tasks = [...chosen.values()];
  for (const task of tasks) {
    await saveTaskLink({
      project,
      repoFullName,
      task,
      pr: pull,
      branch: branch || (pull && pull.head && pull.head.ref),
      source: explicitCount > 0 ? 'reference' : 'saved',
    });
  }
  return { tasks, notes: [...notes], source: explicitCount > 0 ? 'reference' : 'saved' };
}

async function rememberGithub({ task, pull, branch, review, checks, eventAt, eventKey, reason }) {
  if (!task) return null;
  const when = asDate(eventAt);
  const prior = task.github && typeof task.github.toObject === 'function'
    ? task.github.toObject()
    : { ...(task.github || {}) };
  if (prior.lastEventAt && when.getTime() < new Date(prior.lastEventAt).getTime()) return task;
  task.github = {
    ...prior,
    ...(pull && pull.number != null ? { prNumber: pull.number } : {}),
    ...(pull && (pull.url || pull.html_url) ? { prUrl: pull.url || pull.html_url } : {}),
    ...(pull && pull.head && pull.head.ref ? { branch: pull.head.ref } : {}),
    ...(pull && pull.branch ? { branch: pull.branch } : {}),
    ...(branch ? { branch } : {}),
    lastEventAt: when,
    ...(eventKey ? { lastEventKey: eventKey } : {}),
    ...(review && review.verdict ? { reviewStatus: review.verdict, reviewVerdict: review.verdict } : {}),
    ...(checks && checks.conclusion ? { checksConclusion: checks.conclusion } : {}),
    ...(reason ? { lastTransitionReason: reason } : {}),
  };
  try {
    await task.save();
  } catch (error) {
    console.error('Could not remember GitHub metadata on a task:', error.message);
  }
  return task;
}

async function transition({ task, project, targetStatus, actor, eventType, eventKey, eventAt, reason, pr, branch, review, checks, allowReopenDone = false, activityType, extraMeta }) {
  if (!targetStatus) return { status: 'ignored' };
  return applyStatusTransition({
    task,
    project,
    targetStatus,
    actor,
    eventType,
    eventKey,
    eventAt,
    reason,
    pr,
    branch,
    review,
    checks,
    ref: refFor(task._id),
    allowReopenDone,
    activityType,
    extraMeta,
  });
}

async function recordEventActivity({ project, actor, type, message, task, meta, eventAt }) {
  return recordActivity({
    workspace: project.workspace,
    project: project._id,
    actor,
    type,
    message,
    task: task ? task._id : undefined,
    taskTitle: task ? task.title : undefined,
    meta,
    createdAt: eventAt,
  });
}

function pullFromPayload(payload) {
  const p = payload.pull_request || {};
  return {
    number: p.number,
    title: p.title,
    body: p.body,
    url: p.html_url,
    html_url: p.html_url,
    head: p.head,
    branch: p.head && p.head.ref,
    merged: Boolean(p.merged),
    merged_at: p.merged_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    merge_commit_sha: p.merge_commit_sha,
    changed_files: p.changed_files,
    additions: p.additions,
    deletions: p.deletions,
  };
}

function pullChangedNoFiles(pull) {
  if (!requireRealChanges() || !pull) return false;
  if (pull.changed_files != null && Number.isFinite(Number(pull.changed_files))) {
    return Number(pull.changed_files) === 0;
  }
  return false;
}

async function fetchPullIfNeeded(token, repoFullName, pull) {
  if (!pull || pull.number == null) return pull;
  if (pull.title !== undefined && pull.head !== undefined) return pull;
  if (!token) return pull;
  try {
    const [owner, name] = repoFullName.split('/');
    const full = await getPull(token, owner, name, pull.number);
    return {
      number: full.number,
      title: full.title,
      body: full.body,
      url: full.html_url,
      html_url: full.html_url,
      head: full.head,
      branch: full.head && full.head.ref,
      merged: Boolean(full.merged),
      merged_at: full.merged_at,
      created_at: full.created_at,
      updated_at: full.updated_at,
      merge_commit_sha: full.merge_commit_sha,
    };
  } catch (error) {
    return pull;
  }
}

async function reviewTarget(project, task, review) {
  if (!review || review.verdict === 'unavailable' || review.verdict === 'inconclusive') return null;
  const columns = classifyColumns(project.columns);
  if ((review.blockingCount || 0) > 0) {
    return columns.changesRequested || columns.inProgress || columns.review || null;
  }
  if (review.verdict === 'changes_requested' || review.verdict === 'approved' || review.verdict === 'no_blocking_issues') {
    return columns.review || columns.inProgress || null;
  }
  return null;
}

async function runAndApplyAiReview({ project, link, token, repoFullName, task, pull, actor, eventKey, eventAt, workflow }) {
  const result = await reviewPullRequest({
    project,
    task,
    repoFullName,
    pull,
    token,
    commitSha: pull && pull.merge_commit_sha,
    workflow,
  });

  if (result.verdict !== 'unavailable') {
    await recordEventActivity({
      project,
      actor,
      type: 'review_submitted',
      message: `AI reviewed PR #${pull.number}: ${result.verdict === 'changes_requested' ? `${result.blockingCount || 0} blocking finding(s)` : result.verdict.replace(/_/g, ' ')}`,
      task,
      meta: {
        source: 'github',
        auto: true,
        trigger: 'ai_review',
        prNumber: pull.number,
        prUrl: pull.url,
        reviewId: result._id,
        verdict: result.verdict,
        summary: result.summary,
        blockingCount: result.blockingCount || 0,
      },
      eventAt: eventAt || new Date(),
    });
  }

  const target = await reviewTarget(project, task, result);
  if (target) {
    const reason = result.verdict === 'changes_requested'
      ? `AI review found ${result.blockingCount || 0} blocking issue(s) on PR #${pull.number}`
      : `AI review of PR #${pull.number} found no blocking issues`;
    const moved = await transition({
      task,
      project,
      targetStatus: target,
      actor,
      eventType: 'ai_review',
      eventKey,
      eventAt,
      reason,
      pr: pull,
      review: result,
      extraMeta: { reviewSummary: result.summary, reviewFindings: result.findings || [] },
    });
    if (moved.status !== 'moved') {
      await rememberGithub({ task, pull, review: result, eventAt, eventKey, reason });
    }
    return moved;
  }

  await rememberGithub({ task, pull, review: result, eventAt, eventKey });
  return { status: 'unchanged', reason: 'review recorded without a status change' };
}

async function handlePullRequest({ payload, project, link, token, actorFor, activeTasks, index, eventKey }) {
  const action = String(payload.action || '');
  const pull = pullFromPayload(payload);
  if (pull.number == null) return { ignored: 'pull request has no number' };
  if (pullChangedNoFiles(pull)) {
    return {
      tasks: 0,
      results: [],
      notes: [`PR #${pull.number} changes no files, so it did not move a task`],
    };
  }
  const merged = Boolean(pull.merged) || action === 'closed' && Boolean(pull.merged_at);
  const eventAt = asDate(
    merged ? pull.merged_at : action === 'opened' ? pull.created_at : pull.updated_at,
    new Date()
  );
  const actor = actorFor(payload.sender && payload.sender.login);
  const workflow = getGithubWorkflow(link);
  const resolved = await resolveTasks({
    project,
    repoFullName: link.repoFullName,
    texts: [taskTextsForPull(pull)],
    pull,
    branch: pull.head && pull.head.ref,
    index,
    activeTasks,
  });
  const results = [];

  if (merged) {
    const prEvent = {
      type: 'pr_merged',
      meta: { number: pull.number, title: pull.title, url: pull.url, branch: pull.branch },
      text: taskTextsForPull(pull),
    };
    await recordEventActivity({
      project,
      actor,
      type: 'pr_merged',
      message: `merged PR #${pull.number} "${pull.title || ''}"`,
      meta: { source: 'github', repo: link.repoFullName, number: pull.number, url: pull.url, githubLogin: payload.sender && payload.sender.login },
      eventAt,
    });
    await notifyPullRequest({ ev: prEvent, project, tasks: activeTasks, index, authorId: actor });

    for (const task of resolved.tasks) {
      const columns = classifyColumns(project.columns);
      let target = columns.done;
      let reason = `PR #${pull.number} merged`;
      if (!workflow.completionOnMerge) {
        target = columns.testing || null;
        reason = `PR #${pull.number} merged, but this project does not complete tasks automatically on merge`;
      } else if (workflow.requireChecksForDone && task.github && task.github.checksConclusion !== 'success') {
        target = columns.testing || null;
        reason = `PR #${pull.number} merged, but required checks have not passed`;
      } else if (workflow.testingBeforeDone && columns.testing && normalize(task.status) !== normalize(columns.testing)) {
        target = columns.testing;
        reason = `PR #${pull.number} merged, but this project requires testing before Done`;
      }
      if (!target) {
        await rememberGithub({ task, pull, checks: task.github && { conclusion: task.github.checksConclusion }, eventAt, eventKey, reason });
        results.push({ status: 'note', note: `${refFor(task._id)}: ${reason}; no suitable column was found, so nothing was moved` });
        continue;
      }
      results.push(await transition({ task, project, targetStatus: target, actor, eventType: 'pr_merged', eventKey, eventAt, reason, pr: pull }));
    }

    try {
      if (typeof ReleaseNote.findOne === 'function') {
        const existing = await ReleaseNote.findOne({ project: project._id, repoFullName: link.repoFullName, prNumber: pull.number });
        if (!existing && typeof ReleaseNote.create === 'function') {
          await ReleaseNote.create({
            project: project._id,
            workspace: project.workspace,
            task: resolved.tasks[0] ? resolved.tasks[0]._id : undefined,
            repoFullName: link.repoFullName,
            prNumber: pull.number,
            prUrl: pull.url,
            title: pull.title || `PR #${pull.number}`,
            summary: String(pull.body || '').split('\n').slice(0, 3).join(' ').slice(0, 1000),
            labels: (payload.pull_request && payload.pull_request.labels || []).map((l) => l && l.name).filter(Boolean),
          });
        }
      }
    } catch (error) {
      console.error('Could not write the release note:', error.message);
    }

    return { eventAt, tasks: resolved.tasks.length, results, notes: resolved.notes };
  }

  if (['opened', 'reopened'].includes(action)) {
    const prEvent = {
      type: 'pr_opened',
      meta: { number: pull.number, title: pull.title, url: pull.url, branch: pull.branch },
      text: taskTextsForPull(pull),
    };
    await recordEventActivity({
      project,
      actor,
      type: 'pr_opened',
      message: `opened PR #${pull.number} "${pull.title || ''}"`,
      meta: { source: 'github', repo: link.repoFullName, number: pull.number, url: pull.url, githubLogin: payload.sender && payload.sender.login },
      eventAt,
    });
    await notifyPullRequest({ ev: prEvent, project, tasks: activeTasks, index, authorId: actor });
  }

  if (action === 'closed' && !merged) {
    for (const task of resolved.tasks) {
      await rememberGithub({ task, pull, eventAt, eventKey, reason: `PR #${pull.number} closed without merging` });
    }
    return { eventAt, tasks: resolved.tasks.length, results, notes: resolved.notes };
  }

  if (action === 'converted_to_draft') {
    for (const task of resolved.tasks) {
      await rememberGithub({ task, pull, eventAt, eventKey, reason: `PR #${pull.number} converted to draft` });
    }
    return { eventAt, tasks: resolved.tasks.length, results, notes: resolved.notes };
  }

  const columns = classifyColumns(project.columns);
  const reviewable = ['opened', 'reopened', 'ready_for_review', 'review_requested', 'edited', 'synchronize'].includes(action);
  const reopen = action === 'synchronize';

  for (const task of resolved.tasks) {
    const currentAt = statusPosition(project.columns, task.status);
    const reviewAt = statusPosition(project.columns, columns.review);
    const inProgressAt = statusPosition(project.columns, columns.inProgress);

    if (!reviewable) {
      await rememberGithub({ task, pull, eventAt, eventKey });
      continue;
    }
    if (reopen && workflow.reopenOnNewCommits && reviewAt != null && currentAt >= reviewAt) {
      results.push(await transition({
        task,
        project,
        targetStatus: columns.inProgress || columns.review,
        actor,
        eventType: 'pr_synchronize',
        eventKey,
        eventAt,
        reason: `new commits pushed to PR #${pull.number}`,
        pr: pull,
        allowReopenDone: false,
      }));
    } else if (!reopen && reviewAt != null && inProgressAt != null && currentAt < reviewAt && !(task.github && task.github.reviewVerdict === 'changes_requested')) {
      results.push(await transition({
        task,
        project,
        targetStatus: columns.review,
        actor,
        eventType: 'pr_opened',
        eventKey,
        eventAt,
        reason: `PR #${pull.number} ${action || 'updated'}`,
        pr: pull,
      }));
    } else {
      await rememberGithub({ task, pull, eventAt, eventKey });
    }
  }

  const shouldReview = reviewable && resolved.tasks.length > 0;
  if (shouldReview) {
    for (const task of resolved.tasks) {
      results.push(await runAndApplyAiReview({
        project,
        link,
        token,
        repoFullName: link.repoFullName,
        task,
        pull,
        actor,
        eventKey,
        eventAt,
        workflow,
      }));
    }
  }

  return { eventAt, tasks: resolved.tasks.length, results, notes: resolved.notes };
}

async function handlePush({ payload, project, link, token, actorFor, activeTasks, index, eventKey }) {
  const branch = String(payload.ref || '').replace(/^refs\/heads\//, '');
  const commits = (Array.isArray(payload.commits) ? payload.commits : []).slice(0, MAX_COMMITS_PER_PUSH);
  const workflow = getGithubWorkflow(link);
  const columns = classifyColumns(project.columns);
  const results = [];
  const notes = new Set();
  const reviewRequested = new Map();

  const sorted = [...commits].sort((a, b) => asDate(a.timestamp, new Date(0)) - asDate(b.timestamp, new Date(0)));
  for (const commit of sorted) {
    const message = String(commit.message || '');
    const eventAt = asDate(commit.timestamp, new Date());
    const actor = actorFor((commit.author && commit.author.username) || payload.sender && payload.sender.login);
    const pull = payload.pull_request ? pullFromPayload(payload) : null;

    if (commitChangedNoFiles(commit)) {
      for (const key of extractRefs(`${message}\n${branch}`)) {
        notes.add(`FS-${key}: commit ${sha7(commit.id)} changes no files, so it did not move the task`);
      }
      continue;
    }

    const resolved = await resolveTasks({
      project,
      repoFullName: link.repoFullName,
      texts: [message, branch],
      pull,
      branch,
      index,
      activeTasks,
    });
    resolved.notes.forEach((note) => notes.add(note));

    await recordEventActivity({
      project,
      actor,
      type: 'commit_pushed',
      message: `committed "${String(message).split('\n')[0].slice(0, 120)}" (${sha7(commit.id)})`,
      task: resolved.tasks[0],
      meta: {
        source: 'github',
        repo: link.repoFullName,
        sha: commit.id,
        url: commit.url,
        branch,
        githubLogin: (commit.author && commit.author.username) || payload.sender && payload.sender.login,
        commitMessage: message.slice(0, 500),
      },
      eventAt,
    });

    for (const task of resolved.tasks) {
      const currentAt = statusPosition(project.columns, task.status);
      const reviewAt = statusPosition(project.columns, columns.review);
      const inProgressAt = statusPosition(project.columns, columns.inProgress);
      if (reviewAt != null && inProgressAt != null && currentAt >= reviewAt && workflow.reopenOnNewCommits) {
        results.push(await transition({
          task,
          project,
          targetStatus: columns.inProgress,
          actor,
          eventType: 'commit_pushed',
          eventKey,
          eventAt,
          reason: `new commit ${sha7(commit.id)} on ${branch || 'the branch'}`,
          pr: pull,
          branch,
        }));
      } else if (inProgressAt != null && currentAt != null && currentAt < inProgressAt) {
        results.push(await transition({
          task,
          project,
          targetStatus: columns.inProgress,
          actor,
          eventType: 'commit_pushed',
          eventKey,
          eventAt,
          reason: `commit ${sha7(commit.id)}`,
          pr: pull,
          branch,
        }));
      } else {
        await rememberGithub({ task, pull, branch, eventAt, eventKey });
      }
      if (task.github && task.github.prNumber && currentAt < statusPosition(project.columns, columns.done)) {
        reviewRequested.set(String(task._id), { task, pull: pull || { number: task.github.prNumber, url: task.github.prUrl, branch: task.github.branch } });
      }
    }
  }

  for (const { task, pull } of reviewRequested.values()) {
    const fullPull = await fetchPullIfNeeded(token, link.repoFullName, pull);
    results.push(await runAndApplyAiReview({
      project,
      link,
      token,
      repoFullName: link.repoFullName,
      task,
      pull: fullPull,
      actor: actorFor(payload.sender && payload.sender.login),
      eventKey,
      eventAt: new Date(),
      workflow,
    }));
  }

  if (commits.length === 0) {
    const resolved = await resolveTasks({
      project,
      repoFullName: link.repoFullName,
      texts: [branch],
      pull: null,
      branch,
      index,
      activeTasks,
    });
    resolved.notes.forEach((note) => notes.add(note));
    for (const task of resolved.tasks) {
      const currentAt = statusPosition(project.columns, task.status);
      const inProgressAt = statusPosition(project.columns, columns.inProgress);
      if (inProgressAt != null && currentAt != null && currentAt < inProgressAt) {
        results.push(await transition({
          task,
          project,
          targetStatus: columns.inProgress,
          actor: actorFor(payload.sender && payload.sender.login),
          eventType: 'commit_pushed',
          eventKey,
          eventAt: new Date(),
          reason: `branch ${branch} created`,
          branch,
        }));
      } else if (inProgressAt != null) {
        await rememberGithub({ task, branch, eventAt: new Date(), eventKey, reason: `branch ${branch} updated` });
      }
    }
  }

  return { tasks: reviewRequested.size, results, notes: [...notes] };
}

async function handleReviewSubmitted({ payload, project, link, token, actorFor, activeTasks, index, eventKey }) {
  const pull = pullFromPayload(payload);
  const review = payload.review || {};
  const state = String(review.state || '').toLowerCase();
  if (pull.number == null) return { ignored: 'review has no pull request' };
  if (pullChangedNoFiles(pull)) {
    return {
      tasks: 0,
      results: [],
      notes: [`PR #${pull.number} changes no files, so the review did not move a task`],
    };
  }
  const eventAt = asDate(review.submitted_at || pull.updated_at, new Date());
  const actor = actorFor((review.user && review.user.login) || payload.sender && payload.sender.login);
  const resolved = await resolveTasks({
    project,
    repoFullName: link.repoFullName,
    texts: [taskTextsForPull(pull)],
    pull,
    branch: pull.head && pull.head.ref,
    index,
    activeTasks,
  });
  const workflow = getGithubWorkflow(link);
  const columns = classifyColumns(project.columns);
  const results = [];

  for (const task of resolved.tasks) {
    await recordEventActivity({
      project,
      actor,
      type: 'review_submitted',
      message: `${state === 'approved' ? 'approved' : state === 'changes_requested' ? 'requested changes on' : 'reviewed'} PR #${pull.number}`,
      task,
      meta: {
        source: 'github',
        repo: link.repoFullName,
        number: pull.number,
        url: pull.url,
        githubLogin: review.user && review.user.login,
        state,
      },
      eventAt,
    });

    await rememberGithub({
      task,
      pull,
      review: { verdict: state || 'reviewed' },
      eventAt,
      eventKey,
      reason: `review ${state || 'submitted'} on PR #${pull.number}`,
    });

    if (state === 'changes_requested') {
      const target = columns.changesRequested || columns.inProgress || columns.review;
      results.push(await transition({
        task,
        project,
        targetStatus: target,
        actor,
        eventType: 'review_submitted',
        eventKey,
        eventAt,
        reason: `changes requested on PR #${pull.number}`,
        pr: pull,
        review: { verdict: 'changes_requested' },
      }));
    } else if (state === 'approved') {
      const checksReady = !workflow.requireChecksForDone || (task.github && task.github.checksConclusion === 'success');
      const target = checksReady && workflow.moveToTestingOnApproval && columns.testing ? columns.testing : columns.review;
      results.push(await transition({
        task,
        project,
        targetStatus: target,
        actor,
        eventType: 'review_submitted',
        eventKey,
        eventAt,
        reason: `PR #${pull.number} approved`,
        pr: pull,
        review: { verdict: 'approved' },
      }));
    }
  }

  return { tasks: resolved.tasks.length, results, notes: resolved.notes };
}

function checkPullNumbers(payload) {
  const sources = [payload.check_run, payload.check_suite, payload.workflow_run, payload.check_run && payload.check_run.check_suite];
  const numbers = new Set();
  for (const source of sources) {
    for (const pr of (source && source.pull_requests) || []) {
      if (pr && pr.number != null) numbers.add(pr.number);
    }
  }
  return [...numbers];
}

async function handleCheck({ payload, project, link, token, actorFor, activeTasks, index, eventKey }) {
  const check = payload.check_run || payload.check_suite || payload.workflow_run || {};
  const conclusion = String(check.conclusion || '').toLowerCase();
  const status = String(check.status || '').toLowerCase();
  const branch = check.head_branch
    || (check.check_suite && check.check_suite.head_branch)
    || (payload.workflow_run && payload.workflow_run.head_branch);
  const eventAt = asDate(check.completed_at || check.started_at || check.updated_at, new Date());
  const actor = actorFor(payload.sender && payload.sender.login);
  const workflow = getGithubWorkflow(link);
  const columns = classifyColumns(project.columns);
  const results = [];
  const notes = new Set();
  const seen = new Set();

  const numbers = checkPullNumbers(payload);
  const pullContexts = numbers.map((number) => ({ number }));
  if (pullContexts.length === 0 && branch) {
    const saved = await savedTaskIds({ project, repoFullName: link.repoFullName, branch });
    for (const id of saved) {
      const task = activeTasks.find((t) => String(t._id) === String(id));
      if (task && task.github && task.github.prNumber) pullContexts.push({ number: task.github.prNumber });
    }
  }

  for (const context of pullContexts) {
    const pull = await fetchPullIfNeeded(token, link.repoFullName, context);
    const resolved = await resolveTasks({
      project,
      repoFullName: link.repoFullName,
      texts: [taskTextsForPull(pull)],
      pull,
      branch,
      index,
      activeTasks,
    });
    resolved.notes.forEach((note) => notes.add(note));

    for (const task of resolved.tasks) {
      if (seen.has(String(task._id))) continue;
      seen.add(String(task._id));
      await rememberGithub({
        task,
        pull,
        checks: { conclusion: conclusion || status },
        eventAt,
        eventKey,
        reason: `checks ${conclusion || status || 'updated'} on PR #${pull.number}`,
      });

      if (['failure', 'timed_out', 'action_required', 'cancelled'].includes(conclusion)) {
        const target = columns.changesRequested || columns.inProgress || columns.review;
        results.push(await transition({
          task,
          project,
          targetStatus: target,
          actor,
          eventType: 'checks_failed',
          eventKey,
          eventAt,
          reason: `CI checks ${conclusion} on PR #${pull.number}`,
          pr: pull,
          checks: { conclusion },
        }));
      } else if (conclusion === 'success' && task.github && task.github.reviewStatus === 'approved' && workflow.moveToTestingOnApproval && columns.testing) {
        results.push(await transition({
          task,
          project,
          targetStatus: columns.testing,
          actor,
          eventType: 'checks_passed',
          eventKey,
          eventAt,
          reason: `checks passed and PR #${pull.number} is approved`,
          pr: pull,
          checks: { conclusion },
        }));
      }
    }
  }

  return { tasks: seen.size, results, notes: [...notes] };
}

async function processGithubEvent({ event, payload, deliveryId }) {
  const repoFullName = payload.repository && payload.repository.full_name;
  if (!repoFullName) return { ignored: 'payload has no repository' };

  const link = await findLinkedRepository(repoFullName);
  if (!link) return { ignored: `${repoFullName} is not linked to a FlowSync project` };
  const project = await Project.findById(link.project);
  if (!project) return { ignored: 'the linked project no longer exists' };
  if (project.isArchived) return { ignored: 'the linked project is archived' };

  const token = tokenFor(link);
  const actorFor = await actorResolver(project, link);
  const activeTasks = await loadActiveTasks(project);
  const index = makeTaskIndex(activeTasks);
  const eventKey = `webhook:${deliveryId}`;
  const base = { project, link, token, actorFor, activeTasks, index, eventKey };

  if (event === 'push') return handlePush({ ...base, payload });
  if (event === 'pull_request') return handlePullRequest({ ...base, payload });
  if (event === 'pull_request_review') return handleReviewSubmitted({ ...base, payload });
  if (event === 'check_run' || event === 'check_suite' || event === 'workflow_run') {
    return handleCheck({ ...base, payload });
  }
  return { ignored: `event "${event}" does not change the Kanban board` };
}

// Stores the delivery key before doing any work. If processing fails the key is removed, so a
// GitHub redelivery can retry the event instead of being treated as a duplicate.
async function processWithIdempotency({ event, payload, deliveryId }) {
  const repoFullName = payload.repository && payload.repository.full_name;
  if (!repoFullName) return { success: true, ignored: 'payload has no repository' };

  const link = await findLinkedRepository(repoFullName);
  if (!link) return { success: true, ignored: `${repoFullName} is not linked to a FlowSync project` };

  const key = `webhook:${deliveryId}`;
  try {
    await GithubEvent.create({ project: link.project, key });
  } catch (error) {
    if (error && error.code === 11000) return { success: true, duplicate: true };
    throw error;
  }

  try {
    const result = await processGithubEvent({ event, payload, deliveryId });
    return { success: true, processed: result };
  } catch (error) {
    try {
      await GithubEvent.deleteOne({ project: link.project, key });
    } catch (cleanupError) {
      console.error('Could not remove the failed webhook delivery key:', cleanupError.message);
    }
    throw error;
  }
}

function deliveryIdFor(headers, rawBody) {
  const header = headers && (headers['x-github-delivery'] || headers['X-GitHub-Delivery']);
  if (header) return String(header);
  return crypto.createHash('sha256').update(rawBody || Buffer.from('')).digest('hex');
}

async function reviewHistory(projectId, { taskId, prNumber, limit = 20 } = {}) {
  const query = { project: projectId };
  if (taskId) query.task = taskId;
  if (prNumber != null) query.prNumber = Number(prNumber);
  return GithubReview.find(query).sort({ reviewedAt: -1 }).limit(Math.min(Math.max(Number(limit) || 20, 1), 100)).lean();
}

module.exports = {
  findLinkedRepository,
  processGithubEvent,
  processWithIdempotency,
  deliveryIdFor,
  resolveTasks,
  reviewHistory,
};
