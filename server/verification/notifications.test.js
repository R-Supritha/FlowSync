// FR10: deadline reminders and pull-request notifications. No database: in-memory stand-ins for the models.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const db = { tasks: [], notes: [], users: {}, taskFinds: 0, failTaskFind: false };
const oid = (n) => `64f${String(n).padStart(21, '0')}`;
const same = (a, b) => String(a) === String(b);
const clone = (o) => JSON.parse(JSON.stringify(o));
const chain = (get) => { const c = { select() { return c; }, sort() { return c; }, skip() { return c; }, limit() { return c; }, lean: async () => clone(get()), then: (res, rej) => Promise.resolve(get()).then(res, rej) }; return c; };

stub('models/Task.js', {
  find: (q) => {
    db.taskFinds += 1;
    if (db.failTaskFind) throw new Error('database is down');
    return chain(() => db.tasks.filter((t) => same(t.assignee, q.assignee) && t.isArchived === q.isArchived && t.status !== q.status.$ne
      && t.deadline !== null && t.deadline !== undefined && new Date(t.deadline) <= q.deadline.$lte));
  },
});
stub('models/Notification.js', {
  create: async (doc) => {
    if (doc.key && db.notes.some((n) => same(n.user, doc.user) && n.key === doc.key)) throw Object.assign(new Error('dup'), { code: 11000 });
    const n = { _id: oid(5000 + db.notes.length), isRead: false, createdAt: new Date(), ...doc }; db.notes.push(n); return n;
  },
  findOne: (q) => chain(() => db.notes.find((n) => same(n.user, q.user) && n.key === q.key) || null),
  find: (q) => chain(() => db.notes.filter((n) => same(n.user, q.user))),
  countDocuments: async (q) => db.notes.filter((n) => same(n.user, q.user) && (q.isRead === undefined || n.isRead === q.isRead)).length,
});
stub('models/User.js', { findById: (id) => ({ select: async () => db.users[String(id)] || null }) });

const reminders = require('../src/utils/reminders');
const { notifyPullRequest } = require('../src/utils/githubNotify');
const { makeTaskIndex } = require('../src/utils/githubTaskLinks');
const notificationRoutes = require('../src/routes/notificationRoutes');

const HOUR = 3600 * 1000;
const NOW = new Date('2026-10-25T10:00:00Z');
const ME = oid(1); const OTHER = oid(2);
const task = (n, over = {}) => ({ _id: oid(100 + n), title: `Task ${n}`, project: oid(50), workspace: oid(60), assignee: ME, isArchived: false, status: 'In Progress', deadline: new Date(NOW.getTime() + 5 * HOUR), ...over });
beforeEach(() => { db.tasks = []; db.notes = []; db.users = {}; db.taskFinds = 0; db.failTaskFind = false; reminders.resetReminderThrottle(); });
const run = (opts = {}) => reminders.createDeadlineReminders(ME, { now: NOW, force: true, ...opts });

