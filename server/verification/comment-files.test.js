// FR8: attachments on comments. No database: in-memory stand-ins for the models, and a temporary folder for the files,
// so we can check what really stays on (or leaves) the disk.
// Run:  node --test --test-force-exit "verification/*.test.js"
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsync-uploads-'));
process.env.UPLOAD_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const oid = (n) => `64f${String(n).padStart(21, '0')}`;
const same = (a, b) => String(a) === String(b);
const clone = (o) => JSON.parse(JSON.stringify(o));
const chain = (get) => { const c = { select() { return c; }, sort() { return c; }, populate() { return c; }, lean: async () => clone(get()), then: (res, rej) => Promise.resolve(get()).then(res, rej) }; return c; };

const U = { author: oid(1), other: oid(2), manager: oid(3), viewer: oid(4), stranger: oid(5) };
const WS = oid(100); const T1 = oid(201); const T2 = oid(202);
const db = { comments: [], files: [], n: 0 };
const nextId = () => oid(9000 + ++db.n);

const inSet = (list, id) => list.some((x) => same(x, id));
const matchFile = (f, q) => {
  if (q.$or) return q.$or.some((part) => matchFile(f, part));
  if (q.task !== undefined) return same(f.task, q.task);
  if (q.comment !== undefined) return q.comment.$in ? inSet(q.comment.$in, f.comment) : same(f.comment, q.comment);
  return false;
};
stub('models/Workspace.js', { findById: () => chain(() => ({ members: [{ user: U.author, role: 'Member' }, { user: U.other, role: 'Member' }, { user: U.manager, role: 'Manager' }, { user: U.viewer, role: 'Viewer' }] })) });
stub('models/Task.js', { findById: (id) => chain(() => (same(id, T1) || same(id, T2) ? { _id: id, workspace: WS, project: oid(300), title: 'A task' } : null)) });
stub('models/Project.js', { findById: () => chain(() => null) });
stub('models/Comment.js', {
  // loading one comment gives the author as a plain id; listing (populate) gives the author's name too
  findById: (id) => chain(() => { const c = db.comments.find((x) => same(x._id, id)); return c ? { ...c, author: c.author._id } : null; }),
  find: (q) => chain(() => db.comments.filter((c) => (q.task !== undefined ? same(c.task, q.task) : q.parentComment !== undefined ? same(c.parentComment, q.parentComment) : false))),
  deleteMany: async (q) => { const before = db.comments.length; db.comments = db.comments.filter((c) => !(q._id ? inSet(q._id.$in, c._id) : same(c.task, q.task))); return { deletedCount: before - db.comments.length }; },
});
stub('models/FileAsset.js', {
  create: async (doc) => { const f = { _id: nextId(), createdAt: new Date(), ...doc }; Object.defineProperty(f, 'deleteOne', { enumerable: false, value: async () => { db.files = db.files.filter((x) => x !== f); } }); db.files.push(f); return f; },
  find: (q) => chain(() => db.files.filter((f) => matchFile(f, q))),
  findById: (id) => chain(() => db.files.find((f) => same(f._id, id)) || null),
  countDocuments: async (q) => db.files.filter((f) => matchFile(f, q)).length,
  deleteMany: async (q) => { const before = db.files.length; db.files = db.files.filter((f) => !matchFile(f, q)); return { deletedCount: before - db.files.length }; },
});
stub('utils/activity.js', { logFileUploaded: async () => null, logActivity: async () => null });

const fileRoutes = require('../src/routes/fileRoutes');
const commentRoutes = require('../src/routes/commentRoutes');
const { removeTaskData } = require('../src/utils/fileCleanup');
const tok = (id) => jwt.sign({ id, role: 'Member' }, process.env.JWT_SECRET);

let base; let server;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api', fileRoutes); app.use('/api', commentRoutes);
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => {
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { recursive: true, force: true });
  db.n = 0; db.files = [];
  db.comments = [
    { _id: oid(401), task: T1, author: { _id: U.author, name: 'Anu' }, parentComment: null, text: 'first', createdAt: new Date(1) },
    { _id: oid(402), task: T1, author: { _id: U.other, name: 'Raj' }, parentComment: oid(401), text: 'reply', createdAt: new Date(2) },
    { _id: oid(403), task: T1, author: { _id: U.other, name: 'Raj' }, parentComment: null, text: 'second', createdAt: new Date(3) },
    { _id: oid(404), task: T2, author: { _id: U.author, name: 'Anu' }, parentComment: null, text: 'other task', createdAt: new Date(4) },
  ];
});
const PDF = Buffer.from('%PDF-1.4 tiny pdf for the tests');
const upload = async (commentId, who, { name = 'spec.pdf', type = 'application/pdf', bytes = PDF } = {}) => {
  const form = new FormData(); form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(`${base}/comments/${commentId}/files`, { method: 'POST', headers: who ? { Authorization: `Bearer ${tok(who)}` } : {}, body: form });
  return { status: res.status, data: await res.json() };
};
const call = async (method, p, who) => {
  const res = await fetch(base + p, { method, headers: who ? { Authorization: `Bearer ${tok(who)}` } : {} });
  return { status: res.status, data: await res.json() };
};
const onDisk = () => fs.readdirSync(TMP);

