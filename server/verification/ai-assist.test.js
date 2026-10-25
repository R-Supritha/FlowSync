// Checks for FR23 (stand-up report), FR24 (sprint planning) and FR25 (task breakdown).
// No database, no internet, no AI key: models are stand-ins and the AI is a small fake server.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const http = require('http');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------- stand-ins for the database models
const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const db = { project: null, workspace: null, tasks: [], activity: [], logged: [] };
let role = 'Admin';
const clone = (o) => JSON.parse(JSON.stringify(o));

function chain(getValue) {
  const c = {
    _lean: false,
    select() { return c; }, populate() { return c; }, sort() { return c; }, limit() { return c; },
    lean() { c._lean = true; return c; },
    then(res, rej) { const v = getValue(); return Promise.resolve(c._lean && Array.isArray(v) ? v.map(clone) : (c._lean && v ? clone(v) : v)).then(res, rej); },
  };
  return c;
}
const matches = (t, q) => (q.project === undefined || String(t.project) === String(q.project))
  && (q.isArchived === undefined || Boolean(t.isArchived) === q.isArchived)
  && (q.status === undefined || t.status === q.status)
  && (!q._id || !q._id.$in || q._id.$in.map(String).includes(String(t._id)));

stub('models/Project.js', { findById: (id) => chain(() => (db.project && String(db.project._id) === String(id) ? db.project : null)) });
stub('models/Workspace.js', { findById: () => chain(() => db.workspace) });
stub('models/Task.js', {
  findById: (id) => chain(() => db.tasks.find((t) => String(t._id) === String(id)) || null),
  find: (q) => chain(() => {
    const list = db.tasks.filter((t) => matches(t, q));
    return q.status ? [...list].sort((a, b) => (b.position || 0) - (a.position || 0)).slice(0, 1) : list;
  }),
});
stub('models/ActivityLog.js', { find: (q) => chain(() => db.activity.filter((a) => String(a.project) === String(q.project) && new Date(a.createdAt) >= q.createdAt.$gte)) });
const access = require('../src/utils/access');
stub('utils/access.js', { ...access, getWorkspaceRole: async () => role });
const botPosts = [];
stub('utils/chatBot.js', { postBotMessage: async (m) => { botPosts.push(m); return null; } });
stub('utils/activity.js', { logTaskStatusChange: async (e) => { db.logged.push({ id: String(e.task._id), from: e.previousStatus, to: e.task.status }); } });

const svc = require('../src/services/sprintService');
const standupSvc = require('../src/services/standupService');
const breakdownSvc = require('../src/services/breakdownService');
const { aiRateLimit, resetAiThrottle } = require('../src/utils/aiThrottle');

// ---------------------------------------------------------------- fake AI service
let aiMode = 'ok'; let aiCalls = []; let aiAnswers = {};
const fakeAi = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const system = (payload.systemInstruction && payload.systemInstruction.parts[0].text) || '';
    const user = (payload.contents && payload.contents[0].parts[0].text) || '';
    aiCalls.push({ system, user });
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (aiMode === 'down') return json(503, { error: { message: 'high demand' } });
    const kind = system.includes('break ONE task') ? 'breakdown' : system.includes('stand-up report') ? 'standup' : 'sprint';
    const text = aiMode === 'junk' ? 'I cannot help with that.' : JSON.stringify(aiAnswers[kind]);
    json(200, { candidates: [{ content: { parts: [{ text }] } }] });
  });
});

const T = (n) => `64f000000000000000000${String(n).padStart(3, '0')}`; // valid 24-char ids
const now = () => new Date();
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);
const daysAhead = (d) => new Date(Date.now() + d * 86400 * 1000);
const mk = (n, over = {}) => {
  const t = { _id: T(n), project: T(900), title: `Task ${n}`, status: 'Backlog', priority: 'Medium', estimatedHours: 4, position: n, dependencies: [], isArchived: false, reporter: 'u1', ...over };
  Object.defineProperty(t, 'save', { value: async () => {}, enumerable: false });
  return t;
};
const token = jwt.sign({ id: 'u1', role: 'Member' }, process.env.JWT_SECRET);

