// Automatic checks for FR22 (settings, notification preferences) and FR11 (creating the project
// from a confirmed plan). The database models are replaced by small stand-ins, so no MongoDB is needed.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ---- stand-ins for the Mongoose models, injected before the code under test is loaded ----
const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const db = { users: {}, projects: [], tasks: [], notifications: [], activity: [], lastUpdate: null, failTaskSaveAt: null };
const chain = (value) => ({ select() { return this; }, lean() { return Promise.resolve(value); }, sort() { return Promise.resolve(value); }, then: (res, rej) => Promise.resolve(value).then(res, rej) });

const UserStub = {
  findById: (id) => chain(db.users[id] ? JSON.parse(JSON.stringify(db.users[id])) : null),
  findByIdAndUpdate: (id, update) => { db.lastUpdate = update; const u = db.users[id]; if (!u) return chain(null); for (const [k, v] of Object.entries(update.$set)) { const parts = k.split('.'); let o = u; parts.slice(0, -1).forEach((x) => { o = o[x] = o[x] || {}; }); o[parts.at(-1)] = v; } return chain(JSON.parse(JSON.stringify(u))); },
};
stub('models/User.js', UserStub);
stub('models/Notification.js', { create: async (doc) => { db.notifications.push(doc); return doc; } });
stub('models/Project.js', {
  findOne: async (q) => db.projects.find((p) => p.generationKey === q.generationKey && String(p.workspace) === String(q.workspace)) || null,
  create: async (doc) => { const p = { _id: 'proj' + (db.projects.length + 1), ...doc, milestones: (doc.milestones || []).map((m, i) => ({ _id: 'ms' + i, ...m })), deleteOne: async () => { db.projects = db.projects.filter((x) => x !== p); } }; db.projects.push(p); return p; },
});
class TaskStub {
  constructor(doc) { Object.assign(this, doc); this._id = 'task' + (db.tasks.length + 1 + Math.random().toString(36).slice(2, 5)); }
  async save() { if (db.failTaskSaveAt !== null && db.tasks.length === db.failTaskSaveAt) throw new Error('disk full'); if (!db.tasks.includes(this)) db.tasks.push(this); }
  static find(q) { return chain(db.tasks.filter((t) => t.project === q.project)); }
  static async deleteMany(q) { db.tasks = db.tasks.filter((t) => t.project !== q.project); }
}
stub('models/Task.js', TaskStub);
let role = 'Admin';
const access = require('../src/utils/access');
stub('utils/access.js', { ...access, getWorkspaceRole: async () => role });
stub('utils/activity.js', { logActivity: async (e) => { db.activity.push(e); } });

const mkRes = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

// ============================ FR22: settings ============================
const { getSettings, updateSettings } = require('../src/controllers/settingsController');
const reset = () => { db.users = { u1: { _id: 'u1', privacy: {} } }; db.notifications = []; db.projects = []; db.tasks = []; db.activity = []; db.failTaskSaveAt = null; role = 'Admin'; };

