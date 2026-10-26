const Task = require('../models/Task');
const ActivityLog = require('../models/ActivityLog');
const { publish } = require('../utils/activityBus');
const { categoryFor } = require('../utils/activity');
const { DONE_STATUS } = require('../utils/analyticsMath');
const { postBotMessage } = require('../utils/chatBot');

// FlowSync's default board is Backlog, To Do, In Progress, Review, Testing, Done. Projects can
// rename or remove columns, so automatic transitions look a column up by a short list of
// equivalent names instead of creating duplicate columns.
const COLUMN_ALIASES = {
  backlog: ['backlog', 'icebox', 'ideas'],
  todo: ['to do', 'todo', 'to-do', 'ready', 'selected for development', 'planned'],
  inProgress: ['in progress', 'in-progress', 'doing', 'development', 'working', 'started'],
  review: ['review', 'in review', 'code review', 'under review', 'pr review'],
  changesRequested: ['changes requested', 'change requested', 'needs changes', 'needs work', 'requested changes', 'rework'],
  testing: ['testing', 'in testing', 'test', 'qa', 'verification', 'acceptance testing'],
  done: ['done', 'completed', 'complete', 'closed', 'released'],
};

const normalize = (value) => String(value == null ? '' : value).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

function findColumn(columns, kind, preferred) {
  const list = Array.isArray(columns) ? columns : [];
  if (preferred) {
    const exact = list.find((column) => normalize(column) === normalize(preferred));
    if (exact) return exact;
  }
  const aliases = COLUMN_ALIASES[kind] || [];
  return list.find((column) => aliases.includes(normalize(column))) || null;
}

// The board may use different names; expose the actual columns once so every rule agrees.
function classifyColumns(columns) {
  return {
    backlog: findColumn(columns, 'backlog'),
    todo: findColumn(columns, 'todo'),
    inProgress: findColumn(columns, 'inProgress'),
    review: findColumn(columns, 'review'),
    changesRequested: findColumn(columns, 'changesRequested'),
    testing: findColumn(columns, 'testing'),
    done: findColumn(columns, 'done', DONE_STATUS),
  };
}

const isDoneStatus = (columns, status) => {
  const done = classifyColumns(columns).done;
  return Boolean(done) && normalize(status) === normalize(done);
};

// The workflow lives on the linked repository. Missing values fall back to the historic
// FlowSync behaviour (merging is enough to finish, unless testing/checks are explicitly required).
function getGithubWorkflow(link) {
  const workflow = (link && link.workflow) || {};
  const envThreshold = String(process.env.GITHUB_REVIEW_SEVERITY || '').trim().toLowerCase();
  const envConfidenceRaw = String(process.env.GITHUB_REVIEW_MIN_CONFIDENCE || '').trim();
  const envConfidence = envConfidenceRaw ? Number(envConfidenceRaw) : NaN;
  return {
    completionOnMerge: workflow.completionOnMerge !== false,
    requireChecksForDone: workflow.requireChecksForDone === true,
    testingBeforeDone: workflow.testingBeforeDone === true,
    moveToTestingOnApproval: workflow.moveToTestingOnApproval !== false,
    reopenOnNewCommits: workflow.reopenOnNewCommits !== false,
    reviewSeverityThreshold: workflow.reviewSeverityThreshold || (['low', 'medium', 'high', 'critical'].includes(envThreshold) ? envThreshold : 'high'),
    reviewConfidenceThreshold: Number.isFinite(workflow.reviewConfidenceThreshold)
      ? workflow.reviewConfidenceThreshold
      : (Number.isFinite(envConfidence) ? Math.min(Math.max(envConfidence, 0), 1) : 0.7),
  };
}

function statusPosition(columns, status) {
  const list = Array.isArray(columns) ? columns : [];
  const at = list.findIndex((column) => normalize(column) === normalize(status));
  return at === -1 ? null : at;
}

function metaForTransition({ eventType, source, ref, viaAuthor, pr, branch, review, checks, reason, eventAt, eventKey, from, to, extraMeta }) {
  return {
    from,
    to,
    source: source || 'github',
    auto: true,
    trigger: eventType,
    ref,
    via: viaAuthor ? 'author' : 'reference',
    reason,
    eventAt: eventAt || null,
    eventKey: eventKey || null,
    prNumber: pr && pr.number,
    prUrl: pr && (pr.url || pr.html_url),
    url: (pr && (pr.url || pr.html_url)) || (extraMeta && extraMeta.url),
    branch: branch || (pr && pr.branch) || (pr && pr.head && pr.head.ref),
    reviewVerdict: review && review.verdict,
    reviewSummary: review && review.summary,
    reviewId: review && review._id,
    checksConclusion: checks && checks.conclusion,
    ...(extraMeta || {}),
  };
}

// Writes the transition to the existing activity history (and live SSE stream). The activity
// record is the audit trail: it keeps the source, PR, previous/new status, time and any review
// or CI result that justified the move.
async function recordTransitionActivity({
  workspace,
  project,
  actor,
  task,
  type,
  message,
  meta,
  createdAt,
}) {
  try {
    const doc = await ActivityLog.create({
      workspace,
      project,
      actor,
      type,
      category: categoryFor(type),
      message,
      task: task._id || task,
      taskTitle: task.title,
      meta,
      createdAt,
    });
    if (doc && typeof doc.populate === 'function') await doc.populate('actor', 'name email');
    if (doc) publish(typeof doc.toObject === 'function' ? doc.toObject() : doc);
    return doc;
  } catch (error) {
    console.error('recordTransitionActivity() failed:', error.message);
    return null;
  }
}

