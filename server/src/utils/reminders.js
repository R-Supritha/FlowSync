const Task = require('../models/Task');
const Notification = require('../models/Notification');
const { notify } = require('./notify');

// FR10: deadline reminders. For tasks assigned to one person that are due within the next 24 hours
// ("deadline_approaching") or already late ("deadline_overdue"), they get an in-app notification.
// Each task gets at most one of each kind per due date, so opening the app again never repeats it,
// and moving the deadline starts fresh. Tasks that are Done or archived never remind.
// The person's "due dates" preference in Settings is honoured by notify().
const SOON_MS = 24 * 60 * 60 * 1000;
const DONE_STATUS = 'Done';
const MIN_GAP_MS = 5 * 60 * 1000; // look at most once per 5 minutes per person

const lastRun = new Map();

const dayOf = (date) => new Date(date).toISOString().slice(0, 10);

function describeLeft(deadline, now) {
  const hours = Math.max(1, Math.round((new Date(deadline) - now) / 3600000));
  return hours <= 1 ? 'less than an hour' : `${hours} hours`;
}

async function createDeadlineReminders(userId, { now = new Date(), force = false } = {}) {
  const key = String(userId);
  if (!force && now - (lastRun.get(key) || 0) < MIN_GAP_MS) return 0;
  lastRun.set(key, now.getTime());

  const tasks = await Task.find({
    assignee: userId,
    isArchived: false,
    status: { $ne: DONE_STATUS },
    deadline: { $ne: null, $lte: new Date(now.getTime() + SOON_MS) },
  })
    .select('title deadline project workspace')
    .lean();

  let created = 0;
  for (const task of tasks) {
    const late = new Date(task.deadline) < now;
    const type = late ? 'deadline_overdue' : 'deadline_approaching';
    const onceKey = `deadline:${task._id}:${dayOf(task.deadline)}:${late ? 'late' : 'soon'}`;
    const exists = await Notification.findOne({ user: userId, key: onceKey }).select('_id').lean();
    if (exists) continue;
    const message = late
      ? `"${task.title}" is overdue (it was due ${dayOf(task.deadline)})`
      : `"${task.title}" is due in ${describeLeft(task.deadline, now)}`;
    const made = await notify({
      user: userId,
      actor: null, // a system reminder: it can reach the person who assigned it to themselves
      type,
      message,
      link: { workspace: task.workspace, project: task.project, task: task._id },
      key: onceKey,
    });
    if (made) created += 1;
  }
  return created;
}

const resetReminderThrottle = () => lastRun.clear();

module.exports = { createDeadlineReminders, resetReminderThrottle, SOON_MS };