let base; let appServer; let aiPort;
before(async () => {
  await new Promise((r) => fakeAi.listen(0, r)); aiPort = fakeAi.address().port;
  const app = express(); app.use(express.json()); app.use('/api', require('../src/routes/aiAssistRoutes'));
  appServer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${appServer.address().port}/api`;
});
after(() => { fakeAi.close(); appServer.close(); });
beforeEach(() => {
  role = 'Admin'; aiMode = 'ok'; aiCalls = [];
  aiAnswers = {
    breakdown: { subtasks: [{ title: 'Design the schema' }, 'Write migrations', { title: 'design the SCHEMA' }, { title: 'Parent task' }, { title: '' }] },
    standup: { summary: 'A calm day.', people: [{ name: 'Sunitha', text: 'Shipped the login page.' }, { name: 'Invented Person', text: 'Did magic.' }] },
    sprint: { goal: 'Ship login.', summary: 'Focus on the auth tasks.', risks: ['Task 3 has no estimate', '', 'b', 'c', 'd'] },
  };
  Object.assign(process.env, { AI_API_KEY: 'k', AI_PROVIDER: 'gemini', AI_BASE_URL: `http://localhost:${aiPort}/v1beta`, AI_MODEL: 'main', AI_RETRY_DELAY_MS: '5' });
  delete process.env.AI_FALLBACK_MODELS; delete process.env.AI_RATE_LIMIT;
  resetAiThrottle();
  db.project = { _id: T(900), workspace: T(800), name: 'Library', description: 'Books', isArchived: false, columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'] };
  db.workspace = { members: [{ role: 'Admin' }, { role: 'Member' }, { role: 'Member' }, { role: 'Viewer' }] };
  db.tasks = []; db.activity = []; db.logged = []; botPosts.length = 0;
});

const call = async (method, p, body, auth = true) => {
  const headers = { 'Content-Type': 'application/json' }; if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};

// ================================================================ FR25: breakdown logic
test('FR25 sanitizeBreakdown: strings and objects, no blanks, no duplicates, no repeat of the parent or existing subtasks', () => {
  const { subtasks } = breakdownSvc.sanitizeBreakdown(aiAnswers.breakdown, { parentTitle: 'Parent task', existing: ['Write migrations'] });
  assert.deepEqual(subtasks, [{ title: 'Design the schema' }]);
});
test('FR25 sanitizeBreakdown: caps the list and the title length, and refuses unusable replies', () => {
  const many = { subtasks: Array.from({ length: 30 }, (_, i) => `Step ${i}`) };
  assert.equal(breakdownSvc.sanitizeBreakdown(many).subtasks.length, breakdownSvc.MAX_SUBTASKS);
  assert.equal(breakdownSvc.sanitizeBreakdown({ subtasks: ['x'.repeat(500)] }).subtasks[0].title.length, 120);
  for (const bad of [null, {}, { subtasks: 'no' }, { subtasks: [] }, { subtasks: ['  '] }]) assert.throws(() => breakdownSvc.sanitizeBreakdown(bad), /AI/);
});
test('FR25 prompt: contains the task, its checklist, existing subtasks and the hint', () => {
  const p = breakdownSvc.buildBreakdownPrompt({ project: { name: 'Lib' }, task: { title: 'Build login', description: 'JWT', checklist: [{ text: 'Works' }], subtasks: [{ title: 'Form' }] }, hint: 'use React' });
  for (const s of ['Lib', 'Build login', 'JWT', 'Works', 'Existing subtasks', 'Form', 'use React']) assert.ok(p.includes(s), s);
});

// ================================================================ FR25: HTTP
test('FR25 breakdown: needs a login and a valid id', async () => {
  assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {}, false)).status, 401);
  assert.equal((await call('POST', '/tasks/abc/ai/breakdown', {})).status, 400);
});
test('FR25 breakdown: returns new subtasks (the AI is told what exists) and changes nothing', async () => {
  db.tasks = [mk(1, { title: 'Parent task', subtasks: [{ title: 'Write migrations' }], checklist: [{ text: 'Works' }] })];
  const before = JSON.stringify(db.tasks);
  const r = await call('POST', `/tasks/${T(1)}/ai/breakdown`, { hint: 'keep it small' });
  assert.equal(r.status, 200); assert.deepEqual(r.data.subtasks, [{ title: 'Design the schema' }]); assert.equal(r.data.existingCount, 1);
  assert.ok(aiCalls[0].user.includes('Write migrations') && aiCalls[0].user.includes('keep it small'));
  assert.equal(JSON.stringify(db.tasks), before);
});
test('FR25 breakdown: roles and states', async () => {
  db.tasks = [mk(1, { reporter: 'someone-else' })];
  role = 'Viewer'; assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 403);
  role = 'Member'; assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 403); // not theirs
  db.tasks = [mk(1, { reporter: 'u1' })]; assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 200); // their own
  db.tasks = [mk(1, { reporter: 'someone-else', assignee: 'u1' })]; assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 200); // assigned to them
  role = null; assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 404);
  role = 'Admin'; assert.equal((await call('POST', `/tasks/${T(77)}/ai/breakdown`, {})).status, 404);
  db.project.isArchived = true; assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 400);
  db.project.isArchived = false; db.tasks = [mk(1, { isArchived: true })]; assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 400);
});
test('FR25 breakdown: AI trouble gives 503 (down) or 422 (unusable), never a crash', async () => {
  db.tasks = [mk(1)];
  aiMode = 'down'; let r = await call('POST', `/tasks/${T(1)}/ai/breakdown`, {});
  assert.equal(r.status, 503); assert.equal(r.data.aiUnavailable, true);
  aiMode = 'junk'; r = await call('POST', `/tasks/${T(1)}/ai/breakdown`, {});
  assert.equal(r.status, 422);
  aiMode = 'ok'; aiAnswers.breakdown = { subtasks: [] }; r = await call('POST', `/tasks/${T(1)}/ai/breakdown`, {});
  assert.equal(r.status, 422);
  delete process.env.AI_API_KEY; r = await call('POST', `/tasks/${T(1)}/ai/breakdown`, {});
  assert.equal(r.status, 503); assert.match(r.data.message, /not configured/);
});
test('AI throttle: too many AI requests from one person get a 429 with Retry-After', async () => {
  process.env.AI_RATE_LIMIT = '3'; db.tasks = [mk(1)];
  for (let i = 0; i < 3; i += 1) assert.equal((await call('POST', `/tasks/${T(1)}/ai/breakdown`, {})).status, 200);
  const r = await call('POST', `/tasks/${T(1)}/ai/breakdown`, {});
  assert.equal(r.status, 429); assert.match(r.data.message, /Too many AI requests/);
});

