// FR21: profile picture upload and achievements. No database: in-memory stand-ins for the models,
// and a temporary folder for the pictures.
// Run:  node --test --test-force-exit "verification/*.test.js"
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsync-avatars-'));
process.env.AVATAR_DIR = path.join(TMP, 'avatars');
process.env.JWT_SECRET = 'test-secret';
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const oid = (n) => `64f${String(n).padStart(21, '0')}`;
const same = (a, b) => String(a) === String(b);
const clone = (o) => JSON.parse(JSON.stringify(o));
const chain = (get) => { const c = { select() { return c; }, sort() { return c; }, lean: async () => { const v = get(); return v && clone(v); }, then: (res, rej) => Promise.resolve(get()).then(res, rej) }; return c; };

const ME = oid(1); const RAJ = oid(2); const ANU = oid(3);
const db = { users: [], workspaces: [], teams: [], activity: [], aggregateCalls: 0, failAggregate: false };
const withSave = (u) => { Object.defineProperty(u, 'save', { enumerable: false, value: async () => {} }); return u; };

stub('models/User.js', {
  findById: (id) => chain(() => db.users.find((u) => same(u._id, id)) || null),
  findByIdAndUpdate: (id, updates) => { const u = db.users.find((x) => same(x._id, id)); if (u) Object.assign(u, updates); return chain(() => u || null); },
});
const wsMatches = (w, f) => (f.$and ? f.$and.every((x) => wsMatches(w, x)) : w.members.some((m) => same(m.user, f['members.user'])));
stub('models/Workspace.js', {
  find: (f) => chain(() => db.workspaces.filter((w) => wsMatches(w, f))),
  countDocuments: async (f) => db.workspaces.filter((w) => wsMatches(w, f)).length,
});
stub('models/Project.js', { find: () => chain(() => []) });
stub('models/Team.js', { find: (f) => chain(() => db.teams.filter((t) => f.workspace.$in.some((id) => same(id, t.workspace)) && t.members.some((m) => same(m.user, f['members.user'])))) });
stub('models/ActivityLog.js', {
  aggregate: async (pipeline) => {
    db.aggregateCalls += 1;
    if (db.failAggregate) throw new Error('database is down');
    const m = pipeline[0].$match; const counts = {};
    for (const a of db.activity) {
      if (!same(a.actor, m.actor) || !m.workspace.$in.some((id) => same(id, a.workspace)) || !m.type.$in.includes(a.type)) continue;
      if (a.meta && a.meta.matchedUser === false) continue;
      counts[a.type] = (counts[a.type] || 0) + 1;
    }
    return Object.entries(counts).map(([_id, n]) => ({ _id, n }));
  },
});

const { AVATAR_DIR, detectImage, avatarFileOf, mountAvatars } = require('../src/config/avatar');
const { computeAchievements, loadAchievementCounts, BADGES } = require('../src/utils/achievements');
const profileRouter = require('../src/routes/profileRoutes');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-but-valid-looking-png-body')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body-bytes')]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('gif-body-bytes')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 body')]);
const tok = (id) => jwt.sign({ id, role: 'Member' }, process.env.JWT_SECRET);

let base; let server; let staticServer; let staticBase;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api', profileRouter);
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${server.address().port}/api`;
  const app2 = express(); mountAvatars(app2);
  staticServer = await new Promise((r) => { const s = app2.listen(0, () => r(s)); });
  staticBase = `http://localhost:${staticServer.address().port}`;
});
after(() => { server.close(); staticServer.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => {
  for (const f of fs.readdirSync(AVATAR_DIR)) fs.rmSync(path.join(AVATAR_DIR, f), { force: true });
  db.users = [
    withSave({ _id: ME, name: 'Me', email: 'me@x.org', avatarUrl: '', privacy: {} }),
    withSave({ _id: RAJ, name: 'Raj', email: 'raj@x.org', avatarUrl: '', privacy: {} }),
    withSave({ _id: ANU, name: 'Anu', email: 'anu@x.org', avatarUrl: '', privacy: {} }),
  ];
  db.workspaces = []; db.teams = []; db.activity = []; db.aggregateCalls = 0; db.failAggregate = false;
  profileRouter.resetLimits();
});
const upload = async (bytes, { field = 'avatar', name = 'me.png', type = 'image/png', who = ME } = {}) => {
  const form = new FormData(); if (bytes) form.append(field, new Blob([bytes], { type }), name);
  const res = await fetch(`${base}/profile/avatar`, { method: 'POST', headers: who ? { Authorization: `Bearer ${tok(who)}` } : {}, body: form });
  return { status: res.status, data: await res.json() };
};
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tok(who)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};
const files = () => fs.readdirSync(AVATAR_DIR);

