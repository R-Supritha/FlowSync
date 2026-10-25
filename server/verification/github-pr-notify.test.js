// FR10 through the real GitHub sync: pull requests that mention a task notify the people on it, once.
// No database, no internet, no GitHub: models are stand-ins, GitHub is fake.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
process.env.GITHUB_TOKEN_KEY = 'ab'.repeat(32);
const http = require('http');
const path = require('path');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const T = (n) => `64f000000000000000000${String(n).padStart(3, '0')}`;
const db = { tasks: [], events: [], activity: [], link: null, project: null, users: [] };
const chain = (v) => { const c = { select() { return c; }, sort() { return c; }, limit() { return c; }, lean() { return c; }, then: (res, rej) => Promise.resolve(typeof v === 'function' ? v() : v).then(res, rej) }; return c; };
const mk = (n, status, assignee, extra = {}) => { const t = { _id: T(n), project: T(900), title: `Task ${n}`, status, assignee, reporter: 'rep-id', position: n, isArchived: false, ...extra }; Object.defineProperty(t, 'save', { value: async () => {}, enumerable: false }); return t; };

stub('models/Project.js', { findById: () => chain(() => db.project) });
stub('models/Workspace.js', { findById: () => chain({ members: [{ user: 'u1' }, { user: 'dev-id' }] }) });
stub('models/User.js', { find: () => chain(() => db.users), findById: () => ({ select: async () => null }) });
stub('models/GithubLink.js', { findOne: () => chain(() => db.link) });
stub('models/GithubEvent.js', {
  find: (q) => chain(() => db.events.filter((k) => q.key.$in.includes(k)).map((key) => ({ key }))),
  create: async ({ key }) => { if (db.events.includes(key)) throw Object.assign(new Error('dup'), { code: 11000 }); db.events.push(key); },
  deleteOne: async ({ key }) => { db.events = db.events.filter((k) => k !== key); },
});
stub('models/Task.js', {
  find: () => chain(() => db.tasks.filter((t) => !t.isArchived)),
  findById: async (id) => db.tasks.find((t) => String(t._id) === String(id)) || null,
  findOne: () => chain(null),
});
const botCalls = [];
stub('utils/chatBot.js', { postBotMessage: async (m) => { botCalls.push(m); return null; } });
const notes = [];
stub('models/Notification.js', { create: async (doc) => { notes.push(doc); return doc; } });
stub('models/ActivityLog.js', { create: async (doc) => { db.activity.push(doc); return { ...doc, populate: async () => {}, toObject: () => doc }; } });
const access = require('../src/utils/access');
stub('utils/access.js', { ...access, getWorkspaceRole: async () => 'Admin' });
const { syncRepository, listTaskRefs } = require('../src/controllers/githubController');
const { encrypt } = require('../src/utils/tokenCrypto');

let commitsOnGithub = []; let pullsOnGithub = [];
const fakeGithub = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m;
  if ((m = url.pathname.match(/^\/repos\/o\/n\/commits\/(\w+)$/))) { const c = commitsOnGithub.find((x) => x.sha === m[1]); return json(200, { sha: c.sha, files: c.files, stats: { total: c.files.reduce((n, f) => n + f.changes, 0) } }); }
  if (url.pathname === '/repos/o/n/commits') return json(200, commitsOnGithub.map(({ files, ...rest }) => rest));
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)\/files$/))) return json(200, pullsOnGithub.find((x) => x.number === Number(m[1])).files);
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)$/))) { const p = pullsOnGithub.find((x) => x.number === Number(m[1])); return json(200, { number: p.number, changed_files: p.files.length, additions: p.files.reduce((n, f) => n + f.additions, 0), deletions: 0 }); }
  if (url.pathname === '/repos/o/n/pulls') return json(200, pullsOnGithub.map(({ files, ...rest }) => rest));
  return json(404, {});
});
before(async () => { await new Promise((r) => fakeGithub.listen(0, r)); process.env.GITHUB_API_URL = `http://localhost:${fakeGithub.address().port}`; });
after(() => fakeGithub.close());


