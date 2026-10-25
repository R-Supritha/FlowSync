// FR26 (archive and restore), FR28 (@mentions) and FR29 (task references) for the chat backend.
// No database and no internet: the models are small in-memory stand-ins. The live stream is tested for real over HTTP.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const http = require('http');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------- in-memory stand-ins for the models
const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const db = { channels: [], messages: [], reads: [], projects: [], users: { u1: 'Sunitha', u2: 'Raj' }, counter: 0 };
const nextId = () => { db.counter += 1; return `64f${String(db.counter).padStart(21, '0')}`; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const plain = (d) => clone(d);

const chain = (get) => {
  const c = { _lean: false, _sort: null, _limit: null, _populate: false,
    select() { return c; }, lean() { c._lean = true; return c; }, limit(n) { c._limit = n; return c; }, sort(s) { c._sort = s; return c; }, populate() { c._populate = true; return c; },
    then(res, rej) {
      let v = get();
      if (Array.isArray(v)) {
        if (c._sort) { const [[k, dir]] = Object.entries(c._sort); v = [...v].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * dir); }
        if (c._limit) v = v.slice(0, c._limit);
      }
      const fix = (d) => (d && c._populate && d.author ? Object.assign(c._lean ? plain(d) : d, { author: { _id: String(d.author._id || d.author), name: db.users[String(d.author._id || d.author)] || 'Someone' } }) : (c._lean && d ? plain(d) : d));
      return Promise.resolve(Array.isArray(v) ? v.map(fix) : fix(v)).then(res, rej);
    } };
  return c;
};
const dup = () => Object.assign(new Error('dup'), { code: 11000 });

const withSave = (collection, doc, uniqueKeys) => {
  Object.defineProperty(doc, 'save', { enumerable: false, value: async () => { if (uniqueKeys) for (const o of collection) if (o !== doc && uniqueKeys.every((k) => String(o[k]) === String(doc[k]))) throw dup(); } });
  Object.defineProperty(doc, 'toObject', { enumerable: false, value: () => plain(doc) });
  return doc;
};

stub('models/Channel.js', {
  find: (q) => chain(() => db.channels.filter((c) => String(c.workspace) === String(q.workspace))),
  findById: (id) => chain(() => db.channels.find((c) => String(c._id) === String(id)) || null),
  create: async (doc) => {
    if (db.channels.some((c) => String(c.workspace) === String(doc.workspace) && c.name === doc.name)) throw dup();
    const c = withSave(db.channels, { _id: nextId(), description: '', isArchived: false, createdAt: new Date(), ...doc }, ['workspace', 'name']);
    Object.defineProperty(c, 'deleteOne', { enumerable: false, value: async () => { db.channels = db.channels.filter((x) => x !== c); } });
    db.channels.push(c); return c;
  },
});
stub('models/Message.js', {
  create: async (doc) => { const m = withSave(db.messages, { _id: nextId(), createdAt: new Date(), ...doc }); db.messages.push(m); return m; },
  findById: (id) => chain(() => db.messages.find((m) => String(m._id) === String(id)) || null),
  find: (q) => chain(() => db.messages.filter((m) => String(m.channel) === String(q.channel)
    && (!q._id || ((q._id.$lt === undefined || String(m._id) < String(q._id.$lt)) && (q._id.$gt === undefined || String(m._id) > String(q._id.$gt)))))),
  findOne: (q) => chain(() => [...db.messages].reverse().find((m) => String(m.channel) === String(q.channel) && !m.deletedAt) || null),
  deleteMany: async (q) => { const before = db.messages.length; db.messages = db.messages.filter((m) => String(m.channel) !== String(q.channel)); return { deletedCount: before - db.messages.length }; },
  countDocuments: async (q) => db.messages.filter((m) => String(m.channel) === String(q.channel) && new Date(m.createdAt) > new Date(q.createdAt.$gt) && String(m.author) !== String(q.author.$ne) && !m.deletedAt).length,
});
stub('models/ChannelRead.js', {
  find: (q) => chain(() => db.reads.filter((r) => String(r.user) === String(q.user) && q.channel.$in.map(String).includes(String(r.channel)))),
  create: async (doc) => { if (db.reads.some((r) => String(r.user) === String(doc.user) && String(r.channel) === String(doc.channel))) throw dup(); db.reads.push({ ...doc }); },
  deleteMany: async (q) => { db.reads = db.reads.filter((r) => String(r.channel) !== String(q.channel)); },
  updateOne: async (q, upd) => { const r = db.reads.find((x) => String(x.user) === String(q.user) && String(x.channel) === String(q.channel)); if (r) Object.assign(r, upd.$set); else db.reads.push({ user: q.user, channel: q.channel, ...upd.$set }); },
});
stub('models/Project.js', { find: (q) => chain(() => db.projects.filter((p) => String(p.workspace) === String(q.workspace) && p.isArchived === q.isArchived)) });