test('FR22 GET settings: a user who never saved gets defaults and configured=false', async () => {
  reset(); const res = mkRes(); await getSettings({ user: { id: 'u1' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.configured, false);
  assert.deepEqual(res.body.settings, { theme: 'system', fontSize: 14, language: 'en', notifications: { taskAssigned: true, taskUpdates: true, comments: true, mentions: true, dueDates: true } });
  assert.ok(res.body.visibilityLevels.includes('private')); assert.equal(res.body.languages[0].id, 'en');
});
test('FR22 PUT settings: saves theme, text size, language and notification flags in one call', async () => {
  reset(); const res = mkRes();
  await updateSettings({ user: { id: 'u1' }, body: { theme: 'midnight', fontSize: 16.4, language: 'en', notifications: { comments: false } } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.settings.theme, 'midnight'); assert.equal(res.body.settings.fontSize, 16);
  assert.equal(res.body.settings.notifications.comments, false); assert.equal(res.body.settings.notifications.mentions, true);
  assert.equal(res.body.configured, true); assert.ok(db.lastUpdate.$set['settings.configuredAt']);
});
test('FR22 PUT settings: rejects every kind of bad input with a 400 and a message', async () => {
  const bad = [
    [{ theme: 'neon' }, /theme must be one of/], [{ fontSize: 5 }, /between 12 and 22/], [{ fontSize: 'big' }, /between 12 and 22/],
    [{ language: 'fr' }, /language must be one of/], [{ notifications: 'yes' }, /object of true\/false/], [{ notifications: [true] }, /object of true\/false/],
    [{ notifications: { spam: true } }, /Unknown notification preference/], [{ notifications: { comments: 'no' } }, /must be true or false/],
    [{ statusVisibility: 'nobody' }, /statusVisibility must be one of/], [{ inferWorkMode: 'yes' }, /inferWorkMode must be true or false/], [{}, /No valid settings/],
  ];
  for (const [body, re] of bad) { reset(); const res = mkRes(); await updateSettings({ user: { id: 'u1' }, body }, res); assert.equal(res.code, 400, JSON.stringify(body)); assert.match(res.body.message, re); }
});
test('FR22 PUT settings: privacy fields still work and do not mark settings as configured', async () => {
  reset(); const res = mkRes();
  await updateSettings({ user: { id: 'u1' }, body: { contributionVisibility: 'team', inferWorkMode: true } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.privacy.contributionVisibility, 'team'); assert.equal(res.body.privacy.inferWorkMode, true);
  assert.equal(db.lastUpdate.$set['settings.configuredAt'], undefined);
});
test('FR22 PUT settings: the user id always comes from the login, a client-supplied id is ignored', async () => {
  reset(); db.users.u2 = { _id: 'u2', privacy: {} }; const res = mkRes();
  await updateSettings({ user: { id: 'u1' }, body: { theme: 'dark', userId: 'u2', _id: 'u2' } }, res);
  assert.equal(db.users.u1.settings.theme, 'dark'); assert.equal(db.users.u2.settings, undefined);
});

// ============================ FR22: notification preferences are honoured ============================
const { notify } = require('../src/utils/notify');
test('FR22 notify: a switched-off category is not delivered, others still are', async () => {
  reset(); db.users.u1.settings = { notifications: { comments: false, mentions: true } };
  const a = await notify({ user: 'u1', actor: 'u9', type: 'comment_reply', message: 'x', link: {} });
  const b = await notify({ user: 'u1', actor: 'u9', type: 'mention', message: 'y', link: {} });
  assert.equal(a, null); assert.ok(b); assert.equal(db.notifications.length, 1); assert.equal(db.notifications[0].type, 'mention');
});
test('FR22 notify: a user who never saved settings still receives everything; unknown types are always delivered', async () => {
  reset();
  assert.ok(await notify({ user: 'u1', actor: 'u9', type: 'task_assigned', message: 'x', link: {} }));
  assert.ok(await notify({ user: 'u1', actor: 'u9', type: 'some_future_type', message: 'y', link: {} }));
});

// ============================ FR11: creating the project from a confirmed plan ============================
const { createProjectFromPlan } = require('../src/controllers/aiProjectController');
const plan = { name: 'Library', description: 'd', milestones: [{ title: 'MVP', offsetDays: 14 }], tasks: [
  { title: 'A', priority: 'High', estimatedHours: 2, acceptanceCriteria: ['ok'], subtasks: ['s1'], labels: ['x'], milestoneIndex: 0, dependsOn: [] },
  { title: 'B', priority: 'Low', estimatedHours: 1, acceptanceCriteria: [], subtasks: [], labels: [], milestoneIndex: null, dependsOn: [0] } ] };
const post = async (body, r = 'Admin') => { role = r; const res = mkRes(); await createProjectFromPlan({ params: { workspaceId: 'w1' }, user: { id: 'u1' }, body }, res); return res; };

test('FR11 create: only Admin or Manager; non-members get 404', async () => {
  reset(); assert.equal((await post({ generationKey: 'k', plan }, 'Viewer')).code, 403); assert.equal((await post({ generationKey: 'k', plan }, 'Member')).code, 403);
  role = null; const res = mkRes(); await createProjectFromPlan({ params: { workspaceId: 'w1' }, user: { id: 'u1' }, body: { generationKey: 'k', plan } }, res); assert.equal(res.code, 404);
});
test('FR11 create: needs a generationKey and a usable plan', async () => {
  reset(); assert.equal((await post({ plan })).code, 400); assert.match((await post({ plan, generationKey: '  ' })).body.message, /generationKey is required/);
  assert.equal((await post({ generationKey: 'k', plan: { name: 'x', tasks: [] } })).code, 400);
  assert.equal(db.projects.length, 0);
});
test('FR11 create: builds the project, milestones, tasks (checklist from acceptance criteria, subtasks) and wires dependencies', async () => {
  reset(); const res = await post({ generationKey: 'key-1', plan });
  assert.equal(res.code, 201); assert.equal(db.projects.length, 1); assert.equal(db.tasks.length, 2);
  const p = db.projects[0]; assert.equal(p.template, 'ai-generated'); assert.equal(p.milestones.length, 1); assert.ok(p.columns.includes('Backlog'));
  const [a, b] = db.tasks; assert.equal(a.status, 'Backlog'); assert.deepEqual(a.checklist, [{ text: 'ok', done: false }]); assert.equal(a.subtasks[0].title, 's1'); assert.equal(a.milestone, 'ms0');
  assert.deepEqual(b.dependencies, [a._id]); assert.equal(db.activity.length, 1); assert.match(db.activity[0].message, /2 AI-planned tasks/);
});
test('FR11 create: a retried request with the same key returns the same project (no duplicate)', async () => {
  reset(); await post({ generationKey: 'same', plan }); const again = await post({ generationKey: 'same', plan });
  assert.equal(again.code, 200); assert.equal(again.body.duplicate, true); assert.equal(db.projects.length, 1); assert.equal(db.tasks.length, 2);
});
test('FR11 create: if saving a task fails, nothing is left behind (rollback)', async () => {
  reset(); db.failTaskSaveAt = 1; const res = await post({ generationKey: 'fail', plan });
  assert.equal(res.code, 500); assert.equal(db.projects.length, 0); assert.equal(db.tasks.length, 0);
});