// ================================================================ deadline reminders
test('reminders: a task due within 24 hours reminds its assignee, once, with a link to the task', async () => {
  db.tasks = [task(1)];
  assert.equal(await run(), 1);
  const n = db.notes[0];
  assert.equal(n.type, 'deadline_approaching'); assert.equal(n.message, '"Task 1" is due in 5 hours'); assert.ok(same(n.user, ME));
  assert.ok(same(n.link.task, oid(101)) && same(n.link.project, oid(50)) && same(n.link.workspace, oid(60)));
});
test('reminders: a late task gets a one-time overdue notice with its due date', async () => {
  db.tasks = [task(1, { deadline: new Date('2026-10-22T09:00:00Z') })];
  assert.equal(await run(), 1);
  assert.equal(db.notes[0].type, 'deadline_overdue'); assert.equal(db.notes[0].message, '"Task 1" is overdue (it was due 2026-10-22)');
});
test('reminders: close to the deadline the wording says "less than an hour"', async () => {
  db.tasks = [task(1, { deadline: new Date(NOW.getTime() + 20 * 60 * 1000) })];
  await run(); assert.equal(db.notes[0].message, '"Task 1" is due in less than an hour');
});
test('reminders: only the right tasks count (not far away, done, archived, undated, unassigned, or someone else\'s)', async () => {
  db.tasks = [
    task(1, { deadline: new Date(NOW.getTime() + 3 * 24 * HOUR) }), task(2, { status: 'Done' }), task(3, { isArchived: true }),
    task(4, { deadline: null }), task(5, { assignee: null }), task(6, { assignee: OTHER }),
  ];
  assert.equal(await run(), 0); assert.equal(db.notes.length, 0);
});
test('reminders: never repeated; a moved deadline starts fresh; "due soon" and "overdue" are separate reminders', async () => {
  db.tasks = [task(1)];
  assert.equal(await run(), 1); assert.equal(await run(), 0); assert.equal(await run({ now: new Date(NOW.getTime() + HOUR) }), 0);
  assert.equal(db.notes.length, 1);
  assert.equal(await run({ now: new Date(NOW.getTime() + 6 * HOUR) }), 1);                       // now it is late: a different kind of reminder
  assert.deepEqual(db.notes.map((n) => n.type), ['deadline_approaching', 'deadline_overdue']);
  assert.equal(await run({ now: new Date(NOW.getTime() + 9 * HOUR) }), 0);                       // and that one is not repeated either
  db.tasks[0].deadline = new Date(NOW.getTime() + 30 * HOUR);                                    // the deadline is moved a day later...
  assert.equal(await run({ now: new Date(NOW.getTime() + 9 * HOUR) }), 1);                       // ...and the new date reminds again
});
test('reminders: respect the "due dates" switch in Settings', async () => {
  db.tasks = [task(1)]; db.users[ME] = { settings: { notifications: { dueDates: false } } };
  assert.equal(await run(), 0); assert.equal(db.notes.length, 0);
  db.users[ME] = { settings: { notifications: { dueDates: true } } };
  assert.equal(await run(), 1);
});
test('reminders: a person is looked at once per 5 minutes unless forced', async () => {
  db.tasks = [task(1)];
  assert.equal(await reminders.createDeadlineReminders(ME, { now: NOW }), 1); assert.equal(db.taskFinds, 1);
  db.tasks.push(task(2));
  assert.equal(await reminders.createDeadlineReminders(ME, { now: new Date(NOW.getTime() + 60 * 1000) }), 0); assert.equal(db.taskFinds, 1);   // too soon: not even asked
  assert.equal(await reminders.createDeadlineReminders(ME, { now: new Date(NOW.getTime() + 6 * 60 * 1000) }), 1); assert.equal(db.taskFinds, 2);
});

// ================================================================ the list of notifications
let base; let server;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api', notificationRoutes);
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());
const asMe = () => ({ Authorization: `Bearer ${jwt.sign({ id: ME, role: 'Member' }, process.env.JWT_SECRET)}` });

test('GET /notifications creates the person\'s reminders first, so they appear without any timer', async () => {
  db.tasks = [task(1), task(2, { deadline: new Date('2026-10-20T09:00:00Z') })];
  const realNow = Date; // the controller uses the real clock, so make the tasks relative to it
  db.tasks[0].deadline = new realNow(realNow.now() + 5 * HOUR); db.tasks[1].deadline = new realNow(realNow.now() - 30 * HOUR);
  const res = await fetch(`${base}/notifications`, { headers: asMe() }); const data = await res.json();
  assert.equal(res.status, 200); assert.equal(data.unreadCount, 2);
  assert.deepEqual(data.notifications.map((n) => n.type).sort(), ['deadline_approaching', 'deadline_overdue']);
  const again = await (await fetch(`${base}/notifications`, { headers: asMe() })).json();
  assert.equal(again.unreadCount, 2);                                                                    // asking again adds nothing
});
test('GET /notifications still works when the reminders cannot be created', async () => {
  db.failTaskFind = true;
  const origError = console.error; console.error = () => {};
  let res; try { res = await fetch(`${base}/notifications`, { headers: asMe() }); } finally { console.error = origError; }
  assert.equal(res.status, 200); assert.deepEqual((await res.json()).notifications, []);
});

