// FR26 (channels) and FR27 (live messaging): checks for the chat backend.
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
    db.channels.push(c); return c;
  },
});
stub('models/Message.js', {
  create: async (doc) => { const m = withSave(db.messages, { _id: nextId(), createdAt: new Date(), ...doc }); db.messages.push(m); return m; },
  findById: (id) => chain(() => db.messages.find((m) => String(m._id) === String(id)) || null),
  find: (q) => chain(() => db.messages.filter((m) => String(m.channel) === String(q.channel)
    && (!q._id || ((q._id.$lt === undefined || String(m._id) < String(q._id.$lt)) && (q._id.$gt === undefined || String(m._id) > String(q._id.$gt)))))),
  findOne: (q) => chain(() => [...db.messages].reverse().find((m) => String(m.channel) === String(q.channel) && !m.deletedAt) || null),
  countDocuments: async (q) => db.messages.filter((m) => String(m.channel) === String(q.channel) && new Date(m.createdAt) > new Date(q.createdAt.$gt) && String(m.author) !== String(q.author.$ne) && !m.deletedAt).length,
});
stub('models/ChannelRead.js', {
  find: (q) => chain(() => db.reads.filter((r) => String(r.user) === String(q.user) && q.channel.$in.map(String).includes(String(r.channel)))),
  create: async (doc) => { if (db.reads.some((r) => String(r.user) === String(doc.user) && String(r.channel) === String(doc.channel))) throw dup(); db.reads.push({ ...doc }); },
  updateOne: async (q, upd) => { const r = db.reads.find((x) => String(x.user) === String(q.user) && String(x.channel) === String(q.channel)); if (r) Object.assign(r, upd.$set); else db.reads.push({ user: q.user, channel: q.channel, ...upd.$set }); },
});
stub('models/Project.js', { find: (q) => chain(() => db.projects.filter((p) => String(p.workspace) === String(q.workspace) && p.isArchived === q.isArchived)) });
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

// ================================================================ pure helpers
test('slugify: project names become channel names', () => {
  assert.equal(chatCtl.slugify('Library Management System'), 'library-management-system');
  assert.equal(chatCtl.slugify('  Web App!! v2  '), 'web-app-v2');
  assert.equal(chatCtl.slugify('???'), 'project');
  assert.equal(chatCtl.slugify('x'.repeat(80)).length, 40);
});
test('parseChannelName: lowercase letters, numbers and dashes only', () => {
  assert.equal(chatCtl.parseChannelName('  #Design Team ').value, 'design-team');
  for (const bad of ['', '   ', '-start', 'has_underscore', 'emoji😀', 'a'.repeat(41), null, undefined, 'dot.name']) assert.ok(chatCtl.parseChannelName(bad).error, String(bad));
});
test('parseText: trims, refuses empty and over-long messages', () => {
  assert.equal(chatCtl.parseText('  hi  ').value, 'hi');
  for (const bad of ['', '   \n ', 5, null, undefined, 'x'.repeat(4001)]) assert.ok(chatCtl.parseText(bad).error, String(bad).slice(0, 10));
  assert.equal(chatCtl.parseText('x'.repeat(4000)).value.length, 4000);
});

