// FR2: workspace settings (rename), changing a member's role, and deleting a workspace.
// No database: every model is an in-memory stand-in, so we can check exactly what gets deleted.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const oid = (n) => `64f${String(n).padStart(21, '0')}`;
const U = { admin: oid(1), admin2: oid(2), manager: oid(3), member: oid(4), viewer: oid(5), outsider: oid(6), newbie: oid(7) };
const W1 = oid(100); const W2 = oid(200);

// ---- a tiny in-memory collection that understands the filters the cleanup uses
const same = (a, b) => String(a) === String(b);
const hit = (row, filter) => Object.entries(filter).every(([k, v]) => {
  if (k === '$or') return v.some((f) => hit(row, f));
  if (v && typeof v === 'object' && v.$in) return v.$in.some((x) => same(row[k], x));
  return same(row[k], v);
});
const collections = {};
function collection(name) {
  const c = {
    rows: [],
    find: (f) => ({ select() { return this; }, lean: async () => c.rows.filter((r) => hit(r, f)).map((r) => ({ ...r })) }),
    deleteMany: async (f) => { const keep = c.rows.filter((r) => !hit(r, f)); const n = c.rows.length - keep.length; c.rows = keep; return { deletedCount: n }; },
    updateMany: async (f, upd) => { c.rows.filter((r) => hit(r, f)).forEach((r) => Object.assign(r, upd.$set)); },
  };
  collections[name] = c; return c;
}
for (const name of ['Project', 'Task', 'Comment', 'FileAsset', 'Team', 'TeamProject', 'GithubLink', 'GithubEvent', 'ActivityLog', 'Notification', 'Presence', 'Channel', 'Message', 'ChannelRead']) stub(`models/${name}.js`, collection(name));

// ---- workspaces and users
const db = { workspaces: [], users: [] };
const wrap = (ws) => {
  Object.defineProperty(ws, 'save', { enumerable: false, value: async () => {} });
  Object.defineProperty(ws, 'deleteOne', { enumerable: false, value: async () => { db.workspaces = db.workspaces.filter((w) => w !== ws); } });
  return ws;
};
stub('models/Workspace.js', { findById: async (id) => db.workspaces.find((w) => same(w._id, id)) || null });
stub('models/User.js', {
  findOne: async (q) => db.users.find((u) => u.email === q.email) || null,
  findById: (id) => { const u = db.users.find((x) => same(x._id, id)) || null; return { select: async () => u }; },
});

const unlinked = []; const realUnlink = fs.unlink;
const workspaceRouter = require('../src/routes/workspaceRoutes');
const tok = (id) => jwt.sign({ id, role: 'Member' }, process.env.JWT_SECRET);