// ---- extra stand-ins for this file: tasks, people, notifications
const people = [
  { _id: 'u1', name: 'Sunitha Adluru', email: 'sunitha@x.org' },
  { _id: 'u2', name: 'Raj Kumar', email: 'raj@x.org' },
  { _id: 'u3', name: 'Anu Menon', email: 'anu@x.org' },
  { _id: 'u4', name: 'Anu Rao', email: 'anu.rao@x.org' },          // "anu" is ambiguous: two people
];
db.tasks = []; db.notes = [];
stub('models/Task.js', { find: (q) => chain(() => db.tasks.filter((t) => String(t.workspace) === String(q.workspace) && t.isArchived === q.isArchived)) });
stub('models/Workspace.js', { findById: () => chain(() => ({ members: people.map((p) => ({ user: p._id, role: 'Member' })) })) });
stub('models/User.js', { find: () => chain(() => people), findById: () => ({ select: async () => null }) });
stub('models/Notification.js', { create: async (doc) => { db.notes.push(doc); return doc; } });

let role = 'Admin';
const access = require('../src/utils/access');
stub('utils/access.js', { ...access, getWorkspaceRole: async () => role });

const chatCtl = require('../src/controllers/chatController');
const chatBus = require('../src/utils/chatBus');
const chatRouter = require('../src/routes/chatRoutes');

const WS = '64f000000000000000000800'; const WS2 = '64f000000000000000000801';
const tokenFor = (id) => jwt.sign({ id, role: 'Member' }, process.env.JWT_SECRET);
let user = 'u1';
let base; let server;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api', chatRouter);
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());
beforeEach(() => {
  Object.assign(db, { channels: [], messages: [], reads: [], counter: 0, projects: [{ _id: 'p-lib', workspace: WS, name: 'Library Management System', isArchived: false }, { _id: 'p-old', workspace: WS, name: 'Old Thing', isArchived: true }] });
  role = 'Admin'; user = 'u1'; chatRouter.resetLimits();
});
const call = async (method, p, body, who = user) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(who)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};
const channelsOf = async () => (await call('GET', `/workspaces/${WS}/channels`)).data.channels;
const general = async () => (await channelsOf()).find((c) => c.kind === 'general');

function openStream(workspace, who = 'u1') {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/workspaces/${workspace}/chat/stream`, { headers: { Authorization: `Bearer ${tokenFor(who)}` } }, (res) => {
      const seen = { status: res.statusCode, type: res.headers['content-type'], text: '' };
      res.setEncoding('utf8'); res.on('data', (d) => { seen.text += d; });
      resolve({ seen, close: () => req.destroy(), waitFor: async (needle, ms = 2000) => { const t0 = Date.now(); while (!seen.text.includes(needle)) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${needle}\n${seen.text}`); await new Promise((r) => setTimeout(r, 10)); } } });
    });
    req.on('error', reject);
  });
}