// ================================================================ FR24: planner rules
const plan = (tasks, capacityHours = 20, sprintDays = 14) => svc.planSprint({ tasks, capacityHours, sprintDays, now: now() });
const titles = (p) => p.sprint.tasks.map((t) => t.title);

test('FR24 planner: only Backlog tasks are planned; capacity is never exceeded; High comes before Low', () => {
  const p = plan([mk(1, { priority: 'Low', estimatedHours: 5 }), mk(2, { priority: 'High', estimatedHours: 8 }), mk(3, { status: 'Done' }), mk(4, { status: 'In Progress' }), mk(5, { priority: 'Medium', estimatedHours: 8 })], 16);
  assert.deepEqual(titles(p), ['Task 2', 'Task 5']); assert.equal(p.sprint.plannedHours, 16); assert.equal(p.sprint.remainingHours, 0); assert.equal(p.sprint.utilisation, 1);
  assert.deepEqual(p.deferred.map((t) => t.title), ['Task 1']); assert.match(p.deferred[0].reason, /Needs 5 h but only 0 h are left/);
});
test('FR24 planner: a smaller lower-priority task still fills the gap left by one that does not fit', () => {
  const p = plan([mk(1, { priority: 'High', estimatedHours: 8 }), mk(2, { priority: 'High', estimatedHours: 8 }), mk(3, { priority: 'Low', estimatedHours: 2 })], 10);
  assert.deepEqual(titles(p), ['Task 1', 'Task 3']); assert.deepEqual(p.deferred.map((t) => t.title), ['Task 2']);
});
test('FR24 planner: a task is never planned before its prerequisite', () => {
  const a = mk(1, { priority: 'Low', estimatedHours: 3 });
  const b = mk(2, { priority: 'High', estimatedHours: 3, dependencies: [a._id] });
  let p = plan([b, a], 20);
  assert.deepEqual(titles(p), ['Task 1', 'Task 2']);                 // A first although B has higher priority
  p = plan([b, a], 4);                                               // only one fits: A must be the one
  assert.deepEqual(titles(p), ['Task 1']); assert.match(p.deferred[0].reason, /Needs 3 h but only 1 h are left/);
  p = plan([b, mk(1, { priority: 'Low', estimatedHours: 10 })], 4);  // the prerequisite itself does not fit
  assert.deepEqual(titles(p), []); assert.match(p.deferred.find((t) => t.title === 'Task 2').reason, /Waiting on "Task 1" \(not in this sprint\)/);
  p = plan([b, mk(1, { status: 'Done' })], 20); assert.deepEqual(titles(p), ['Task 2']);        // done prerequisite is fine
  p = plan([b, mk(1, { status: 'In Progress' })], 20); assert.deepEqual(titles(p), []);         // unfinished prerequisite blocks it
  assert.match(p.deferred[0].reason, /Waiting on "Task 1" \(In Progress\)/);
});
test('FR24 planner: deadlines inside the sprint come first among equal priorities', () => {
  const p = plan([mk(1, { estimatedHours: 5 }), mk(2, { estimatedHours: 5, deadline: daysAhead(3) }), mk(3, { estimatedHours: 5, deadline: daysAhead(90) })], 10);
  assert.deepEqual(titles(p), ['Task 2', 'Task 3']);
});
test('FR24 planner: no estimate means 4 h is assumed, and the plan says so; oversized and empty backlogs are explained', () => {
  let p = plan([mk(1, { estimatedHours: 0 }), mk(2, { estimatedHours: 0 })], 8);
  assert.equal(p.sprint.plannedHours, 8); assert.ok(p.sprint.tasks.every((t) => t.assumedEstimate && t.estimatedHours === 4));
  assert.match(p.warnings[0], /2 tasks have no estimate, so 4 h was assumed/);
  p = plan([mk(1, { estimatedHours: 50 })], 20); assert.match(p.deferred[0].reason, /more than the whole sprint \(20 h\)/);
  p = plan([], 20); assert.equal(p.backlogCount, 0); assert.match(p.warnings[0], /Backlog column is empty/);
});
test('FR24 settings: defaults, overrides and every kind of bad value', () => {
  assert.deepEqual(svc.parseSprintSettings({}, 3).value, { sprintDays: 14, people: 3, hoursPerPerson: 30, capacityHours: 90 });
  assert.equal(svc.parseSprintSettings({ people: 2, hoursPerPerson: 12.5 }, 9).value.capacityHours, 25);
  assert.equal(svc.parseSprintSettings({ capacityHours: 40 }, 9).value.capacityHours, 40);
  for (const bad of [{ sprintDays: 0 }, { sprintDays: 61 }, { people: 0 }, { people: 1.5 }, { people: 51 }, { hoursPerPerson: 0 }, { hoursPerPerson: 201 }, { capacityHours: 0 }, { capacityHours: 5001 }, { sprintDays: 'x' }]) {
    assert.ok(svc.parseSprintSettings(bad, 2).error, JSON.stringify(bad));
  }
});

