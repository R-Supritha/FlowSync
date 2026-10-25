// FR30: FlowSync posts into a project's chat channel. No database: in-memory stand-ins for the models.
// Run:  node --test --test-force-exit "verification/*.test.js"
const path = require('path');
const mongoose = require('mongoose');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const WS = '64f000000000000000000800'; const PROJ = '64f000000000000000000900';
const db = { channels: [], messages: [], projects: [], counter: 0, failMessage: false };
const nextId = () => { db.counter += 1; return `64f${String(db.counter).padStart(21, '0')}`; };
const chain = (get) => { const c = { select() { return c; }, lean() { return c; }, then: (res, rej) => Promise.resolve(get()).then(res, rej) }; return c; };
const dup = () => Object.assign(new Error('dup'), { code: 11000 });
const withObject = (doc) => { Object.defineProperty(doc, 'toObject', { enumerable: false, value: () => JSON.parse(JSON.stringify(doc)) }); return doc; };

stub('models/Channel.js', {
  find: (q) => chain(() => db.channels.filter((c) => String(c.workspace) === String(q.workspace))),
  create: async (doc) => {
    if (db.channels.some((c) => String(c.workspace) === String(doc.workspace) && c.name === doc.name)) throw dup();
    const c = withObject({ _id: nextId(), description: '', isArchived: false, ...doc }); db.channels.push(c); return c;
  },
});
stub('models/Message.js', {
  create: async (doc) => { if (db.failMessage) throw new Error('database is down'); const m = withObject({ _id: nextId(), createdAt: new Date(), ...doc }); db.messages.push(m); return m; },
  findOne: (q) => chain(() => [...db.messages].reverse().find((m) => String(m.channel) === String(q.channel) && m.bot === q.bot && m.botKind === q.botKind && new Date(m.createdAt) > new Date(q.createdAt.$gt)) || null),
});
stub('models/Project.js', { find: (q) => chain(() => db.projects.filter((p) => String(p.workspace) === String(q.workspace) && p.isArchived === q.isArchived)) });
stub('models/ActivityLog.js', { create: async () => ({ populate: async () => {}, toObject: () => ({}) }) });

const { postBotMessage } = require('../src/utils/chatBot');
const { logTaskStatusChange } = require('../src/utils/activity');
const chatBus = require('../src/utils/chatBus');
require('../src/controllers/chatController'); // loaded now, so every real model is set up before the next line
Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true }); // pretend the database is connected
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const post = (over = {}) => postBotMessage({ workspace: WS, project: PROJ, actor: 'u1', text: 'hello from FlowSync', kind: 'sprint', ...over });

beforeEach(() => {
  Object.assign(db, { channels: [], messages: [], counter: 0, failMessage: false, projects: [{ _id: PROJ, workspace: WS, name: 'Library Management System', isArchived: false }, { _id: '64f000000000000000000901', workspace: WS, name: 'Old Thing', isArchived: true }] });
  delete process.env.CHAT_BOT;
});

test('a bot post lands in the project channel (made on the spot if it does not exist yet), flagged as a bot message, and is announced live', async () => {
  const heard = []; const off = chatBus.subscribe(WS, (e) => heard.push(e));
  const out = await post({ text: '🚀 Sprint started: 3 tasks moved to To Do' });
  off();
  assert.deepEqual(db.channels.map((c) => `${c.kind}:${c.name}`).sort(), ['general:general', 'project:library-management-system']);
  const channel = db.channels.find((c) => c.kind === 'project');
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].bot, true); assert.equal(db.messages[0].botKind, 'sprint'); assert.equal(db.messages[0].author, undefined);
  assert.ok(String(db.messages[0].channel) === String(channel._id));
  assert.deepEqual(out.author, { _id: 'flowsync-bot', name: 'FlowSync' }); assert.equal(out.bot, true); assert.equal(out.text, '🚀 Sprint started: 3 tasks moved to To Do'); assert.deepEqual(out.reactions, []);
  assert.equal(heard.length, 1); assert.equal(heard[0].type, 'message'); assert.equal(heard[0].message._id, out._id);
});
test('a second post uses the same channel; text is trimmed and clipped; empty text posts nothing', async () => {
  await post({ text: '  first  ' }); await post({ text: 'x'.repeat(5000) });
  assert.equal(db.channels.length, 2); assert.equal(db.messages.length, 2);
  assert.equal(db.messages[0].text, 'first'); assert.equal(db.messages[1].text.length, 4000);
  for (const text of ['', '   ', null, undefined]) assert.equal(await post({ text }), null);
  assert.equal(db.messages.length, 2);
});
test('nothing is posted when the bot is switched off, for an archived or unknown project, or when ids are missing', async () => {
  process.env.CHAT_BOT = 'false'; assert.equal(await post(), null); delete process.env.CHAT_BOT;
  assert.equal(await post({ project: '64f000000000000000000901' }), null);                  // the archived project's channel is hidden
  assert.equal(await post({ project: '64f000000000000000000999' }), null);                  // no such project
  assert.equal(await post({ project: undefined }), null); assert.equal(await post({ workspace: undefined }), null);
  assert.equal(db.messages.length, 0);
});
test('it never throws: a database problem is logged and the answer is null', async () => {
  db.failMessage = true;
  const orig = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' '));
  let out; try { out = await post(); } finally { console.error = orig; }
  assert.equal(out, null); assert.match(logged.join(' '), /Chat bot post failed: database is down/);
});
test('the same kind of post is skipped inside its window, but a different kind or an older one goes through', async () => {
  assert.ok(await post({ kind: 'standup', dedupeHours: 6 }));
  assert.equal(await post({ kind: 'standup', dedupeHours: 6 }), null);                     // too soon
  assert.ok(await post({ kind: 'sprint', dedupeHours: 6 }));                                 // another kind
  assert.ok(await post({ kind: 'standup' }));                                                // no window asked for: always posts
  db.messages.filter((m) => m.botKind === 'standup').forEach((m) => { m.createdAt = new Date(Date.now() - 7 * 3600 * 1000); });
  assert.ok(await post({ kind: 'standup', dedupeHours: 6 }));                                // the earlier ones are older than 6 hours now
});
test('a task reaching Done is announced; any other move, or no move, is not', async () => {
  const project = { _id: PROJ, workspace: WS };
  const task = { _id: 't1', title: 'Login page', status: 'Done' };
  logTaskStatusChange({ task, project, actor: 'u1', previousStatus: 'Testing' }); await wait();
  assert.deepEqual(db.messages.map((m) => [m.botKind, m.text]), [['task_done', '✅ "Login page" is Done']]);
  logTaskStatusChange({ task: { ...task, status: 'Review' }, project, actor: 'u1', previousStatus: 'In Progress' }); await wait();
  logTaskStatusChange({ task, project, actor: 'u1', previousStatus: 'Done' }); await wait();                      // not a move
  assert.equal(db.messages.length, 1);
  process.env.CHAT_BOT = 'false';
  logTaskStatusChange({ task: { ...task, title: 'Second' }, project, actor: 'u1', previousStatus: 'Testing' }); await wait();
  assert.equal(db.messages.length, 1);                                                                              // switched off
});