// Central, deterministic status transition. Every automatic GitHub move goes through here:
//  - validates the target column against the project's board,
//  - does nothing when the task is already there,
//  - refuses stale/out-of-order events,
//  - refuses to reopen a manually completed task,
//  - records the reason and evidence in the task activity history.
async function applyStatusTransition({
  task,
  project,
  targetStatus,
  actor,
  eventType,
  eventKey,
  eventAt,
  reason,
  source = 'github',
  pr,
  branch,
  review,
  checks,
  ref,
  viaAuthor = false,
  message,
  activityType,
  announce = true,
  allowReopenDone = false,
  extraMeta,
}) {
  if (!task || !project) return { status: 'ignored', reason: 'task or project missing' };

  const columns = Array.isArray(project.columns) ? project.columns : [];
  const target = columns.find((column) => normalize(column) === normalize(targetStatus));
  if (!target) {
    return {
      status: 'note',
      note: `this project has no "${targetStatus}" column, so the task was not moved`,
      reason: `missing column: ${targetStatus}`,
    };
  }

  const currentStatus = task.status;
  if (normalize(currentStatus) === normalize(target)) {
    return { status: 'unchanged', reason: 'already in the target column' };
  }

  const when = eventAt ? new Date(eventAt) : new Date();
  const validWhen = Number.isNaN(when.getTime()) ? new Date() : when;
  const priorGithub = task.github && typeof task.github.toObject === 'function'
    ? task.github.toObject()
    : { ...(task.github || {}) };
  const lastEventAt = priorGithub.lastEventAt ? new Date(priorGithub.lastEventAt) : null;

  // A late webhook (from a push that already happened before the current state) must not
  // overwrite a newer transition.
  if (lastEventAt && validWhen.getTime() < lastEventAt.getTime()) {
    return {
      status: 'stale',
      reason: `event is older than the last GitHub event (${lastEventAt.toISOString()})`,
    };
  }

  const currentDone = isDoneStatus(columns, currentStatus);
  const targetDone = isDoneStatus(columns, target);
  if (currentDone && !targetDone && !allowReopenDone) {
    return {
      status: 'blocked',
      reason: 'the task was completed manually and automatic events do not reopen it',
    };
  }
  // Preserve manual completion even when the event would target the same Done column: there is
  // nothing to move, handled above. This branch is for custom "Completed" style columns.
  if (currentDone && targetDone) return { status: 'unchanged', reason: 'task is already complete' };

  const last = await Task.findOne({ project: project._id, status: target }).sort({ position: -1 }).select('position');
  task.status = target;
  task.position = last ? (Number(last.position) || 0) + 1 : 0;
  task.statusSource = 'github';
  task.completedAt = targetDone ? (task.completedAt || validWhen) : undefined;
  task.github = {
    ...priorGithub,
    ...(pr && pr.number ? { prNumber: pr.number } : {}),
    ...(pr && (pr.url || pr.html_url) ? { prUrl: pr.url || pr.html_url } : {}),
    ...(branch || (pr && pr.branch) || (pr && pr.head && pr.head.ref) ? { branch: branch || (pr && pr.branch) || (pr && pr.head && pr.head.ref) } : {}),
    lastEventAt: validWhen,
    ...(eventKey ? { lastEventKey: eventKey } : {}),
    ...(review && review.verdict ? { reviewStatus: review.verdict, reviewVerdict: review.verdict } : {}),
    ...(checks && checks.conclusion ? { checksConclusion: checks.conclusion } : {}),
    lastTransitionAt: new Date(),
    lastTransitionReason: reason,
  };
  await task.save();

  const meta = metaForTransition({
    eventType,
    source,
    ref,
    viaAuthor,
    pr,
    branch,
    review,
    checks,
    reason,
    eventAt: validWhen,
    eventKey,
    from: currentStatus,
    to: target,
    extraMeta,
  });
  const type = activityType || (targetDone ? 'task_completed' : 'task_status_changed');
  const text = message || (targetDone
    ? `completed "${task.title}" (${reason})`
    : `moved "${task.title}" from ${currentStatus} to ${target} (${reason})`);

  await recordTransitionActivity({
    workspace: project.workspace,
    project: project._id,
    actor,
    task,
    type,
    message: text,
    meta,
    // one millisecond after the GitHub event, so the move sits right above it in the feed
    createdAt: new Date(validWhen.getTime() + 1),
  });

  if (targetDone && announce) {
    postBotMessage({
      workspace: project.workspace,
      project: project._id,
      actor,
      kind: 'task_done',
      text: `✅ "${task.title}" is Done (${reason})`,
    });
  }

  return {
    status: 'moved',
    moved: { ref, title: task.title, from: currentStatus, to: target, because: reason },
    reason,
    from: currentStatus,
    to: target,
  };
}

module.exports = {
  COLUMN_ALIASES,
  normalize,
  findColumn,
  classifyColumns,
  isDoneStatus,
  getGithubWorkflow,
  statusPosition,
  applyStatusTransition,
  recordTransitionActivity,
};