const when = () => new Date(Date.now() - 120000).toISOString();
const prOnGithub = (number, title, over = {}) => ({ number, title, body: '', head: { ref: `b${number}` }, user: { login: 'dev' }, created_at: when(), merged_at: null, html_url: 'u', files: [{ filename: 'a.js', status: 'added', additions: 5, deletions: 0, changes: 5, sha: 'f'.repeat(40) }], ...over });
const ref = (i) => `FS-${T(i).slice(-6)}`;
beforeEach(() => {
  commitsOnGithub = []; pullsOnGithub = []; notes.length = 0; botCalls.length = 0;
  db.tasks = [mk(1, 'Review', 'dev-id'), mk(2, 'To Do', 'other-id', { reporter: 'dev-id' })]; db.events = []; db.activity = [];
  db.users = [{ _id: 'dev-id', githubUsername: 'dev' }];
  db.project = { _id: T(900), workspace: T(800), isArchived: false, columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'] };
  db.link = { repoFullName: 'o/n', tokenEncrypted: encrypt('github_pat_test'), lastSyncedAt: null, linkedBy: 'u1', save: async () => {} };
  delete process.env.GITHUB_REQUIRE_CHANGES;
});
const sync = async () => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } }; await syncRepository({ params: { projectId: T(900) }, user: { id: 'u1' } }, res); if (res.code !== 200) console.log('SYNC', res.code, JSON.stringify(res.body)); return res; };

test('sync: an opened pull request tells the reporter (the author, who is the assignee, is not told)', async () => {
  pullsOnGithub = [prOnGithub(7, `${ref(1)} add search`)];
  const r = await sync();
  assert.equal(r.body.recorded.prsOpened, 1);
  assert.deepEqual(notes.map((n) => [n.user, n.type]), [['rep-id', 'pr_opened']]);
  assert.equal(notes[0].message, 'Pull request #7 "' + `${ref(1)} add search` + '" was opened for "Task 1"');
  assert.equal(notes[0].link.task, T(1)); assert.equal(notes[0].link.project, T(900)); assert.equal(notes[0].link.workspace, T(800));
});
test('sync: syncing again does not notify again', async () => {
  pullsOnGithub = [prOnGithub(7, `${ref(1)} add search`)];
  await sync(); const first = notes.length;
  const again = await sync();
  assert.equal(again.body.skippedAlreadyRecorded, 1); assert.equal(notes.length, first);
});
test('sync: a pull request by someone who is not on any profile tells everyone on the task', async () => {
  pullsOnGithub = [prOnGithub(8, `${ref(1)} from a stranger`, { user: { login: 'stranger' } })];
  await sync();
  assert.deepEqual(notes.map((n) => n.user).sort(), ['dev-id', 'rep-id']);
});
test('sync: a merged pull request sends both "opened" and "merged" notices', async () => {
  pullsOnGithub = [prOnGithub(9, `${ref(2)} ship it`, { user: { login: 'stranger' }, merged_at: when() })];
  const r = await sync();
  assert.equal(r.body.recorded.prsMerged, 1);
  assert.deepEqual(notes.map((n) => n.type).sort(), ['pr_merged', 'pr_merged', 'pr_opened', 'pr_opened']);   // assignee and reporter, for each
  assert.ok(notes.some((n) => /was merged for "Task 2"/.test(n.message)));
});
test('sync: pull requests with no reference, an unknown one, or no real change notify nobody', async () => {
  pullsOnGithub = [prOnGithub(10, 'no reference'), prOnGithub(11, 'FS-abcdef unknown'), prOnGithub(12, `${ref(1)} empty`, { files: [{ filename: 'e.txt', status: 'added', additions: 0, deletions: 0, changes: 0, sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' }] })];
  const r = await sync();
  assert.equal(notes.length, 0); assert.equal(r.body.skippedNoChanges.pullRequests, 1);                  // the empty-file PR is ignored altogether
});
test('sync: commits never create pull request notifications', async () => {
  commitsOnGithub = [{ sha: 'abc0001', html_url: 'x', author: { login: 'stranger' }, commit: { message: `${ref(1)} work`, author: { date: when() } }, files: [{ filename: 'a.js', status: 'added', additions: 3, deletions: 0, changes: 3, sha: 'a'.repeat(40) }] }];
  await sync();
  assert.equal(notes.length, 0);
});

test('FR30 sync: a merged pull request that finishes a task announces it in the project chat, once; an opened one does not', async () => {
  pullsOnGithub = [prOnGithub(9, `${ref(2)} ship it`, { user: { login: 'stranger' } })];
  await sync();
  assert.equal(botCalls.length, 0);                                                      // opened: the task goes to Review, not Done
  pullsOnGithub = [prOnGithub(9, `${ref(2)} ship it`, { user: { login: 'stranger' }, merged_at: when() })];
  await sync();
  assert.equal(botCalls.length, 1);
  assert.equal(botCalls[0].kind, 'task_done'); assert.equal(String(botCalls[0].project), T(900)); assert.equal(String(botCalls[0].workspace), T(800));
  assert.match(botCalls[0].text, /^✅ "Task 2" is Done \(.*PR #9/);
  await sync();
  assert.equal(botCalls.length, 1);                                                      // syncing again says nothing new
});
