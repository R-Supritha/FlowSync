// FR23: a stand-up report per person, built from the activity log (the same data as the activity feed).
// The FACTS always come from the database. The AI only words them; if it fails, a plain report built
// from the same facts is returned, so the feature never depends on the AI.
const { generateJson } = require('./aiService');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [24, 48, 72, 168];
const DEFAULT_WINDOW = 24;
const WAITING_STATUSES = ['Backlog', 'To Do'];
const DONE = 'Done';

const TYPE_TO_COUNT = {
  commit_pushed: 'commits',
  pr_opened: 'prsOpened',
  pr_merged: 'prsMerged',
  task_created: 'tasksCreated',
  task_completed: 'tasksCompleted',
  task_status_changed: 'tasksMoved',
  comment_added: 'comments',
  file_uploaded: 'files',
};

const emptyCounts = () => ({ commits: 0, prsOpened: 0, prsMerged: 0, tasksCreated: 0, tasksCompleted: 0, tasksMoved: 0, comments: 0, files: 0 });

function windowLabel(hours) {
  if (hours === 24) return 'the last 24 hours';
  if (hours === 48) return 'the last 2 days';
  if (hours === 72) return 'the last 3 days';
  if (hours === 168) return 'the last 7 days';
  return `the last ${hours} hours`;
}

const idOf = (v) => String((v && v._id) || v || '');

