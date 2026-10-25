const ActivityLog = require('../models/ActivityLog');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const { publish } = require('./activityBus');
const { dayKey, DONE_STATUS } = require('./analyticsMath');

// Which colour of the weekly timeline (FR16) an event type counts towards.
const CATEGORY_BY_TYPE = {
  task_completed: 'completed',
  commit_pushed: 'completed',
  pr_merged: 'completed',
  comment_added: 'collaboration',
  review_submitted: 'collaboration',
  pr_opened: 'collaboration',
  task_created: 'planning',
  task_updated: 'planning',
  task_status_changed: 'planning',
  task_assigned: 'planning',
  task_deleted: 'planning',
  file_uploaded: 'planning',
  issue_opened: 'planning',
  issue_closed: 'completed',
  release_published: 'completed',
};

// [singular, plural] wording for the "5 commits, 2 tasks completed" summaries.
const LABELS = {
  task_completed: ['task completed', 'tasks completed'],
  commit_pushed: ['commit', 'commits'],
  pr_merged: ['PR merged', 'PRs merged'],
  pr_opened: ['PR opened', 'PRs opened'],
  review_submitted: ['review', 'reviews'],
  comment_added: ['comment', 'comments'],
  task_created: ['task created', 'tasks created'],
  task_updated: ['task updated', 'tasks updated'],
  task_status_changed: ['status change', 'status changes'],
  task_assigned: ['task assigned', 'tasks assigned'],
  file_uploaded: ['file uploaded', 'files uploaded'],
  task_deleted: ['task deleted', 'tasks deleted'],
  issue_opened: ['issue opened', 'issues opened'],
  issue_closed: ['issue closed', 'issues closed'],
  release_published: ['release', 'releases'],
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const categoryFor = (type) => CATEGORY_BY_TYPE[type] || 'planning';

function countByCategory(events) {
  const counts = { completed: 0, collaboration: 0, planning: 0 };
  for (const e of events) counts[e.category || categoryFor(e.type)] += 1;
  return counts;
}

// Green > yellow > blue > gray: the most "finished" kind of work on a day wins the dot colour.
function colorFor(counts) {
  if (counts.completed > 0) return 'green';
  if (counts.collaboration > 0) return 'yellow';
  if (counts.planning > 0) return 'blue';
  return 'gray';
}

// "5 commits, 2 tasks completed, 1 PR opened"
function summarize(events) {
  const tally = {};
  for (const e of events) tally[e.type] = (tally[e.type] || 0) + 1;
  const order = Object.keys(LABELS);
  const parts = Object.keys(tally)
    .sort((a, b) => tally[b] - tally[a] || order.indexOf(a) - order.indexOf(b))
    .map((type) => {
      const [one, many] = LABELS[type] || [type, type];
      return `${tally[type]} ${tally[type] === 1 ? one : many}`;
    });
  return parts.length ? parts.join(', ') : 'No recorded activity';
}

// Seven dots (Mon-Sun) for the week starting at `weekStart`.
function buildWeek(events, weekStart) {
  const byDay = {};
  for (const e of events) {
    const key = dayKey(e.createdAt);
    (byDay[key] = byDay[key] || []).push(e);
  }
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const key = dayKey(d);
    const list = byDay[key] || [];
    const counts = countByCategory(list);
    days.push({ date: key, day: DAY_NAMES[d.getDay()], color: colorFor(counts), counts, total: list.length, summary: summarize(list) });
  }
  return days;
}

// Fire-and-forget like notify(): a failed log must never break the action that triggered it.
async function logActivity({ workspace, project, actor, type, message, task, taskTitle, meta }) {
  try {
    if (!workspace || !project || !actor) return null;
    const doc = await ActivityLog.create({
      workspace,
      project,
      actor,
      type,
      category: categoryFor(type),
      message,
      task: task ? task._id || task : undefined,
      taskTitle: taskTitle || (task && task.title) || undefined,
      meta,
    });
    await doc.populate('actor', 'name email');
    publish(doc.toObject());
    return doc;
  } catch (error) {
    console.error('logActivity() failed:', error.message);
    return null;
  }
}

// Status moves: reaching "Done" is a completion, anything else is a plain status change.
function logTaskStatusChange({ task, project, actor, previousStatus }) {
  if (task.status === previousStatus) return null;
  const done = task.status === DONE_STATUS;
  return logActivity({
    workspace: project.workspace,
    project: project._id,
    actor,
    type: done ? 'task_completed' : 'task_status_changed',
    message: done ? `completed "${task.title}"` : `moved "${task.title}" from ${previousStatus} to ${task.status}`,
    task,
    meta: { from: previousStatus, to: task.status },
  });
}

// Files can belong to a project, a task or a comment; work out the project for the feed.
async function logFileUploaded(asset, actor) {
  try {
    let projectId = asset.project;
    let task = null;
    if (asset.task) {
      task = await Task.findById(asset.task).select('title project');
    } else if (asset.comment) {
      const comment = await Comment.findById(asset.comment).select('task');
      if (comment) task = await Task.findById(comment.task).select('title project');
    }
    if (!projectId && task) projectId = task.project;
    if (!projectId) return null;

    return await logActivity({
      workspace: asset.workspace,
      project: projectId,
      actor,
      type: 'file_uploaded',
      message: `uploaded "${asset.originalName}"`,
      task: task || undefined,
      meta: { fileId: asset._id },
    });
  } catch (error) {
    console.error('logFileUploaded() failed:', error.message);
    return null;
  }
}

module.exports = {
  categoryFor,
  countByCategory,
  colorFor,
  summarize,
  buildWeek,
  logActivity,
  logTaskStatusChange,
  logFileUploaded,
};