test('upload: the comment author attaches a file; it is saved and listed with that comment', async () => {
  const r = await upload(oid(401), U.author);
  assert.equal(r.status, 201); assert.equal(r.data.file.originalName, 'spec.pdf'); assert.ok(same(r.data.file.comment, oid(401)));
  assert.equal(onDisk().length, 1);
  const list = await call('GET', `/tasks/${T1}/comments`, U.other);
  assert.equal(list.status, 200);
  const first = list.data.comments.find((c) => same(c._id, oid(401)));
  assert.equal(first.files.length, 1); assert.equal(first.files[0].originalName, 'spec.pdf'); assert.equal(first.files[0].size > 0, true);
  assert.ok(!('storedName' in first.files[0]));                                            // the name on the disk is never shown
  assert.deepEqual(list.data.comments.filter((c) => !same(c._id, oid(401))).map((c) => c.files), [[], []]);
  assert.equal(first.author.name, 'Anu'); assert.equal(first.text, 'first');             // the rest of the comment is unchanged
});
test('upload: only the author, with write access, in their workspace; every refusal leaves nothing on the disk', async () => {
  assert.equal((await upload(oid(401), U.other)).status, 403);                             // another member
  assert.equal((await upload(oid(401), U.manager)).status, 403);                           // even a Manager cannot put words in someone else's comment
  assert.equal((await upload(oid(403), U.viewer)).status, 403);
  assert.equal((await upload(oid(401), U.stranger)).status, 404);
  assert.equal((await upload(oid(999), U.author)).status, 404);
  assert.equal((await upload(oid(401), null)).status, 401);
  assert.deepEqual(onDisk(), []); assert.equal(db.files.length, 0);
});
test('upload: file types that are not allowed are refused and leave nothing', async () => {
  const r = await upload(oid(401), U.author, { name: 'run.exe', type: 'application/x-msdownload', bytes: Buffer.from('MZ binary') });
  assert.equal(r.status, 400); assert.deepEqual(onDisk(), []); assert.equal(db.files.length, 0);
});
test('upload: at most 5 attachments per comment; the sixth is refused and not kept', async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await upload(oid(401), U.author, { name: `f${i}.pdf` })).status, 201);
  const r = await upload(oid(401), U.author, { name: 'sixth.pdf' });
  assert.equal(r.status, 400); assert.match(r.data.message, /at most 5 attachments/);
  await new Promise((x) => setTimeout(x, 50));
  assert.equal(onDisk().length, 5); assert.equal(db.files.length, 5);
  assert.equal((await upload(oid(403), U.other)).status, 201);                              // another comment has its own room
});
test('delete comment: its attachments, and those of its replies, are deleted from the database and the disk', async () => {
  await upload(oid(401), U.author, { name: 'a.pdf' }); await upload(oid(402), U.other, { name: 'b.pdf' }); await upload(oid(403), U.other, { name: 'c.pdf' });
  assert.equal(onDisk().length, 3);
  assert.equal((await call('DELETE', `/comments/${oid(401)}`, U.other)).status, 403);        // not the author, not a manager: nothing is deleted
  assert.equal(db.files.length, 3);
  const r = await call('DELETE', `/comments/${oid(401)}`, U.author);
  assert.equal(r.status, 200); assert.equal(r.data.deletedCount, 2);
  await new Promise((x) => setTimeout(x, 50));
  assert.deepEqual(db.files.map((f) => f.originalName), ['c.pdf']); assert.equal(onDisk().length, 1);   // only the other comment's file is left
  assert.equal((await call('DELETE', `/comments/${oid(403)}`, U.manager)).status, 200);               // a Manager may delete anyone's comment
  await new Promise((x) => setTimeout(x, 50));
  assert.equal(db.files.length, 0); assert.deepEqual(onDisk(), []);
});
test('delete one attachment: the uploader or a Manager; nobody else', async () => {
  const f1 = (await upload(oid(401), U.author, { name: 'a.pdf' })).data.file._id;
  const f2 = (await upload(oid(401), U.author, { name: 'b.pdf' })).data.file._id;
  assert.equal((await call('DELETE', `/files/${f1}`, U.other)).status, 403);
  assert.equal((await call('DELETE', `/files/${f1}`, U.author)).status, 200);
  assert.equal((await call('DELETE', `/files/${f2}`, U.manager)).status, 200);
  await new Promise((x) => setTimeout(x, 50));
  assert.deepEqual(onDisk(), []);
  assert.equal((await call('GET', `/tasks/${T1}/comments`, U.author)).data.comments[0].files.length, 0);
});
test('removeTaskData: a deleted task takes its comments and every file with it, and nothing from another task', async () => {
  await upload(oid(401), U.author, { name: 'a.pdf' }); await upload(oid(402), U.other, { name: 'b.pdf' }); await upload(oid(404), U.author, { name: 'other-task.pdf' });
  db.files.push({ _id: nextId(), originalName: 'on-the-task.pdf', storedName: 'task-file.pdf', task: T1, workspace: WS });
  fs.writeFileSync(path.join(TMP, 'task-file.pdf'), 'x');
  assert.equal(onDisk().length, 4);
  await removeTaskData(T1);
  await new Promise((x) => setTimeout(x, 50));
  assert.deepEqual(db.comments.map((c) => String(c._id)), [oid(404)]);                       // comments of the other task stay
  assert.deepEqual(db.files.map((f) => f.originalName), ['other-task.pdf']);
  assert.equal(onDisk().length, 1);
});