// activities: [{ actor: {_id,name}, type, message, taskTitle, createdAt }]
// tasks:      [{ _id, title, status, deadline, assignee: {_id,name}|null, dependencies: [id] }]
function buildStandupFacts({ activities = [], tasks = [], now = new Date(), windowHours = DEFAULT_WINDOW }) {
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const people = new Map();
  const person = (user) => {
    const id = idOf(user);
    if (!people.has(id)) {
      people.set(id, { userId: id, name: (user && user.name) || 'Someone', counts: emptyCounts(), highlights: [], inProgress: [], blockers: [] });
    }
    return people.get(id);
  };

  const events = activities
    .filter((a) => new Date(a.createdAt) >= since && new Date(a.createdAt) <= now)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first
  for (const a of events) {
    const p = person(a.actor);
    const key = TYPE_TO_COUNT[a.type];
    if (key) p.counts[key] += 1;
    if (a.message && p.highlights.length < 5 && !p.highlights.includes(a.message)) p.highlights.push(a.message);
  }

  const byId = new Map(tasks.map((t) => [idOf(t), t]));
  const team = { events: events.length, tasksCompleted: 0, openTasks: 0, overdue: 0, blocked: 0, unassignedBlockers: [] };
  for (const t of tasks) {
    const isDone = t.status === DONE;
    if (!isDone) team.openTasks += 1;
    const overdue = !isDone && t.deadline && new Date(t.deadline) < now;
    const waitingOn = (t.dependencies || []).map((d) => byId.get(idOf(d))).filter((d) => d && d.status !== DONE);
    // A task that has not started yet and waits for an earlier task is just queued, which is normal.
    // It only counts as blocked when work has started and cannot continue.
    const started = !WAITING_STATUSES.includes(t.status);
    const blocked = !isDone && started && waitingOn.length > 0;
    if (overdue) team.overdue += 1;
    if (blocked) team.blocked += 1;

    const problems = [];
    if (overdue) problems.push(`"${t.title}" is overdue`);
    if (blocked) problems.push(`"${t.title}" has started but is waiting on ${waitingOn.map((b) => `"${b.title}"`).join(', ')}`);

    if (t.assignee) {
      const p = person(t.assignee);
      if (!isDone && !WAITING_STATUSES.includes(t.status)) p.inProgress.push(t.title);
      p.blockers.push(...problems);
    } else {
      team.unassignedBlockers.push(...problems);
    }
  }
  for (const p of people.values()) team.tasksCompleted += p.counts.tasksCompleted;

  const list = [...people.values()]
    .map((p) => ({ ...p, inProgress: p.inProgress.slice(0, 6), blockers: p.blockers.slice(0, 6) }))
    .filter((p) => Object.values(p.counts).some(Boolean) || p.inProgress.length || p.blockers.length)
    .sort((a, b) => a.name.localeCompare(b.name));
  team.unassignedBlockers = team.unassignedBlockers.slice(0, 6);

  return { windowHours, since: since.toISOString(), until: now.toISOString(), people: list, team };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function personLine(p, windowHours) {
  const c = p.counts;
  const did = [];
  if (c.commits) did.push(plural(c.commits, 'commit', 'commits'));
  if (c.prsOpened) did.push(`opened ${plural(c.prsOpened, 'pull request', 'pull requests')}`);
  if (c.prsMerged) did.push(`merged ${plural(c.prsMerged, 'pull request', 'pull requests')}`);
  if (c.tasksCompleted) did.push(`completed ${plural(c.tasksCompleted, 'task', 'tasks')}`);
  if (c.tasksCreated) did.push(`created ${plural(c.tasksCreated, 'task', 'tasks')}`);
  if (c.tasksMoved) did.push(`moved ${plural(c.tasksMoved, 'task', 'tasks')} on the board`);
  if (c.comments) did.push(`wrote ${plural(c.comments, 'comment', 'comments')}`);
  if (c.files) did.push(`uploaded ${plural(c.files, 'file', 'files')}`);
  const parts = [];
  parts.push(did.length ? `In ${windowLabel(windowHours)}: ${did.join(', ')}.` : `No recorded activity in ${windowLabel(windowHours)}.`);
  if (p.inProgress.length) parts.push(`Working on: ${p.inProgress.join('; ')}.`);
  if (p.blockers.length) parts.push(`Blockers: ${p.blockers.join('; ')}.`);
  return parts.join(' ');
}

// The plain report, built only from the facts. Always available.
function rulesStandup(facts) {
  const t = facts.team;
  const summary = facts.people.length === 0
    ? `No activity was recorded in ${windowLabel(facts.windowHours)}.`
    : `In ${windowLabel(facts.windowHours)} there were ${plural(t.events, 'activity event', 'activity events')} from ${plural(facts.people.length, 'person', 'people')}, ` +
      `${plural(t.tasksCompleted, 'task', 'tasks')} completed. ${plural(t.openTasks, 'task is', 'tasks are')} open, ${t.overdue} overdue and ${t.blocked} blocked.`;
  return { summary, people: facts.people.map((p) => ({ userId: p.userId, name: p.name, text: personLine(p, facts.windowHours) })) };
}

const SYSTEM_PROMPT = `You write a short daily stand-up report for a software team, from FACTS given as JSON.
Return JSON only, with exactly this shape:
{ "summary": "2-3 sentences about the team", "people": [ { "name": "exact name from the facts", "text": "1-2 sentences" } ] }

Rules:
- Use ONLY the facts. Never invent people, numbers, tasks or events.
- For each person say what they did, what they are working on, and any blocker.
- People with no activity: say so briefly, and mention what they are working on if known.
- Plain, friendly tone. No markdown.`;

const clip = (value, max) => String(value || '').trim().slice(0, max);

// Keeps only names that exist in the facts, so the AI cannot add people.
function sanitizeStandupAi(raw, facts) {
  const known = new Map(facts.people.map((p) => [p.name.toLowerCase(), p.userId]));
  const texts = new Map();
  for (const item of raw && Array.isArray(raw.people) ? raw.people : []) {
    const id = known.get(String((item && item.name) || '').trim().toLowerCase());
    const text = clip(item && item.text, 500);
    if (id && text) texts.set(id, text);
  }
  return { summary: clip(raw && raw.summary, 600), texts };
}

async function generateStandupReport({ facts, useAi = true }) {
  const rules = rulesStandup(facts);
  const base = { windowHours: facts.windowHours, since: facts.since, until: facts.until, team: facts.team };
  const withFacts = (people, summary, extra) => ({
    ...base,
    ...extra,
    summary,
    people: people.map((p) => {
      const f = facts.people.find((x) => x.userId === p.userId);
      return { ...p, counts: f.counts, inProgress: f.inProgress, blockers: f.blockers };
    }),
  });

  if (!useAi || facts.people.length === 0) return withFacts(rules.people, rules.summary, { source: 'rules' });

  try {
    const raw = await generateJson(
      { system: SYSTEM_PROMPT, user: `FACTS:\n${JSON.stringify({ window: windowLabel(facts.windowHours), team: facts.team, people: facts.people })}` },
      { timeoutMs: 60 * 1000 }
    );
    const ai = sanitizeStandupAi(raw, facts);
    if (!ai.summary && ai.texts.size === 0) throw new Error('The AI reply had no usable text.');
    const people = rules.people.map((p) => ({ ...p, text: ai.texts.get(p.userId) || p.text }));
    return withFacts(people, ai.summary || rules.summary, { source: 'ai' });
  } catch (error) {
    return withFacts(rules.people, rules.summary, { source: 'rules', aiError: String(error.message || 'The AI could not be used.').slice(0, 300) });
  }
}

module.exports = { buildStandupFacts, rulesStandup, sanitizeStandupAi, generateStandupReport, WINDOWS, DEFAULT_WINDOW, DAY_MS };