// ================================================================ FR26: channels
test('FR26 channels: #general and one channel per ACTIVE project appear on first visit, once', async () => {
  const first = await channelsOf();
  assert.deepEqual(first.map((c) => `${c.kind}:${c.name}`), ['general:general', 'project:library-management-system']);   // the archived project has none
  const again = await channelsOf();
  assert.equal(again.length, 2); assert.equal(db.channels.length, 2);                                                       // not created twice
  assert.equal(first[1].project, 'p-lib');
});
test('FR26 channels: a new project gets its channel on the next visit; an archived project\'s channel disappears', async () => {
  await channelsOf();
  db.projects.push({ _id: 'p-new', workspace: WS, name: 'Hackathon', isArchived: false });
  db.projects[0].isArchived = true;
  assert.deepEqual((await channelsOf()).map((c) => c.name), ['general', 'hackathon']);
});
test('FR26 channels: two projects with the same name get different channel names', async () => {
  db.projects.push({ _id: 'p-2', workspace: WS, name: 'Library Management System', isArchived: false });
  const names = (await channelsOf()).filter((c) => c.kind === 'project').map((c) => c.name).sort();
  assert.deepEqual(names, ['library-management-system', 'library-management-system-2']);
});
test('FR26 channels: only members can see them (404 otherwise); permissions are reported', async () => {
  role = null; assert.equal((await call('GET', `/workspaces/${WS}/channels`)).status, 404);
  role = 'Viewer'; let r = await call('GET', `/workspaces/${WS}/channels`); assert.equal(r.data.canPost, false); assert.equal(r.data.canManage, false);
  role = 'Member'; r = await call('GET', `/workspaces/${WS}/channels`); assert.equal(r.data.canPost, true); assert.equal(r.data.canManage, false);
  role = 'Manager'; r = await call('GET', `/workspaces/${WS}/channels`); assert.equal(r.data.canManage, true);
  assert.equal((await call('GET', '/workspaces/abc/channels')).status, 400);
});
test('FR26 create: Admin or Manager only; the name is cleaned, checked and unique', async () => {
  role = 'Member'; assert.equal((await call('POST', `/workspaces/${WS}/channels`, { name: 'x' })).status, 403);
  role = 'Viewer'; assert.equal((await call('POST', `/workspaces/${WS}/channels`, { name: 'x' })).status, 403);
  role = 'Manager';
  const ok = await call('POST', `/workspaces/${WS}/channels`, { name: '#Design Team', description: ' ideas ' });
  assert.equal(ok.status, 201); assert.equal(ok.data.channel.name, 'design-team'); assert.equal(ok.data.channel.kind, 'custom'); assert.equal(ok.data.channel.description, 'ideas');
  assert.equal((await call('POST', `/workspaces/${WS}/channels`, { name: 'design-team' })).status, 409);
  assert.equal((await call('POST', `/workspaces/${WS}/channels`, { name: 'general' })).status, 409);                  // #general is always taken
  assert.equal((await call('POST', `/workspaces/${WS}/channels`, { name: 'bad name!' })).status, 400);
  assert.equal((await call('POST', `/workspaces/${WS}/channels`, {})).status, 400);
});
test('FR26 update: only custom channels can be renamed or archived, only by Admin or Manager', async () => {
  const made = (await call('POST', `/workspaces/${WS}/channels`, { name: 'ideas' })).data.channel;
  const g = await general(); const proj = (await channelsOf()).find((c) => c.kind === 'project');
  assert.equal((await call('PATCH', `/channels/${g._id}`, { name: 'x' })).status, 400);
  assert.equal((await call('PATCH', `/channels/${proj._id}`, { archived: true })).status, 400);
  role = 'Member'; assert.equal((await call('PATCH', `/channels/${made._id}`, { name: 'x' })).status, 403);
  role = 'Admin';
  assert.equal((await call('PATCH', `/channels/${made._id}`, { name: 'Big Ideas' })).data.channel.name, 'big-ideas');
  assert.equal((await call('PATCH', `/channels/${made._id}`, { name: 'general' })).status, 409);
  assert.equal((await call('PATCH', `/channels/${made._id}`, { name: '!!' })).status, 400);
  await call('PATCH', `/channels/${made._id}`, { archived: true });
  assert.ok(!(await channelsOf()).some((c) => c._id === made._id));                                                // archived channels leave the list
  assert.equal((await call('POST', `/channels/${made._id}/messages`, { text: 'hi' })).status, 400);                // and cannot be posted to
});