// ================================================================ what counts as a picture
test('detectImage: decided by the first bytes, so a renamed file is not a picture and SVG is never accepted', () => {
  assert.equal(detectImage(PNG).ext, 'png'); assert.equal(detectImage(JPG).ext, 'jpg'); assert.equal(detectImage(GIF).ext, 'gif'); assert.equal(detectImage(WEBP).ext, 'webp');
  for (const bad of [Buffer.from('hello world, definitely not a picture'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.from('%PDF-1.4 something long enough'), Buffer.alloc(3), null, 'text']) assert.equal(detectImage(bad), null);
  assert.equal(detectImage(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEfmt body')])), null);   // RIFF but not WebP
});
test('avatarFileOf: only our own files are ever touched', () => {
  assert.equal(avatarFileOf('/avatars/abc-123.png'), path.join(AVATAR_DIR, 'abc-123.png'));
  for (const bad of ['', null, undefined, 'https://x.org/a.png', '/avatars/../secret.txt', '/avatars/..%2fsecret', '/avatars/a/b.png', '/avatars/.hidden', '/uploads/a.png', 'avatars/a.png', '/avatars/']) assert.equal(avatarFileOf(bad), null, String(bad));
});

// ================================================================ upload
test('upload: a real picture is saved under a random name and the profile points to it', async () => {
  const r = await upload(PNG);
  assert.equal(r.status, 200); assert.match(r.data.user.avatarUrl, new RegExp(`^/avatars/${ME}-[0-9a-f]{16}\\.png$`));
  assert.equal(db.users[0].avatarUrl, r.data.user.avatarUrl);
  assert.deepEqual(fs.readFileSync(path.join(AVATAR_DIR, path.basename(r.data.user.avatarUrl))), PNG);
});
test('upload: JPEG, GIF and WebP work, and the extension follows the real type, not the file name', async () => {
  for (const [bytes, ext] of [[JPG, 'jpg'], [GIF, 'gif'], [WEBP, 'webp']]) {
    const r = await upload(bytes, { name: 'whatever.png', type: 'image/png' });
    assert.equal(r.status, 200, ext); assert.ok(r.data.user.avatarUrl.endsWith(`.${ext}`), ext);
  }
});
test('upload: a new picture replaces the old one, and the old file is removed', async () => {
  const first = (await upload(PNG)).data.user.avatarUrl;
  const second = (await upload(JPG)).data.user.avatarUrl;
  assert.notEqual(first, second);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(files(), [path.basename(second)]);
});
test('upload: things that are not pictures are refused, and nothing is saved', async () => {
  const text = await upload(Buffer.from('this is plain text pretending to be a picture'), { name: 'cat.png', type: 'image/png' });
  assert.equal(text.status, 400); assert.match(text.data.message, /not a PNG, JPEG, GIF or WebP/);
  const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { name: 'a.svg', type: 'image/svg+xml' });
  assert.equal(svg.status, 400);
  assert.equal((await upload(Buffer.alloc(4), {})).status, 400);                                  // too small to be anything
  assert.equal((await upload(null)).status, 400);                                                 // no file at all
  const wrongField = await upload(PNG, { field: 'picture' });
  assert.equal(wrongField.status, 400); assert.match(wrongField.data.message, /"avatar" field/);
  assert.deepEqual(files(), []); assert.equal(db.users[0].avatarUrl, '');
});
test('upload: more than 2 MB is refused', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  const r = await upload(big);
  assert.equal(r.status, 400); assert.match(r.data.message, /at most 2 MB/); assert.deepEqual(files(), []);
});
test('upload: needs a login; at most 20 changes per 10 minutes', async () => {
  assert.equal((await upload(PNG, { who: null })).status, 401);
  for (let i = 0; i < 20; i += 1) assert.equal((await upload(PNG)).status, 200, String(i));
  const r = await upload(PNG);
  assert.equal(r.status, 429); assert.match(r.data.message, /too often/);
});
test('remove: clears the picture and deletes the file; doing it twice is harmless', async () => {
  const url = (await upload(PNG)).data.user.avatarUrl;
  const r = await call('DELETE', '/profile/avatar', ME);
  assert.equal(r.status, 200); assert.equal(db.users[0].avatarUrl, '');
  await new Promise((x) => setTimeout(x, 50)); assert.deepEqual(files(), []); assert.ok(url);
  assert.equal((await call('DELETE', '/profile/avatar', ME)).status, 200);
  assert.equal((await call('DELETE', '/profile/avatar')).status, 401);
});
test('SECURITY: replacing or removing a picture never deletes anything outside the pictures folder', async () => {
  const secret = path.join(TMP, 'secret.txt'); fs.writeFileSync(secret, 'keep me');
  for (const evil of ['/avatars/../secret.txt', '/avatars/..%2fsecret.txt', 'https://example.org/a.png', '/etc/passwd']) {
    db.users[0].avatarUrl = evil;
    assert.equal((await upload(PNG)).status, 200); db.users[0].avatarUrl = evil;
    assert.equal((await call('DELETE', '/profile/avatar', ME)).status, 200);
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.readFileSync(secret, 'utf8'), 'keep me');
});
test('a picture LINK saved through the profile replaces ours and removes our old file; an empty one clears', async () => {
  const url = (await upload(PNG)).data.user.avatarUrl;
  const r = await call('PUT', '/profile', ME, { avatarUrl: 'https://example.org/me.png' });
  assert.equal(r.status, 200); assert.equal(db.users[0].avatarUrl, 'https://example.org/me.png');
  await new Promise((x) => setTimeout(x, 50)); assert.deepEqual(files(), []); assert.ok(url);
  assert.equal((await call('PUT', '/profile', ME, { avatarUrl: '' })).status, 200);
  assert.equal((await call('PUT', '/profile', ME, { avatarUrl: 'javascript:alert(1)' })).status, 400);
});

// ================================================================ serving the pictures
test('serving: a picture is shown to other origins, a folder listing and outside paths are not', async () => {
  const url = (await upload(PNG)).data.user.avatarUrl;
  const res = await fetch(staticBase + url);
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/png'); assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  assert.equal((await fetch(`${staticBase}/avatars/`)).status, 404);
  fs.writeFileSync(path.join(TMP, 'secret.txt'), 'x'); fs.writeFileSync(path.join(AVATAR_DIR, '.hidden'), 'x');
  for (const p of ['/avatars/..%2fsecret.txt', '/avatars/%2e%2e/secret.txt', '/avatars/.hidden', '/avatars/nope.png']) assert.ok([403, 404].includes((await fetch(staticBase + p)).status), p);
});

// ================================================================ achievements: the rules
test('achievements: thresholds, progress shown as current / target, and the total', () => {
  const none = computeAchievements({});
  assert.equal(none.total, BADGES.length); assert.equal(none.earned, 0); assert.ok(none.badges.every((b) => b.current === 0 && !b.earned));
  const some = computeAchievements({ tasksCompleted: 10, commits: 1, comments: 4 });
  const by = Object.fromEntries(some.badges.map((b) => [b.id, b]));
  assert.ok(by['first-task'].earned && by['task-finisher'].earned && by['first-commit'].earned);
  assert.ok(!by['task-master'].earned && by['task-master'].current === 10 && by['task-master'].target === 50);
  assert.ok(!by['team-voice'].earned && by['team-voice'].current === 4 && by['committer'].current === 1);
  assert.equal(some.earned, 3);
  assert.equal(computeAchievements({ tasksCompleted: 999 }).badges.find((b) => b.id === 'task-master').current, 50);   // never above the target
  assert.equal(computeAchievements({ commits: 'x', tasksCompleted: -3 }).earned, 0);                                  // nonsense counts as nothing
});
test('achievements: counted from the person\'s own recorded activity; unmatched GitHub events and other people never count', async () => {
  const w1 = oid(10); const w2 = oid(11);
  db.activity = [
    ...Array.from({ length: 3 }, () => ({ actor: ME, workspace: w1, type: 'task_completed' })),
    { actor: ME, workspace: w2, type: 'task_completed' },
    { actor: ME, workspace: w1, type: 'commit_pushed', meta: { matchedUser: true } },
    { actor: ME, workspace: w1, type: 'commit_pushed', meta: { matchedUser: false } },     // credited to the linker, not really theirs
    { actor: ME, workspace: w1, type: 'task_updated' },                                    // a kind that has no badge
    { actor: RAJ, workspace: w1, type: 'task_completed' },                                 // someone else's work
  ];
  assert.deepEqual(await loadAchievementCounts(ME, [w1]), { tasksCompleted: 3, tasksCreated: 0, comments: 0, commits: 1, prsMerged: 0 });
  assert.equal((await loadAchievementCounts(ME, [w1, w2])).tasksCompleted, 4);
  const before = db.aggregateCalls;
  assert.deepEqual(await loadAchievementCounts(ME, []), { tasksCompleted: 0, tasksCreated: 0, comments: 0, commits: 0, prsMerged: 0 });
  assert.equal(db.aggregateCalls, before);                                                  // no workspaces: the database is not even asked
});

// ================================================================ achievements: who may see them
const member = (user, role = 'Member') => ({ user, role });
function twoWorkspaces() {
  const wA = oid(20); const wB = oid(21);
  db.workspaces = [
    { _id: wA, name: 'Shared A', members: [member(ME, 'Manager'), member(RAJ)] },     // I am a Manager in A
    { _id: wB, name: 'Shared B', members: [member(ME), member(RAJ)] },                // only a Member in B
    { _id: oid(22), name: 'Raj only', members: [member(RAJ)] },                       // I am not in this one
  ];
  db.activity = [
    ...Array.from({ length: 2 }, () => ({ actor: RAJ, workspace: wA, type: 'task_completed' })),
    ...Array.from({ length: 3 }, () => ({ actor: RAJ, workspace: wB, type: 'task_completed' })),
    ...Array.from({ length: 4 }, () => ({ actor: RAJ, workspace: oid(22), type: 'task_completed' })),
  ];
  return { wA, wB };
}
const rajsTasks = (res) => res.data.achievements && res.data.achievements.badges.find((b) => b.id === 'task-master').current;
test('my own profile shows my achievements from all my workspaces', async () => {
  const { wA } = twoWorkspaces(); db.activity.push({ actor: ME, workspace: wA, type: 'task_completed' });
  const r = await call('GET', '/profile', ME);
  assert.equal(r.status, 200); assert.equal(r.data.achievements.earned, 1); assert.equal(rajsTasks(r), 1);
});
test('someone else\'s achievements are hidden by default (their contributions are private), and the privacy settings are never sent', async () => {
  twoWorkspaces();
  const r = await call('GET', `/users/${RAJ}/profile`, ME);
  assert.equal(r.status, 200); assert.equal(r.data.achievements, null); assert.equal(r.data.achievementsHidden, true);
  assert.ok(!('privacy' in r.data.user) && !('privacy' in r.data));
});
test('"everyone" shows them, counting only workspaces we share', async () => {
  twoWorkspaces(); db.users[1].privacy = { contributionVisibility: 'everyone' };
  const r = await call('GET', `/users/${RAJ}/profile`, ME);
  assert.equal(r.data.achievementsHidden, false); assert.equal(rajsTasks(r), 5);          // 2 + 3, never the 4 from the workspace I am not in
  assert.equal(r.data.achievements.earned, 1);                                              // 5 completed tasks earn "First task done" only (the next badge needs 10)
});
test('"managers" counts only the workspaces where I am a Manager or Admin', async () => {
  twoWorkspaces(); db.users[1].privacy = { contributionVisibility: 'managers' };
  const r = await call('GET', `/users/${RAJ}/profile`, ME);
  assert.equal(rajsTasks(r), 2);                                                            // only Shared A, where I manage
});
test('"team" shows them only to a teammate', async () => {
  const { wA } = twoWorkspaces(); db.users[1].privacy = { contributionVisibility: 'team' };
  assert.equal((await call('GET', `/users/${RAJ}/profile`, ME)).data.achievementsHidden, true);
  db.teams = [{ workspace: wA, members: [member(ME), member(RAJ)] }];
  const r = await call('GET', `/users/${RAJ}/profile`, ME);
  assert.equal(r.data.achievementsHidden, false);
});
test('people who share no workspace get a 404; a database problem in achievements never breaks the profile', async () => {
  twoWorkspaces();
  assert.equal((await call('GET', `/users/${ANU}/profile`, ME)).status, 404);
  db.failAggregate = true; const orig = console.error; console.error = () => {};
  let r; try { r = await call('GET', '/profile', ME); } finally { console.error = orig; }
  assert.equal(r.status, 200); assert.equal(r.data.achievements, null); assert.equal(r.data.user.name, 'Me');
});