// ================================================================ pull request notifications
const T1 = oid(701); const T2 = oid(702);
const ref = (id) => `FS-${String(id).slice(-6)}`;
const pr = (type, text, over = {}) => ({ type, text, meta: { number: 7, title: 'Add search' }, ...over });
const project = { _id: oid(50), workspace: oid(60) };
const tasksFor = (extra = []) => [{ _id: T1, title: 'Build login', assignee: oid(11), reporter: oid(12) }, ...extra];
const call = (ev, over = {}) => notifyPullRequest({ ev, project, tasks: tasksFor(), index: makeTaskIndex(tasksFor()), authorId: oid(99), ...over });

test('pull request: opened and merged tell the task\'s assignee and reporter, with a link to the task', async () => {
  assert.equal(await call(pr('pr_opened', `${ref(T1)} add search`)), 2);
  assert.deepEqual(db.notes.map((n) => [String(n.user).slice(-2), n.type]), [['11', 'pr_opened'], ['12', 'pr_opened']]);
  assert.equal(db.notes[0].message, 'Pull request #7 "Add search" was opened for "Build login"');
  assert.ok(same(db.notes[0].link.task, T1) && same(db.notes[0].link.project, project._id));
  db.notes = [];
  assert.equal(await call(pr('pr_merged', `${ref(T1)} add search`)), 2);
  assert.equal(db.notes[0].message, 'Pull request #7 "Add search" was merged for "Build login"'); assert.equal(db.notes[0].type, 'pr_merged');
});
test('pull request: the author is not told about their own pull request, and one person is told once', async () => {
  assert.equal(await call(pr('pr_opened', `${ref(T1)} x`), { authorId: oid(11) }), 1);
  assert.deepEqual(db.notes.map((n) => String(n.user).slice(-2)), ['12']);
  db.notes = [];
  const same2 = [{ _id: T1, title: 'Build login', assignee: oid(11), reporter: oid(11) }];
  assert.equal(await call(pr('pr_opened', `${ref(T1)} x`), { tasks: same2, index: makeTaskIndex(same2) }), 1);
});
test('pull request: nobody is told when there is no reference, an unknown one, or an ambiguous one', async () => {
  assert.equal(await call(pr('pr_opened', 'no reference here')), 0);
  assert.equal(await call(pr('pr_opened', 'FS-abcdef nothing like that')), 0);
  const twins = [...tasksFor(), { _id: `${oid(555).slice(0, 18)}${String(T1).slice(-6)}`, title: 'Twin', assignee: oid(13) }];      // same last six characters
  assert.equal(await call(pr('pr_opened', `${ref(T1)} x`), { tasks: twins, index: makeTaskIndex(twins) }), 0);
  assert.equal(await call({ type: 'commit_pushed', text: ref(T1), meta: {} }), 0);                                                  // commits are not pull requests
  assert.equal(db.notes.length, 0);
});
test('pull request: two tasks in one pull request, and the "pull request updates" switch', async () => {
  const two = [...tasksFor(), { _id: T2, title: 'Second', assignee: oid(13), reporter: oid(13) }];
  assert.equal(await call(pr('pr_opened', `${ref(T1)} and ${ref(T2)}`), { tasks: two, index: makeTaskIndex(two) }), 3);
  db.notes = []; db.users[oid(11)] = { settings: { notifications: { taskUpdates: false } } };
  assert.equal(await call(pr('pr_opened', `${ref(T1)} x`)), 1);                                                                      // the person who switched it off is skipped
  assert.deepEqual(db.notes.map((n) => String(n.user).slice(-2)), ['12']);
});
