const { postBotMessage } = require('./chatBot');
const Task = require('../models/Task');
const ActivityLog = require('../models/ActivityLog');
const { publish } = require('./activityBus');
const { categoryFor } = require('./activity');
const { DONE_STATUS } = require('./analyticsMath');

// A task is referenced as FS-xxxxxx, where xxxxxx is the last 6 characters of its id.
// Put it in a commit message, a branch name or a pull request title / description.
const REF_PATTERN = /\bFS-([0-9a-f]{6})\b/gi;

// What each kind of GitHub event does to the task it mentions.
const TARGET_BY_EVENT = {
  commit_pushed: 'In Progress',
  pr_opened: 'Review',
  pr_merged: 'Done',
};

const refFor = (taskId) => 'FS-' + String(taskId).slice(-6).toLowerCase();

function extractRefs(text) {
  const found = new Set();
  for (const match of String(text || '').matchAll(REF_PATTERN)) found.add(match[1].toLowerCase());
  return [...found];
}

// last-6-characters -> [task ids]. Normally one id; more than one means the reference is ambiguous.
function makeTaskIndex(tasks) {
  const index = new Map();
  for (const t of tasks || []) {
    const key = String(t._id).slice(-6).toLowerCase();
    index.set(key, [...(index.get(key) || []), t._id]);
  }
  return index;
}

// Writes one entry to the activity log and pushes it to the live stream.
async function recordActivity({ workspace, project, actor, type, message, task, taskTitle, meta, createdAt }) {
  const doc = await ActivityLog.create({
    workspace,
    project,
    actor,
    type,
    category: categoryFor(type),
    message,
    task,
    taskTitle,
    meta,
    createdAt,
  });
  await doc.populate('actor', 'name email');
  publish(doc.toObject());
  return doc;
}

function describeTrigger(ev) {
  if (ev.type === 'commit_pushed') return `commit ${String((ev.meta && ev.meta.sha) || '').slice(0, 7)}`;
  if (ev.type === 'pr_opened') return `PR #${ev.meta && ev.meta.number} opened`;
  return `PR #${ev.meta && ev.meta.number} merged`;
}

// Moves one task forward because of one GitHub event. Tasks only ever move FORWARD
// automatically (a later commit never pulls a task back out of Review or Done).
async function moveTask({ ev, project, taskId, actor, ref, viaAuthor = false }) {
  const target = TARGET_BY_EVENT[ev.type];
  if (!target) return { status: 'ignored' };

  const columns = project.columns || [];
  const targetIndex = columns.indexOf(target);
  if (targetIndex === -1) {
    return { status: 'note', note: `${ref}: this project has no "${target}" column, so the task was not moved` };
  }

  const task = await Task.findById(taskId);
  if (!task || task.isArchived) {
    return { status: 'note', note: `${ref}: that task was archived or deleted, so nothing was moved` };
  }

  const currentIndex = columns.indexOf(task.status);
  const alreadyThere = target === DONE_STATUS ? task.status === DONE_STATUS : currentIndex >= targetIndex;
  if (alreadyThere) return { status: 'unchanged' };

  const previousStatus = task.status;
  const last = await Task.findOne({ project: project._id, status: target }).sort({ position: -1 }).select('position');
  task.status = target;
  task.position = last ? last.position + 1 : 0;
  task.completedAt = target === DONE_STATUS ? task.completedAt || ev.date : undefined;
  await task.save();

  const done = target === DONE_STATUS;
  const because = describeTrigger(ev) + (viaAuthor ? ', matched by author' : '');
  await recordActivity({
    workspace: project.workspace,
    project: project._id,
    actor,
    type: done ? 'task_completed' : 'task_status_changed',
    message: done
      ? `completed "${task.title}" (${because})`
      : `moved "${task.title}" from ${previousStatus} to ${target} (${because})`,
    task: task._id,
    taskTitle: task.title,
    meta: {
      from: previousStatus,
      to: target,
      source: 'github',
      auto: true,
      trigger: ev.type,
      ref,
      via: viaAuthor ? 'author' : 'reference',
      url: ev.meta && ev.meta.url,
    },
    // one millisecond after the commit / PR, so the move sits right above it in the feed
    createdAt: new Date(ev.date.getTime() + 1),
  });
  // FR30: tell the project's chat (never throws, not waited for)
  if (done) postBotMessage({ workspace: project.workspace, project: project._id, actor, kind: 'task_done', text: `✅ "${task.title}" is Done (${because})` });

  return { status: 'moved', moved: { ref, title: task.title, from: previousStatus, to: target, because } };
}