let base; let server;
before(async () => {
  fs.unlink = (p, cb) => { unlinked.push(path.basename(p)); if (cb) cb(); };
  const app = express(); app.use(express.json()); app.use('/api/workspaces', workspaceRouter);
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${server.address().port}/api/workspaces`;
});
after(() => { fs.unlink = realUnlink; server.close(); });

function seedWorkspace(num, tag) {
  const w = oid(num);
  const id = (n) => oid(num + n);
  collections.Project.rows.push({ _id: id(1), workspace: w, name: `P-${tag}` });
  collections.Task.rows.push({ _id: id(2), project: id(1), workspace: w }, { _id: id(3), project: id(1), workspace: w });
  collections.Comment.rows.push({ _id: id(4), task: id(2) }, { _id: id(5), task: id(3) });
  collections.FileAsset.rows.push({ _id: id(6), workspace: w, storedName: `file-${tag}.pdf` });
  collections.Team.rows.push({ _id: id(7), workspace: w });
  collections.TeamProject.rows.push({ _id: id(8), team: id(7), project: id(1) });
  collections.GithubLink.rows.push({ _id: id(9), project: id(1), workspace: w });
  collections.GithubEvent.rows.push({ _id: id(10), project: id(1) });
  collections.ActivityLog.rows.push({ _id: id(11), workspace: w, project: id(1) });
  collections.Notification.rows.push({ _id: id(12), workspace: w });
  collections.Channel.rows.push({ _id: id(13), workspace: w });
  collections.Message.rows.push({ _id: id(14), workspace: w, channel: id(13) }, { _id: id(15), workspace: w, channel: id(13) });
  collections.ChannelRead.rows.push({ _id: id(16), channel: id(13) });
  collections.Presence.rows.push({ _id: id(17), user: U.member, workingOn: id(2) });
}
const sizes = () => Object.fromEntries(Object.entries(collections).map(([k, c]) => [k, c.rows.length]));

beforeEach(() => {
  for (const c of Object.values(collections)) c.rows = [];
  unlinked.length = 0;
  db.workspaces = [
    wrap({ _id: W1, name: 'Alpha', description: 'first', owner: U.admin, members: [{ user: U.admin, role: 'Admin' }, { user: U.manager, role: 'Manager' }, { user: U.member, role: 'Member' }, { user: U.viewer, role: 'Viewer' }] }),
    wrap({ _id: W2, name: 'Beta', description: '', owner: U.admin2, members: [{ user: U.admin2, role: 'Admin' }, { user: U.member, role: 'Member' }] }),
  ];
  db.users = Object.entries(U).map(([name, _id]) => ({ _id, email: name === 'newbie' ? 'new@example.com' : `${name}@example.com` }));
});
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tok(who)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};
const roleOf = (ws, user) => ws.members.find((m) => same(m.user, user))?.role;

// ================================================================ invite: roles are checked now
test('invite: only real roles; only an Admin can make an Admin; the email is checked', async () => {
  assert.equal((await call('POST', `/${W1}/invite`, U.admin, { email: 'new@example.com', role: 'Superuser' })).status, 400);
  assert.equal((await call('POST', `/${W1}/invite`, U.admin, { email: 'not-an-email' })).status, 400);
  assert.equal((await call('POST', `/${W1}/invite`, U.admin, {})).status, 400);
  const escalate = await call('POST', `/${W1}/invite`, U.manager, { email: 'new@example.com', role: 'Admin' });
  assert.equal(escalate.status, 403); assert.match(escalate.data.message, /Only Admin can invite someone as Admin/);
  assert.equal(db.workspaces[0].members.length, 4);
  assert.equal((await call('POST', `/${W1}/invite`, U.member, { email: 'new@example.com' })).status, 403);
  assert.equal((await call('POST', `/${W1}/invite`, U.admin, { email: 'ghost@example.com' })).status, 404);
  assert.equal((await call('POST', `/${W1}/invite`, U.manager, { email: 'NEW@example.com', role: 'Viewer' })).status, 200);       // a Manager can invite lower roles, any capital letters
  assert.equal(roleOf(db.workspaces[0], U.newbie), 'Viewer');
  assert.equal((await call('POST', `/${W1}/invite`, U.admin, { email: 'new@example.com' })).status, 409);
  db.users.push({ _id: oid(8), email: 'boss@example.com' });
  assert.equal((await call('POST', `/${W1}/invite`, U.admin, { email: 'boss@example.com', role: 'Admin' })).status, 200);       // an Admin can
});

// ================================================================ workspace settings
test('settings: Admin and Manager can rename and describe; Member, Viewer and strangers cannot', async () => {
  for (const who of [U.admin, U.manager]) {
    const r = await call('PATCH', `/${W1}`, who, { name: '  Renamed  ', description: ' new text ' });
    assert.equal(r.status, 200); assert.equal(r.data.workspace.name, 'Renamed'); assert.equal(r.data.workspace.description, 'new text');
  }
  for (const who of [U.member, U.viewer]) assert.equal((await call('PATCH', `/${W1}`, who, { name: 'Hacked' })).status, 403);
  assert.equal((await call('PATCH', `/${W1}`, U.outsider, { name: 'Hacked' })).status, 404);
  assert.equal(db.workspaces[0].name, 'Renamed');
  assert.equal((await call('PATCH', `/${W1}`, undefined, { name: 'x' })).status, 401);
  assert.equal((await call('PATCH', '/abc', U.admin, { name: 'x' })).status, 400);
  assert.equal(db.workspaces[1].name, 'Beta');                                                                                   // the other workspace is untouched
});
test('settings: bad names and descriptions are refused', async () => {
  for (const body of [{ name: '' }, { name: '   ' }, { name: 5 }, { name: 'x'.repeat(101) }, { description: 'y'.repeat(501) }, { description: 5 }, {}]) {
    assert.equal((await call('PATCH', `/${W1}`, U.admin, body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await call('PATCH', `/${W1}`, U.admin, { description: '' })).status, 200);                                       // clearing the description is allowed
  assert.equal(db.workspaces[0].name, 'Alpha');
});

// ================================================================ change a member's role
test('roles: only an Admin can change a role, to a real role, for a real member', async () => {
  const ok = await call('PATCH', `/${W1}/members/${U.member}`, U.admin, { role: 'Manager' });
  assert.equal(ok.status, 200); assert.equal(roleOf(db.workspaces[0], U.member), 'Manager');
  for (const who of [U.manager, U.member, U.viewer]) assert.equal((await call('PATCH', `/${W1}/members/${U.viewer}`, who, { role: 'Admin' })).status, 403, String(who));
  assert.equal(roleOf(db.workspaces[0], U.viewer), 'Viewer');
  assert.equal((await call('PATCH', `/${W1}/members/${U.outsider}`, U.admin, { role: 'Member' })).status, 404);
  for (const role of ['Boss', '', undefined, 5]) assert.equal((await call('PATCH', `/${W1}/members/${U.member}`, U.admin, { role })).status, 400, String(role));
  assert.equal((await call('PATCH', `/${W1}/members/${U.member}`, U.outsider, { role: 'Admin' })).status, 404);                // strangers learn nothing
  assert.equal((await call('PATCH', `/${W1}/members/xyz`, U.admin, { role: 'Member' })).status, 400);
  assert.equal(roleOf(db.workspaces[1], U.member), 'Member');                                                                   // another workspace untouched
});
test('roles: the last Admin cannot be demoted or removed; with a second Admin both are allowed', async () => {
  const demote = await call('PATCH', `/${W1}/members/${U.admin}`, U.admin, { role: 'Member' });
  assert.equal(demote.status, 400); assert.match(demote.data.message, /at least one Admin/);
  const remove = await call('DELETE', `/${W1}/members/${U.admin}`, U.admin);
  assert.equal(remove.status, 400); assert.match(remove.data.message, /at least one Admin/);
  assert.equal(roleOf(db.workspaces[0], U.admin), 'Admin');
  assert.equal((await call('PATCH', `/${W1}/members/${U.manager}`, U.admin, { role: 'Admin' })).status, 200);                    // now there are two
  assert.equal((await call('PATCH', `/${W1}/members/${U.admin}`, U.manager, { role: 'Member' })).status, 200);
  assert.equal(roleOf(db.workspaces[0], U.admin), 'Member');
  assert.equal((await call('DELETE', `/${W1}/members/${U.manager}`, U.manager)).status, 400);                                    // the one remaining Admin again
});
test('remove member: Admin only, the person must be a member, and the list shrinks', async () => {
  assert.equal((await call('DELETE', `/${W1}/members/${U.viewer}`, U.manager)).status, 403);
  assert.equal((await call('DELETE', `/${W1}/members/${U.outsider}`, U.admin)).status, 404);
  const r = await call('DELETE', `/${W1}/members/${U.viewer}`, U.admin);
  assert.equal(r.status, 200); assert.equal(roleOf(db.workspaces[0], U.viewer), undefined);
});

// ================================================================ delete a workspace
test('delete: only an Admin, and only after typing the exact workspace name', async () => {
  seedWorkspace(100, 'one');
  for (const who of [U.manager, U.member, U.viewer]) assert.equal((await call('DELETE', `/${W1}`, who, { confirmName: 'Alpha' })).status, 403, String(who));
  assert.equal((await call('DELETE', `/${W1}`, U.outsider, { confirmName: 'Alpha' })).status, 404);
  for (const body of [{}, { confirmName: '' }, { confirmName: 'alpha' }, { confirmName: 'Alph' }, { confirmName: 'Alpha ' + 'x' }, { confirmName: 5 }]) {
    const r = await call('DELETE', `/${W1}`, U.admin, body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.data.message, /exact workspace name/);
  }
  assert.equal((await call('DELETE', `/${oid(999)}`, U.admin, { confirmName: 'Alpha' })).status, 404);
  assert.equal(db.workspaces.length, 2); assert.equal(collections.Project.rows.length, 1);                                       // nothing was deleted by the refusals
});
test('delete: everything in the workspace goes, and NOTHING in another workspace is touched', async () => {
  seedWorkspace(100, 'one'); seedWorkspace(200, 'two');
  const before = sizes();
  assert.equal(before.Project, 2); assert.equal(before.Task, 4); assert.equal(before.Message, 4);
  const r = await call('DELETE', `/${W1}`, U.admin, { confirmName: ' Alpha ' });                                                 // surrounding spaces do not matter
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.deleted, { comments: 2, files: 1, tasks: 2, teams: 1, activity: 1, messages: 2, channels: 1, projects: 1 });
  assert.deepEqual(db.workspaces.map((w) => w.name), ['Beta']);
  const after = sizes();
  for (const [name, n] of Object.entries(before)) {
    if (name === 'Presence') assert.equal(after[name], n, 'presence belongs to people, not to the workspace: kept');   // only its "working on" pointer is cleared
    else assert.equal(after[name], n / 2, `${name}: exactly half should remain`);
  }
  for (const [name, c] of Object.entries(collections)) for (const row of c.rows) if (row.workspace !== undefined) assert.ok(same(row.workspace, W2), `${name} row left from the wrong workspace: ${JSON.stringify(row)}`);
  assert.ok(collections.Task.rows.every((t) => same(t.workspace, W2)) && collections.Comment.rows.every((c) => collections.Task.rows.some((t) => same(t._id, c.task))));
  assert.ok(collections.TeamProject.rows.every((tp) => collections.Team.rows.some((t) => same(t._id, tp.team))));
  assert.ok(collections.GithubEvent.rows.every((e) => collections.Project.rows.some((p) => same(p._id, e.project))));
  assert.ok(collections.ChannelRead.rows.every((x) => collections.Channel.rows.some((ch) => same(ch._id, x.channel))));
  assert.equal(collections.Project.rows[0].name, 'P-two');
  assert.deepEqual(collections.Message.rows.map((m) => m.workspace), [W2, W2]);
});
test('delete: uploaded files of that workspace are removed from disk, and nobody keeps pointing at a deleted task', async () => {
  seedWorkspace(100, 'one'); seedWorkspace(200, 'two');
  collections.Presence.rows.push({ _id: oid(9001), user: U.viewer, workingOn: oid(202) });                                       // working on a task of the OTHER workspace
  await call('DELETE', `/${W1}`, U.admin, { confirmName: 'Alpha' });
  assert.deepEqual(unlinked, ['file-one.pdf']);
  const p1 = collections.Presence.rows.find((p) => same(p._id, oid(117))); const p2 = collections.Presence.rows.find((p) => same(p._id, oid(9001)));
  assert.equal(p1.workingOn, null); assert.ok(same(p2.workingOn, oid(202)));
});
test('delete: a workspace with nothing in it can be deleted too', async () => {
  const r = await call('DELETE', `/${W1}`, U.admin, { confirmName: 'Alpha' });
  assert.equal(r.status, 200); assert.equal(r.data.deleted.projects, 0); assert.equal(db.workspaces.length, 1);
});