beforeEach(() => { db.tasks = []; db.notes = []; });
const ID = (n) => `64f${String(n).padStart(21, '0')}`;                       // 24 characters, the last 6 are the task reference
const ref = (n) => `FS-${ID(n).slice(-6)}`;
const sendAs = async (channelId, text, who = 'u1') => (await call('POST', `/channels/${channelId}/messages`, { text }, who));
const customChannel = async (name = 'ideas') => (await call('POST', `/workspaces/${WS}/channels`, { name })).data.channel;
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ================================================================ archive and restore (FR26)
test('archive: the channel leaves the list for everybody, its messages are kept, and nobody can post in it', async () => {
  const c = await customChannel(); await sendAs(c._id, 'before archiving');
  assert.equal((await call('PATCH', `/channels/${c._id}`, { archived: true })).data.archived, true);
  assert.ok(!(await channelsOf()).some((x) => x._id === c._id));
  const post = await sendAs(c._id, 'too late');
  assert.equal(post.status, 400); assert.match(post.data.message, /archived/);
  assert.deepEqual(db.messages.map((m) => m.text), ['before archiving']);
});
test('restore: an archived channel comes back with all its messages', async () => {
  const c = await customChannel(); await sendAs(c._id, 'keep me');
  await call('PATCH', `/channels/${c._id}`, { archived: true });
  assert.equal((await call('PATCH', `/channels/${c._id}`, { archived: false })).data.archived, false);
  assert.ok((await channelsOf()).some((x) => x._id === c._id));
  assert.deepEqual((await call('GET', `/channels/${c._id}/messages`)).data.messages.map((m) => m.text), ['keep me']);
  assert.equal((await sendAs(c._id, 'back again')).status, 201);
});
test('the archived list: Admin or Manager only, custom channels only, newest rules unchanged for the normal list', async () => {
  const a = await customChannel('old-plan'); const b = await customChannel('live-plan');
  await call('PATCH', `/channels/${a._id}`, { archived: true });
  const list = await call('GET', `/workspaces/${WS}/channels?archived=true`);
  assert.equal(list.status, 200); assert.deepEqual(list.data.channels.map((c) => c.name), ['old-plan']);        // not #general, not the project channel, not the live one
  assert.deepEqual((await channelsOf()).map((c) => c.name).sort(), ['general', 'library-management-system', 'live-plan']);
  for (const r of ['Member', 'Viewer']) { role = r; const denied = await call('GET', `/workspaces/${WS}/channels?archived=true`); assert.equal(denied.status, 403, r); assert.match(denied.data.message, /Admin or Manager/); }
  role = null; assert.equal((await call('GET', `/workspaces/${WS}/channels?archived=true`)).status, 404);
  role = 'Manager'; assert.equal((await call('GET', `/workspaces/${WS}/channels?archived=true`)).status, 200);
  assert.ok(b);
});
test('archive and restore: Admin or Manager only, custom channels only, and everyone is told live', async () => {
  const c = await customChannel(); const g = await general(); const proj = (await channelsOf()).find((x) => x.kind === 'project');
  role = 'Member'; assert.equal((await call('PATCH', `/channels/${c._id}`, { archived: true })).status, 403);
  role = 'Admin';
  for (const managed of [g, proj]) assert.equal((await call('PATCH', `/channels/${managed._id}`, { archived: true })).status, 400);
  const s = await openStream(WS); await s.waitFor('event: ready');
  await call('PATCH', `/channels/${c._id}`, { archived: true }); await s.waitFor('event: channel'); await s.waitFor(c.name);
  s.close();
});

// ================================================================ @mentions (FR28)
test('mention: @raj tells Raj, with the channel to open, and nobody else', async () => {
  const g = await general();
  const r = await sendAs(g._id, 'can you check this @raj ?'); await wait();
  assert.equal(r.status, 201);
  assert.equal(db.notes.length, 1);
  assert.equal(db.notes[0].user, 'u2'); assert.equal(db.notes[0].type, 'mention'); assert.equal(db.notes[0].message, 'Sunitha mentioned you in #general');
  assert.equal(String(db.notes[0].link.channel), String(g._id)); assert.equal(String(db.notes[0].link.workspace), WS);
});
test('mention: first name, full name and email start all work, in any capital letters, with punctuation after them', async () => {
  const g = await general();
  await sendAs(g._id, 'thanks @RAJ.'); await wait();                                          // a full stop after the name is not part of it
  await sendAs(g._id, 'cc @rajkumar and @Sunitha, nice', 'u2'); await wait();
  assert.deepEqual(db.notes.map((n) => n.user), ['u2', 'u1']);                                // Raj by first name, then Sunitha; Raj mentioning himself (as @rajkumar) tells nobody
});
test('mention: you are never told about your own message, and several mentions each tell their person once', async () => {
  const g = await general();
  await sendAs(g._id, 'note to self @sunitha'); await wait();
  assert.equal(db.notes.length, 0);
  await sendAs(g._id, '@raj @raj @RAJ and @anumenon'); await wait();
  assert.deepEqual(db.notes.map((n) => n.user).sort(), ['u2', 'u3']);                         // Raj once, Anu Menon (by her full name without spaces) once
});
test('mention: unknown names, ambiguous names and e-mail addresses tell nobody', async () => {
  const g = await general();
  await sendAs(g._id, '@nobody please look'); await sendAs(g._id, 'hello @anu'); await sendAs(g._id, 'write to raj@x.org about it'); await wait();
  assert.equal(db.notes.length, 0);                                                           // "@anu" could be Anu Menon or Anu Rao: not guessed
});
test('mention: at most 10 people per message, and editing a message does not tell anyone again', async () => {
  const g = await general();
  const many = Array.from({ length: 14 }, (_, i) => `@person${i}`).join(' ') + ' @raj';
  await sendAs(g._id, many); await wait();
  assert.equal(db.notes.length, 0);                                                           // Raj was the 15th handle: beyond the 10 that are looked at
  const m = (await sendAs(g._id, 'hello')).data.message;
  await call('PATCH', `/messages/${m._id}`, { text: 'hello @raj' }); await wait();
  assert.equal(db.notes.length, 0);
});

