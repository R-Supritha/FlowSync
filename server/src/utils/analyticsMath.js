const { weekRange } = require('./dateRange');

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATUS = 'Done';

const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Local-time YYYY-MM-DD (matches how dateRange.js buckets weeks).
function dayKey(date) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 'YYYY-MM-DD' -> local midnight (avoids the UTC shift of new Date('2026-10-07')).
// Anything else goes through new Date(). Returns null if invalid, today if empty.
function parseDay(value) {
  if (!value) return startOfDay(new Date());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

const isDone = (t) => t.status === DONE_STATUS;
const doneAt = (t) => new Date(t.completedAt || t.updatedAt || t.createdAt);

// Completed tasks/hours per Monday-start week, oldest -> newest, ending with the current week.
function weeklyVelocity(tasks, weeks, now = new Date()) {
  const thisWeek = weekRange(now).start;
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    buckets.push({ start: addDays(thisWeek, -7 * i), completedTasks: 0, completedHours: 0 });
  }
  for (const t of tasks) {
    if (!isDone(t)) continue;
    const at = doneAt(t);
    const bucket = buckets.find((b) => at >= b.start && at < addDays(b.start, 7));
    if (bucket) {
      bucket.completedTasks += 1;
      bucket.completedHours += t.estimatedHours || 0;
    }
  }
  return buckets.map((b) => ({
    weekStart: dayKey(b.start),
    completedTasks: b.completedTasks,
    completedHours: round(b.completedHours),
  }));
}

function averageCompletion(tasks) {
  const durations = tasks
    .filter(isDone)
    .map((t) => (doneAt(t) - new Date(t.createdAt)) / 3600000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  if (!durations.length) return { completedTasks: 0, averageHours: null, averageDays: null };
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return { completedTasks: durations.length, averageHours: round(avg), averageDays: round(avg / 24) };
}

// One point per day: scope (burnup total), completed (burnup), remaining (burndown),
// plus an `ideal` burndown line when the project has a deadline.
function burnSeries(tasks, start, end, unit = 'tasks', deadline = null) {
  const weight = (t) => (unit === 'hours' ? t.estimatedHours || 0 : 1);
  const last = startOfDay(end);
  let first = startOfDay(start);
  if (first > last) first = last;
  if (Math.round((last - first) / DAY_MS) > 366) first = addDays(last, -366);

  const series = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const endOfDay = addDays(d, 1);
    let scope = 0;
    let completed = 0;
    for (const t of tasks) {
      if (new Date(t.createdAt) >= endOfDay) continue;
      const w = weight(t);
      scope += w;
      if (isDone(t) && doneAt(t) < endOfDay) completed += w;
    }
    series.push({ date: dayKey(d), scope: round(scope), completed: round(completed), remaining: round(scope - completed) });
  }

  if (deadline && series.length) {
    const span = Math.round((startOfDay(deadline) - first) / DAY_MS);
    if (span > 0) {
      const startRemaining = series[0].remaining;
      series.forEach((p, i) => {
        p.ideal = round(Math.max(0, startRemaining * (1 - i / span)));
      });
    }
  }
  return series;
}

// Open work per assignee. `overloaded` = clearly above the team average.
function workload(openTasks, doneTasks, now = new Date()) {
  const rows = new Map();
  const row = (key) => {
    if (!rows.has(key)) {
      rows.set(key, { assignee: key === 'unassigned' ? null : key, openTasks: 0, openHours: 0, overdueTasks: 0, completedTasks: 0 });
    }
    return rows.get(key);
  };
  for (const t of openTasks) {
    const r = row(t.assignee ? String(t.assignee) : 'unassigned');
    r.openTasks += 1;
    r.openHours += t.estimatedHours || 0;
    if (t.deadline && new Date(t.deadline) < now) r.overdueTasks += 1;
  }
  for (const t of doneTasks) {
    row(t.assignee ? String(t.assignee) : 'unassigned').completedTasks += 1;
  }

  const list = [...rows.values()];
  const assigned = list.filter((r) => r.assignee && r.openTasks > 0);
  const useHours = assigned.some((r) => r.openHours > 0);
  const load = (r) => (useHours ? r.openHours : r.openTasks);
  const avg = assigned.length ? assigned.reduce((s, r) => s + load(r), 0) / assigned.length : 0;

  list.forEach((r) => {
    r.overloaded = Boolean(r.assignee) && assigned.length >= 2 && r.openTasks >= 3 && load(r) > 1.5 * avg;
  });
  list.sort((a, b) => load(b) - load(a));
  list.forEach((r) => {
    r.openHours = round(r.openHours);
  });
  return list;
}