// ================================================================ FR24: HTTP
test('FR24 sprint-plan: Viewers are refused, Members can plan, the default capacity counts non-Viewers', async () => {
  db.tasks = [mk(1, { estimatedHours: 10 })];
  role = 'Viewer'; assert.equal((await call('POST', `/projects/${T(900)}/ai/sprint-plan`, { useAi: false })).status, 403);
  role = 'Member'; const r = await call('POST', `/projects/${T(900)}/ai/sprint-plan`, { useAi: false });
  assert.equal(r.status, 200); assert.equal(r.data.settings.people, 3); assert.equal(r.data.settings.capacityHours, 90);
  assert.deepEqual(r.data.sprint.tasks.map((t) => t.title), ['Task 1']);
});
test('FR24 sprint-plan: bad settings are 400, a missing project is 404, an archived one is 400', async () => {
  assert.equal((await call('POST', `/projects/${T(900)}/ai/sprint-plan`, { sprintDays: 0 })).status, 400);
  assert.equal((await call('POST', `/projects/${T(901)}/ai/sprint-plan`, {})).status, 404);
  db.project.isArchived = true; assert.equal((await call('POST', `/projects/${T(900)}/ai/sprint-plan`, {})).status, 400);
});
test('FR24 sprint-plan: the AI adds a goal, summary and (at most 3) risks, but cannot change the plan', async () => {
  db.tasks = [mk(1, { estimatedHours: 10 }), mk(2, { estimatedHours: 500 })];
  const r = await call('POST', `/projects/${T(900)}/ai/sprint-plan`, { people: 1, hoursPerPerson: 20 });
  assert.equal(r.status, 200); assert.equal(r.data.ai.used, true); assert.equal(r.data.ai.goal, 'Ship login.');
  assert.deepEqual(r.data.ai.risks, ['Task 3 has no estimate', 'b', 'c']);
  assert.deepEqual(r.data.sprint.tasks.map((t) => t.title), ['Task 1']); assert.equal(r.data.deferred.length, 1);
  assert.ok(aiCalls[0].user.includes('Task 1'));
});
test('FR24 sprint-plan: if the AI fails, the plan is still returned (the AI part is optional)', async () => {
  db.tasks = [mk(1)];
  for (const mode of ['down', 'junk']) {
    aiMode = mode; const r = await call('POST', `/projects/${T(900)}/ai/sprint-plan`, {});
    assert.equal(r.status, 200, mode); assert.equal(r.data.ai.used, false); assert.ok(r.data.ai.error); assert.equal(r.data.sprint.tasks.length, 1);
  }
  aiMode = 'ok'; const off = await call('POST', `/projects/${T(900)}/ai/sprint-plan`, { useAi: false });
  assert.deepEqual(off.data.ai, { used: false, requested: false }); assert.equal(aiCalls.length > 0, true);
});
const sprintApply = (ids) => call('POST', `/projects/${T(900)}/sprint/apply`, { taskIds: ids });
test('FR24 apply: only Admin or Manager can start a sprint', async () => {
  db.tasks = [mk(1)];
  for (const r of ['Viewer', 'Member']) { role = r; assert.equal((await sprintApply([T(1)])).status, 403, r); }
  role = 'Manager'; assert.equal((await sprintApply([T(1)])).status, 200);
});
test('FR24 apply: moves Backlog tasks to To Do after the existing ones, logs each move, and skips the rest with a reason', async () => {
  db.tasks = [mk(1), mk(2), mk(3, { status: 'In Progress' }), mk(4, { isArchived: true }), mk(5, { status: 'To Do', position: 7 })];
  const r = await sprintApply([T(1), T(2), T(3), T(4), T(99), T(1)]);
  assert.equal(r.status, 200); assert.equal(r.data.target, 'To Do');
  assert.deepEqual(r.data.moved.map((t) => t.title), ['Task 1', 'Task 2']);
  assert.deepEqual(r.data.skipped.map((s) => s.reason), ['Already in In Progress', 'The task is archived', 'Not found in this project']);
  assert.deepEqual(db.tasks.filter((t) => t.status === 'To Do').map((t) => [t.title, t.position]).sort(), [['Task 1', 8], ['Task 2', 9], ['Task 5', 7]]);
  assert.deepEqual(db.logged, [{ id: T(1), from: 'Backlog', to: 'To Do' }, { id: T(2), from: 'Backlog', to: 'To Do' }]);
});
test('FR24 apply: validates its input and needs a To Do column', async () => {
  db.tasks = [mk(1)];
  for (const body of [{}, { taskIds: [] }, { taskIds: 'x' }, { taskIds: ['abc'] }, { taskIds: Array.from({ length: 51 }, (_, i) => T(i + 1)) }]) {
    assert.equal((await call('POST', `/projects/${T(900)}/sprint/apply`, body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  db.project.columns = ['Backlog', 'Doing', 'Done'];
  const r = await sprintApply([T(1)]); assert.equal(r.status, 400); assert.match(r.data.message, /no "To Do" column/);
  db.project.columns = ['Backlog', 'To Do', 'Done']; db.project.isArchived = true; assert.equal((await sprintApply([T(1)])).status, 400);
  assert.equal(db.tasks[0].status, 'Backlog');
});

// ================================================================ FR23: facts and plain report
const act = (type, who, hrs, message, extra = {}) => ({ _id: `a${Math.random()}`, project: T(900), type, actor: { _id: who.toLowerCase(), name: who }, message, createdAt: hoursAgo(hrs), ...extra });

test('FR23 facts: counts per person, only inside the window, newest highlight first', () => {
  const activities = [
    act('commit_pushed', 'Sunitha', 1, 'committed "A" (abc1234)'), act('commit_pushed', 'Sunitha', 2, 'committed "B" (def5678)'),
    act('task_completed', 'Sunitha', 3, 'completed "Login"'), act('comment_added', 'Raj', 5, 'commented on "Login"'),
    act('commit_pushed', 'Raj', 30, 'old commit'),
  ];
  const f = standupSvc.buildStandupFacts({ activities, tasks: [], now: now(), windowHours: 24 });
  const s = f.people.find((p) => p.name === 'Sunitha'); const r = f.people.find((p) => p.name === 'Raj');
  assert.equal(s.counts.commits, 2); assert.equal(s.counts.tasksCompleted, 1); assert.equal(r.counts.comments, 1); assert.equal(r.counts.commits, 0);
  assert.equal(s.highlights[0], 'committed "A" (abc1234)'); assert.equal(f.team.events, 4); assert.equal(f.team.tasksCompleted, 1);
  assert.equal(standupSvc.buildStandupFacts({ activities, tasks: [], now: now(), windowHours: 48 }).team.events, 5);
});
test('FR23 facts: blockers are work that has started and cannot continue, or overdue work (queued tasks are not blockers)', () => {
  const sun = { _id: 'sunitha', name: 'Sunitha' };
  const tasks = [
    { _id: T(1), title: 'Login', status: 'In Progress', assignee: sun, dependencies: [] },
    { _id: T(2), title: 'Search', status: 'Backlog', assignee: sun, dependencies: [T(1)] },          // queued behind Login: normal
    { _id: T(3), title: 'Old thing', status: 'Review', assignee: sun, deadline: hoursAgo(48), dependencies: [] },
    { _id: T(4), title: 'Orphan', status: 'To Do', assignee: null, deadline: hoursAgo(10), dependencies: [] },
    { _id: T(5), title: 'Finished', status: 'Done', assignee: sun, deadline: hoursAgo(99), dependencies: [] },
    { _id: T(6), title: 'Deploy', status: 'In Progress', assignee: sun, dependencies: [T(2)] },       // started, but its prerequisite is not done
    { _id: T(7), title: 'Queued unassigned', status: 'To Do', assignee: null, dependencies: [T(1)] }, // queued: not a problem
  ];
  const f = standupSvc.buildStandupFacts({ activities: [], tasks, now: now(), windowHours: 24 });
  const s = f.people[0];
  assert.deepEqual(s.inProgress, ['Login', 'Old thing', 'Deploy']);
  assert.deepEqual(s.blockers, ['"Old thing" is overdue', '"Deploy" has started but is waiting on "Search"']);
  assert.deepEqual(f.team.unassignedBlockers, ['"Orphan" is overdue']);
  assert.equal(f.team.openTasks, 6); assert.equal(f.team.overdue, 2); assert.equal(f.team.blocked, 1);
});
test('FR23 plain report: readable sentences from the facts, and an honest empty report', () => {
  const activities = [act('commit_pushed', 'Sunitha', 1, 'x'), act('commit_pushed', 'Sunitha', 2, 'y'), act('commit_pushed', 'Sunitha', 3, 'z'), act('task_completed', 'Sunitha', 4, 'q')];
  const tasks = [{ _id: T(1), title: 'Login', status: 'In Progress', assignee: { _id: 'sunitha', name: 'Sunitha' }, dependencies: [] }];
  const r = standupSvc.rulesStandup(standupSvc.buildStandupFacts({ activities, tasks, now: now(), windowHours: 24 }));
  assert.match(r.people[0].text, /3 commits, completed 1 task/); assert.match(r.people[0].text, /Working on: Login/);
  assert.match(r.summary, /4 activity events from 1 person/);
  assert.match(standupSvc.rulesStandup(standupSvc.buildStandupFacts({ windowHours: 72 })).summary, /No activity was recorded in the last 3 days/);
});
test('FR23 AI reply: unknown names are ignored, text is clipped', () => {
  const facts = { people: [{ userId: 's', name: 'Sunitha' }] };
  const out = standupSvc.sanitizeStandupAi({ summary: 'x'.repeat(900), people: [{ name: ' sunitha ', text: 'Good.' }, { name: 'Ghost', text: 'Boo' }] }, facts);
  assert.equal(out.summary.length, 600); assert.deepEqual([...out.texts], [['s', 'Good.']]);
});

// ================================================================ FR23: HTTP
const standupCall = (body) => call('POST', `/projects/${T(900)}/ai/standup`, body);
test('FR23 standup: sections come from real activity and tasks; the AI words them; invented people are dropped', async () => {
  db.activity = [act('commit_pushed', 'Sunitha', 1, 'committed "A"'), act('comment_added', 'Raj', 2, 'commented')];
  db.tasks = [mk(1, { title: 'Login', status: 'In Progress', assignee: { _id: 'sunitha', name: 'Sunitha' } })];
  const r = await standupCall({});
  assert.equal(r.status, 200); const rep = r.data.report;
  assert.equal(rep.source, 'ai'); assert.equal(rep.summary, 'A calm day.'); assert.equal(rep.windowHours, 24);
  assert.deepEqual(rep.people.map((p) => p.name), ['Raj', 'Sunitha']);
  assert.equal(rep.people.find((p) => p.name === 'Sunitha').text, 'Shipped the login page.');
  assert.match(rep.people.find((p) => p.name === 'Raj').text, /1 comment/);        // no AI text for Raj: plain text fills in
  assert.equal(rep.people.find((p) => p.name === 'Sunitha').counts.commits, 1);
  assert.ok(aiCalls[0].user.includes('Sunitha') && !aiCalls[0].user.includes('Invented'));
});
test('FR23 standup: if the AI fails (or is switched off) the plain report is still returned', async () => {
  db.activity = [act('commit_pushed', 'Sunitha', 1, 'committed "A"')];
  aiMode = 'down'; let r = await standupCall({});
  assert.equal(r.status, 200); assert.equal(r.data.report.source, 'rules'); assert.ok(r.data.report.aiError); assert.match(r.data.report.people[0].text, /1 commit/);
  aiMode = 'junk'; r = await standupCall({}); assert.equal(r.data.report.source, 'rules');
  aiMode = 'ok'; aiCalls = []; r = await standupCall({ useAi: false });
  assert.equal(r.data.report.source, 'rules'); assert.equal(r.data.report.aiError, undefined); assert.equal(aiCalls.length, 0);
  delete process.env.AI_API_KEY; r = await standupCall({}); assert.equal(r.data.report.source, 'rules'); assert.match(r.data.report.aiError, /not configured/);
});
test('FR23 standup: empty projects, window choices, and who may read it', async () => {
  process.env.AI_RATE_LIMIT = '100';
  let r = await standupCall({}); assert.equal(r.status, 200); assert.equal(r.data.report.people.length, 0); assert.match(r.data.report.summary, /No activity was recorded/); assert.equal(aiCalls.length, 0);
  for (const w of [24, 48, 72, 168, '48']) assert.equal((await standupCall({ windowHours: w })).status, 200, String(w));
  for (const w of [5, 'x', 0, 1000]) assert.equal((await standupCall({ windowHours: w })).status, 400, String(w));
  role = 'Viewer'; assert.equal((await standupCall({})).status, 200);   // read-only people may read it
  role = null; assert.equal((await standupCall({})).status, 404);
  assert.equal((await call('POST', `/projects/${T(901)}/ai/standup`, {})).status, 404);
});


// ================================================================ FR30: FlowSync announces in the project chat
test('FR30 sprint: starting a sprint posts ONE message in the project chat, naming the first five tasks', async () => {
  db.tasks = Array.from({ length: 7 }, (_, i) => mk(i + 1));
  const r = await sprintApply(db.tasks.map((t) => t._id));
  assert.equal(r.status, 200); assert.equal(r.data.moved.length, 7);
  assert.equal(botPosts.length, 1);
  const post = botPosts[0];
  assert.equal(post.kind, 'sprint'); assert.equal(String(post.project), T(900)); assert.equal(String(post.workspace), T(800)); assert.ok(post.actor);
  assert.match(post.text, /^🚀 Sprint started: 7 tasks moved to To Do: "Task 1", "Task 2", "Task 3", "Task 4", "Task 5" and 2 more$/);
});
test('FR30 sprint: one task reads "1 task", and nothing is posted when nothing moved or the request is refused', async () => {
  db.tasks = [mk(1), mk(2, { status: 'In Progress' })];
  assert.equal((await sprintApply([T(2)])).data.moved.length, 0); assert.equal(botPosts.length, 0);
  await sprintApply([T(1)]);
  assert.equal(botPosts.length, 1); assert.match(botPosts[0].text, /^🚀 Sprint started: 1 task moved to To Do: "Task 1"$/);
  botPosts.length = 0; role = 'Member';
  assert.equal((await sprintApply([T(1)])).status, 403); assert.equal(botPosts.length, 0);
});
test('FR30 stand-up: when there is something to report, the chat is told once per 6 hours, with the counts', async () => {
  db.activity = [act('commit_pushed', 'Sunitha', 1, 'committed "A"'), act('comment_added', 'Raj', 2, 'commented')];
  db.tasks = [mk(1, { title: 'Login', status: 'In Progress', assignee: { _id: 'sunitha', name: 'Sunitha' } })];
  const r = await standupCall({});
  assert.equal(r.status, 200);
  assert.equal(botPosts.length, 1);
  assert.equal(botPosts[0].kind, 'standup'); assert.equal(botPosts[0].dedupeHours, 6); assert.equal(String(botPosts[0].project), T(900));
  assert.equal(botPosts[0].text, '📋 Stand-up ready for the last 24 hours: 0 tasks completed, 1 commit, 0 blockers. Open the Stand-up page for the full report.');
});
test('FR30 stand-up: a quiet project posts nothing, and the plain (no AI) report still announces itself', async () => {
  db.activity = []; db.tasks = [];
  assert.equal((await standupCall({})).status, 200); assert.equal(botPosts.length, 0);
  db.activity = [act('commit_pushed', 'Sunitha', 1, 'committed "A"'), act('commit_pushed', 'Raj', 2, 'committed "B"')];
  const r = await standupCall({ useAi: false, windowHours: 48 });
  assert.equal(r.data.report.source, 'rules');
  assert.equal(botPosts.length, 1); assert.match(botPosts[0].text, /last 48 hours: 0 tasks completed, 2 commits, 0 blockers/);
});