// ================================================================ FR27: messages
test('FR27 send: a Member posts; the message has the author name and is returned in order', async () => {
  const g = await general();
  const a = await call('POST', `/channels/${g._id}/messages`, { text: '  hello team  ' });
  assert.equal(a.status, 201); assert.equal(a.data.message.text, 'hello team'); assert.deepEqual(a.data.message.author, { _id: 'u1', name: 'Sunitha' }); assert.equal(a.data.message.deleted, false);
  await call('POST', `/channels/${g._id}/messages`, { text: 'second' });
  const list = await call('GET', `/channels/${g._id}/messages`);
  assert.deepEqual(list.data.messages.map((m) => m.text), ['hello team', 'second']); assert.equal(list.data.hasMore, false);
});
test('FR27 send: Viewers cannot post; empty, blank and over-long messages are refused; strangers get 404', async () => {
  const g = await general();
  role = 'Viewer'; assert.equal((await call('POST', `/channels/${g._id}/messages`, { text: 'hi' })).status, 403);
  role = 'Member';
  for (const body of [{}, { text: '' }, { text: '  \n ' }, { text: 7 }, { text: 'x'.repeat(4001) }]) assert.equal((await call('POST', `/channels/${g._id}/messages`, body)).status, 400, JSON.stringify(body).slice(0, 30));
  role = null; assert.equal((await call('POST', `/channels/${g._id}/messages`, { text: 'hi' })).status, 404);
  assert.equal((await call('POST', '/channels/64f0000000000000000009ff/messages', { text: 'hi' })).status, 404);
  assert.equal(db.messages.length, 0);
});
test('FR27 send: text is stored as plain text (tags are not interpreted by the server)', async () => {
  const g = await general();
  const r = await call('POST', `/channels/${g._id}/messages`, { text: '<img src=x onerror=alert(1)> **hi**' });
  assert.equal(r.data.message.text, '<img src=x onerror=alert(1)> **hi**');     // the screen shows it as text, never as HTML
});
test('FR27 send: more than 20 messages in 10 seconds from one person get a 429', async () => {
  const g = await general();
  for (let i = 0; i < 20; i += 1) assert.equal((await call('POST', `/channels/${g._id}/messages`, { text: `m${i}` })).status, 201);
  const r = await call('POST', `/channels/${g._id}/messages`, { text: 'one too many' });
  assert.equal(r.status, 429); assert.match(r.data.message, /too fast/);
  assert.equal((await call('POST', `/channels/${g._id}/messages`, { text: 'other person' }, 'u2')).status, 201);   // the limit is per person
});
test('FR27 history: pages of messages with before / limit / hasMore, and after for catching up', async () => {
  const g = await general();
  for (let i = 1; i <= 7; i += 1) await call('POST', `/channels/${g._id}/messages`, { text: `m${i}` });
  const newest = await call('GET', `/channels/${g._id}/messages?limit=3`);
  assert.deepEqual(newest.data.messages.map((m) => m.text), ['m5', 'm6', 'm7']); assert.equal(newest.data.hasMore, true);
  const older = await call('GET', `/channels/${g._id}/messages?limit=3&before=${newest.data.messages[0]._id}`);
  assert.deepEqual(older.data.messages.map((m) => m.text), ['m2', 'm3', 'm4']); assert.equal(older.data.hasMore, true);
  const oldest = await call('GET', `/channels/${g._id}/messages?limit=3&before=${older.data.messages[0]._id}`);
  assert.deepEqual(oldest.data.messages.map((m) => m.text), ['m1']); assert.equal(oldest.data.hasMore, false);
  const newer = await call('GET', `/channels/${g._id}/messages?after=${older.data.messages[2]._id}`);
  assert.deepEqual(newer.data.messages.map((m) => m.text), ['m5', 'm6', 'm7']);
  assert.equal((await call('GET', `/channels/${g._id}/messages?before=nope`)).status, 400);
  assert.equal((await call('GET', `/channels/${g._id}/messages?limit=100000`)).status, 200);                       // the page size is capped
  role = null; assert.equal((await call('GET', `/channels/${g._id}/messages`)).status, 404);
});
test('FR27 edit: only the author edits, and the message is marked edited', async () => {
  const g = await general();
  const m = (await call('POST', `/channels/${g._id}/messages`, { text: 'first try' })).data.message;
  assert.equal((await call('PATCH', `/messages/${m._id}`, { text: 'hacked' }, 'u2')).status, 403);
  role = 'Admin'; assert.equal((await call('PATCH', `/messages/${m._id}`, { text: 'admin edit' }, 'u2')).status, 403);   // even an Admin cannot rewrite someone else's words
  const ok = await call('PATCH', `/messages/${m._id}`, { text: ' second try ' });
  assert.equal(ok.status, 200); assert.equal(ok.data.message.text, 'second try'); assert.ok(ok.data.message.editedAt);
  assert.equal((await call('PATCH', `/messages/${m._id}`, { text: '' })).status, 400);
  assert.equal((await call('PATCH', `/messages/${m._id}`, { text: 'x'.repeat(4001) })).status, 400);
  role = null; assert.equal((await call('PATCH', `/messages/${m._id}`, { text: 'x' })).status, 404);
});
test('FR27 delete: the author or an Admin/Manager deletes; the message stays as an empty "deleted" row', async () => {
  const g = await general();
  const mine = (await call('POST', `/channels/${g._id}/messages`, { text: 'oops' })).data.message;
  const theirs = (await call('POST', `/channels/${g._id}/messages`, { text: 'raj says' }, 'u2')).data.message;
  role = 'Member'; assert.equal((await call('DELETE', `/messages/${theirs._id}`)).status, 403);
  assert.equal((await call('DELETE', `/messages/${mine._id}`)).status, 200);
  role = 'Manager'; assert.equal((await call('DELETE', `/messages/${theirs._id}`)).status, 200);
  assert.equal((await call('DELETE', `/messages/${theirs._id}`)).status, 200);                                    // deleting twice is harmless
  const list = (await call('GET', `/channels/${g._id}/messages`)).data.messages;
  assert.deepEqual(list.map((m) => [m.deleted, m.text]), [[true, ''], [true, '']]);
  assert.equal((await call('PATCH', `/messages/${mine._id}`, { text: 'back' })).status, 400);                       // a deleted message cannot be edited
});
test('FR27 unread: first visit starts at zero; others\' new messages count; your own do not; reading clears it', async () => {
  const g = await general();
  assert.equal(g.unread, 0);
  const future = (n) => new Date(Date.now() + 60000 + n * 1000);
  db.messages.push(withSave(db.messages, { _id: nextId(), channel: g._id, workspace: WS, author: 'u2', text: 'hi from raj', createdAt: future(1) }));
  db.messages.push(withSave(db.messages, { _id: nextId(), channel: g._id, workspace: WS, author: 'u2', text: 'second', createdAt: future(2) }));
  db.messages.push(withSave(db.messages, { _id: nextId(), channel: g._id, workspace: WS, author: 'u1', text: 'my own', createdAt: future(3) }));
  db.messages.push(withSave(db.messages, { _id: nextId(), channel: g._id, workspace: WS, author: 'u2', text: 'gone', createdAt: future(4), deletedAt: future(5) }));
  const after1 = (await channelsOf()).find((c) => c.kind === 'general');
  assert.equal(after1.unread, 2); assert.equal(after1.lastMessage.text, 'my own'); assert.equal(after1.lastMessage.author, 'Sunitha');
  db.reads.find((r) => r.channel === g._id).lastReadAt = new Date(Date.now() + 120000);                              // pretend the channel was just read in the future
  assert.equal((await channelsOf()).find((c) => c.kind === 'general').unread, 0);
});
test('FR27 unread: reading a channel and sending in it mark it read', async () => {
  const g = await general();
  db.reads.find((r) => r.channel === g._id).lastReadAt = new Date(0);
  db.messages.push(withSave(db.messages, { _id: nextId(), channel: g._id, workspace: WS, author: 'u2', text: 'new', createdAt: new Date() }));
  assert.equal((await general()).unread, 1);
  assert.equal((await call('POST', `/channels/${g._id}/read`)).status, 200);
  assert.equal((await general()).unread, 0);
  db.reads.find((r) => r.channel === g._id).lastReadAt = new Date(0);
  await call('POST', `/channels/${g._id}/messages`, { text: 'replying' });
  assert.equal((await general()).unread, 0);
  role = null; assert.equal((await call('POST', `/channels/${g._id}/read`)).status, 404);
});