// ================================================================ task references (FR29)
const lookup = (refs, who = 'u1') => call('POST', `/workspaces/${WS}/chat/task-refs`, { refs }, who);
test('task refs: each reference is answered with its task, in any of the usual forms', async () => {
  db.tasks = [{ _id: ID(101), workspace: WS, title: 'Build login page', status: 'In Progress', project: 'p-lib', isArchived: false }, { _id: ID(102), workspace: WS, title: 'Write tests', status: 'To Do', project: 'p-lib', isArchived: false }];
  const r = await lookup([ref(101), ID(102).slice(-6), ref(101).toUpperCase(), 'not-a-ref', 'FS-zzzzzz', 7]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.tasks.map((t) => [t.ref, t.title, t.status, t.project]).sort(), [[ref(101), 'Build login page', 'In Progress', 'p-lib'], [ref(102), 'Write tests', 'To Do', 'p-lib']]);
});
test('task refs: unknown, archived, ambiguous and other-workspace tasks are left out', async () => {
  db.tasks = [
    { _id: ID(201), workspace: WS, title: 'Mine', status: 'To Do', project: 'p', isArchived: false },
    { _id: ID(202), workspace: WS, title: 'Archived one', status: 'To Do', project: 'p', isArchived: true },
    { _id: ID(203), workspace: WS2, title: 'Somebody else\'s workspace', status: 'To Do', project: 'q', isArchived: false },
    { _id: ID(204), workspace: WS, title: 'Twin A', status: 'To Do', project: 'p', isArchived: false },
    { _id: `64e${'0'.repeat(15)}${ID(204).slice(-6)}`, workspace: WS, title: 'Twin B', status: 'To Do', project: 'p', isArchived: false },   // same last six characters
  ];
  const r = await lookup([ref(201), ref(202), ref(203), ref(204), 'FS-abcdef']);
  assert.deepEqual(r.data.tasks.map((t) => t.title), ['Mine']);
});
test('task refs: needs a list of at most 30, an empty list is fine, strangers get 404, Viewers can look', async () => {
  assert.equal((await lookup('FS-123456')).status, 400); assert.equal((await lookup(undefined)).status, 400);
  assert.equal((await lookup(Array.from({ length: 31 }, (_, i) => ref(i)))).status, 400);
  assert.deepEqual((await lookup([])).data.tasks, []);
  role = 'Viewer'; assert.equal((await lookup([ref(1)])).status, 200);
  role = null; assert.equal((await lookup([ref(1)])).status, 404);
  assert.equal((await call('POST', '/workspaces/abc/chat/task-refs', { refs: [] })).status, 400);
});
test('task refs: a person is limited to 30 look-ups per 10 seconds', async () => {
  for (let i = 0; i < 30; i += 1) assert.equal((await lookup([ref(1)])).status, 200, String(i));
  const r = await lookup([ref(1)]);
  assert.equal(r.status, 429); assert.match(r.data.message, /Too many task look-ups/);
});