// Looks for task references in one GitHub event and moves the tasks it finds.
async function applyEventToTasks({ ev, project, index, actor }) {
  const moved = [];
  const notes = [];
  for (const key of extractRefs(ev.text)) {
    const ref = 'FS-' + key;
    const ids = index.get(key) || [];
    if (ids.length === 0) {
      notes.push(`${ref} matches no active task in this project`);
      continue;
    }
    if (ids.length > 1) {
      notes.push(`${ref} matches more than one task, so nothing was moved`);
      continue;
    }
    const result = await moveTask({ ev, project, taskId: ids[0], actor, ref });
    if (result.status === 'moved') moved.push(result.moved);
    else if (result.status === 'note') notes.push(result.note);
  }
  return { moved, notes };
}

// A commit with NO task reference. If we know who made it (their GitHub username is on a FlowSync
// profile) we can still link it, but only when that is unambiguous:
//   - the person is already working on something (a task of theirs in In Progress or later): do nothing,
//   - they have exactly ONE task waiting in To Do: move it to In Progress,
//   - they have several waiting: do not guess, say so in the sync message.
// Pull requests are never linked this way, only plain commits. GITHUB_AUTHOR_FALLBACK=false turns it off.
const WAITING_COLUMN = 'To Do';

function authorFallbackEnabled() {
  return String(process.env.GITHUB_AUTHOR_FALLBACK || '').trim().toLowerCase() !== 'false';
}

// tasks: [{ _id, assignee, status }]. Updated in place when a task is moved, so later commits in the
// same sync see the new state.
async function applyAuthorFallback({ ev, project, tasks, userId }) {
  const nothing = { moved: [], notes: [] };
  if (!authorFallbackEnabled() || ev.type !== 'commit_pushed' || !userId) return nothing;
  if (extractRefs(ev.text).length > 0) return nothing; // an explicit reference always wins

  const columns = project.columns || [];
  const startedIndex = columns.indexOf(TARGET_BY_EVENT.commit_pushed);
  if (startedIndex === -1 || !columns.includes(WAITING_COLUMN)) return nothing;

  const mine = (tasks || []).filter((t) => t.assignee && String(t.assignee) === String(userId) && t.status !== DONE_STATUS);
  if (mine.some((t) => columns.indexOf(t.status) >= startedIndex)) return nothing; // already working on one
  const waiting = mine.filter((t) => t.status === WAITING_COLUMN);
  if (waiting.length === 0) return nothing;

  if (waiting.length > 1) {
    const sha = String((ev.meta && ev.meta.sha) || '').slice(0, 7);
    return {
      moved: [],
      notes: [`Commit ${sha} has no task reference and @${ev.login} has ${waiting.length} tasks in ${WAITING_COLUMN}, so nothing was moved. Add a reference such as ${refFor(waiting[0]._id)} to the commit message.`],
    };
  }

  const task = waiting[0];
  const result = await moveTask({ ev, project, taskId: task._id, actor: userId, ref: refFor(task._id), viaAuthor: true });
  if (result.status === 'moved') {
    task.status = result.moved.to;
    return { moved: [result.moved], notes: [] };
  }
  return { moved: [], notes: result.note ? [result.note] : [] };
}

module.exports = {
  applyAuthorFallback,
  authorFallbackEnabled,
  refFor,
  extractRefs,
  makeTaskIndex,
  recordActivity,
  moveTask,
  applyEventToTasks,
  TARGET_BY_EVENT,
};