// ================================================================ FR27: the live stream (real HTTP)
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
test('FR27 stream: new, edited and deleted messages and new channels arrive live; the listener is removed when the page closes', async () => {
  const g = await general();
  const s = await openStream(WS);
  assert.equal(s.seen.status, 200); assert.match(s.seen.type, /text\/event-stream/);
  await s.waitFor('event: ready');
  assert.equal(chatBus.listenerCount(WS), 1);

  const m = (await call('POST', `/channels/${g._id}/messages`, { text: 'live one' })).data.message;
  await s.waitFor('event: message\n'); await s.waitFor('live one');
  await call('PATCH', `/messages/${m._id}`, { text: 'live edited' });
  await s.waitFor('event: message_edited'); await s.waitFor('live edited');
  await call('DELETE', `/messages/${m._id}`);
  await s.waitFor('event: message_deleted'); await s.waitFor(m._id);
  await call('POST', `/workspaces/${WS}/channels`, { name: 'fresh' });
  await s.waitFor('event: channel'); await s.waitFor('fresh');

  s.close();
  const t0 = Date.now(); while (chatBus.listenerCount(WS) > 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
  assert.equal(chatBus.listenerCount(WS), 0);
});
test('FR27 stream: another workspace never sees these messages; non-members cannot open the stream', async () => {
  const g = await general();
  const other = await openStream(WS2); await other.waitFor('event: ready');
  await call('POST', `/channels/${g._id}/messages`, { text: 'private to WS' });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!other.seen.text.includes('private to WS')); other.close();
  role = null;
  const denied = await openStream(WS); assert.equal(denied.seen.status, 404); denied.close();
});