// Open tasks unlikely to finish on time, with the reasons why.
function deadlineRisk(openTasks, allTasks, columns, now = new Date(), riskDays = 3) {
  const byId = new Map(allTasks.map((t) => [String(t._id), t]));
  const notStartedBelow = Math.max(1, Math.floor(columns.length / 3));
  const risky = [];

  for (const t of openTasks) {
    if (!t.deadline) continue;
    const dl = new Date(t.deadline);
    const daysLeft = (dl - now) / DAY_MS;
    const reasons = [];

    if (dl < now) {
      reasons.push('overdue');
    } else {
      const idx = columns.indexOf(t.status);
      if (daysLeft <= riskDays && idx !== -1 && idx < notStartedBelow) {
        reasons.push(`due within ${riskDays} days but not started (still in "${t.status}")`);
      }
    }

    for (const depId of t.dependencies || []) {
      const dep = byId.get(String(depId));
      if (!dep || isDone(dep)) continue;
      const depLater = dep.deadline && new Date(dep.deadline) > dl;
      if (depLater || (daysLeft <= riskDays && dl >= now)) {
        reasons.push(`blocked by unfinished "${dep.title}"${depLater ? ' (due later than this task)' : ''}`);
      }
    }

    if (reasons.length) {
      risky.push({
        _id: t._id,
        title: t.title,
        status: t.status,
        deadline: t.deadline,
        assignee: t.assignee || null,
        overdue: dl < now,
        reasons,
      });
    }
  }
  risky.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  return risky;
}

// "At the current pace, when do we finish?" using the last 4 weeks of velocity.
function forecastFinish({ openCount, velocity, projectCreatedAt, deadline, now = new Date() }) {
  if (openCount === 0) return { projectedFinish: null, tasksPerWeek: null, onTime: null, note: 'No open tasks' };

  const weeksOld = Math.max(1, Math.ceil((now - new Date(projectCreatedAt)) / (7 * DAY_MS)));
  const window = Math.min(4, weeksOld, velocity.length);
  const recent = velocity.slice(velocity.length - window);
  const tasksPerWeek = recent.reduce((s, w) => s + w.completedTasks, 0) / window;

  if (tasksPerWeek === 0) {
    return { projectedFinish: null, tasksPerWeek: 0, onTime: null, note: 'No tasks completed recently, so no forecast' };
  }
  const projectedFinish = new Date(now.getTime() + (openCount / tasksPerWeek) * 7 * DAY_MS);
  return {
    projectedFinish,
    tasksPerWeek: round(tasksPerWeek),
    onTime: deadline ? projectedFinish <= new Date(deadline) : null,
    note: null,
  };
}

function projectHealth({ total, open, overdue, atRisk, forecast, deadline, now = new Date() }) {
  if (total > 0 && open === 0) return { status: 'completed', reasons: ['All tasks are done'] };

  let level = 0;
  const reasons = [];
  const bump = (to, why) => {
    level = Math.max(level, to);
    reasons.push(why);
  };

  if (open > 0 && overdue / open > 0.25) bump(2, `${overdue} of ${open} open tasks are overdue`);
  else if (overdue > 0) bump(1, `${overdue} open task(s) overdue`);

  if (deadline && new Date(deadline) < now && open > 0) bump(2, 'Project deadline has passed with work still open');

  if (forecast && forecast.onTime === false) {
    const lateDays = (forecast.projectedFinish - new Date(deadline)) / DAY_MS;
    if (lateDays > 14) bump(2, `Current pace finishes about ${Math.round(lateDays)} days after the deadline`);
    else bump(1, 'Current pace finishes after the deadline');
  }

  if (atRisk > 0 && level === 0) bump(1, `${atRisk} task(s) at risk of missing their deadline`);

  return { status: ['on_track', 'at_risk', 'off_track'][level], reasons };
}

module.exports = {
  DAY_MS,
  DONE_STATUS,
  round,
  startOfDay,
  addDays,
  dayKey,
  parseDay,
  isDone,
  weeklyVelocity,
  averageCompletion,
  burnSeries,
  workload,
  deadlineRisk,
  forecastFinish,
  projectHealth,
};