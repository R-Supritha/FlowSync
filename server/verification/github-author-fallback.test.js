// "A simple commit with no task reference": checks for utils/githubTaskLinks.js applyAuthorFallback and
// its use in the sync. A plain commit moves its author's ONE waiting To Do task to In Progress, and never
// guesses when that is not clear. No database, no internet, no GitHub: models are stand-ins, GitHub is fake.
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
const mk = (n, status, assignee, extra = {}) => { const t = { _id: T(n), project: T(900), title: `Task ${n}`, status, assignee, position: n, isArchived: false, ...extra }; Object.defineProperty(t, 'save', { value: async () => {}, enumerable: false }); return t; };

stub('models/Project.js', { findById: () => chain(() => db.project) });
stub('models/Workspace.js', { findById: () => chain({ members: [{ user: 'u1' }, { user: 'dev-id' }] }) });
stub('models/User.js', { find: () => chain(() => db.users) });
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
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)$/))) { const p = pullsOnGithub.find((x) => x.number === Number(m[1])); return json(200, { number: p.number, changed_files: 1, additions: 3, deletions: 0 }); }
  if (url.pathname === '/repos/o/n/pulls') return json(200, pullsOnGithub);
  return json(404, {});
});
before(async () => { await new Promise((r) => fakeGithub.listen(0, r)); process.env.GITHUB_API_URL = `http://localhost:${fakeGithub.address().port}`; });
after(() => fakeGithub.close());

const realChange = [{ filename: 'a.js', status: 'modified', additions: 5, deletions: 1, changes: 6 }];
let n = 0;
const commit = (message, files = realChange, login = 'dev') => { n += 1; return { sha: `abc${String(n).padStart(4, '0')}`, html_url: 'https://x', author: { login }, commit: { message, author: { date: new Date(Date.now() - 120000 + n * 1000).toISOString() } }, files }; };
beforeEach(() => {
  n = 0; commitsOnGithub = []; pullsOnGithub = [];
  db.tasks = []; db.events = []; db.activity = []; db.users = [{ _id: 'dev-id', githubUsername: 'dev' }];
  db.project = { _id: T(900), workspace: T(800), isArchived: false, columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'] };
  db.link = { repoFullName: 'o/n', tokenEncrypted: encrypt('github_pat_test'), lastSyncedAt: null, linkedBy: 'u1', save: async () => {} };
  delete process.env.GITHUB_AUTHOR_FALLBACK; delete process.env.GITHUB_REQUIRE_CHANGES;
});
const sync = async () => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } }; await syncRepository({ params: { projectId: T(900) }, user: { id: 'u1' } }, res); if (res.code !== 200) console.log('SYNC', res.code, JSON.stringify(res.body)); return res; };
const status = (i) => db.tasks.find((t) => String(t._id) === T(i)).status;
const ref = (i) => `FS-${T(i).slice(-6)}`;

test('a plain commit moves the author\'s ONE waiting To Do task to In Progress, and says how it was matched', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id'), mk(2, 'Backlog', 'dev-id'), mk(3, 'To Do', 'someone-else')];
  commitsOnGithub = [commit('fix the login bug')];
  const r = await sync();
  assert.equal(status(1), 'In Progress'); assert.equal(status(2), 'Backlog'); assert.equal(status(3), 'To Do');   // only their own waiting task
  assert.equal(r.body.recorded.commits, 1); assert.equal(r.body.tasksMoved.length, 1);
  assert.equal(r.body.tasksMoved[0].ref, ref(1)); assert.equal(r.body.tasksMoved[0].from, 'To Do'); assert.equal(r.body.tasksMoved[0].to, 'In Progress');
  assert.match(r.body.tasksMoved[0].because, /matched by author/);
  const move = db.activity.find((a) => a.type === 'task_status_changed');
  assert.match(move.message, /moved "Task 1" from To Do to In Progress \(commit abc0001, matched by author\)/); assert.equal(move.meta.via, 'author');
});
test('if the author is already working on a task (In Progress or later), nothing is guessed or moved', async () => {
  for (const started of ['In Progress', 'Review', 'Testing']) {
    db.events = []; db.activity = []; n = 0;
    db.tasks = [mk(1, 'To Do', 'dev-id'), mk(2, started, 'dev-id')];
    commitsOnGithub = [commit(`work while in ${started}`)];
    const r = await sync();
    assert.equal(status(1), 'To Do', started); assert.equal(r.body.tasksMoved.length, 0, started); assert.deepEqual(r.body.taskLinkNotes, [], started);
    assert.equal(r.body.recorded.commits, 1, started);                                      // the commit itself is still recorded
  }
});
test('several waiting tasks: nothing is moved, and the sync message says what to do', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id'), mk(2, 'To Do', 'dev-id')];
  commitsOnGithub = [commit('some work')];
  const r = await sync();
  assert.equal(status(1), 'To Do'); assert.equal(status(2), 'To Do'); assert.equal(r.body.tasksMoved.length, 0);
  assert.equal(r.body.taskLinkNotes.length, 1);
  assert.match(r.body.taskLinkNotes[0], /Commit abc0001 has no task reference and @dev has 2 tasks in To Do, so nothing was moved\. Add a reference such as FS-/);
});
test('an author who is not matched to a profile is never guessed at', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id')];
  commitsOnGithub = [commit('work by a stranger', realChange, 'stranger')];
  const r = await sync();
  assert.equal(status(1), 'To Do'); assert.equal(r.body.tasksMoved.length, 0); assert.deepEqual(r.body.unmatchedGithubUsers, ['stranger']);
});
test('an explicit reference always wins: only the referenced task moves', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id'), mk(3, 'Backlog', 'someone-else')];
  commitsOnGithub = [commit(`${ref(3)} start the third task`)];
  const r = await sync();
  assert.equal(status(3), 'In Progress'); assert.equal(status(1), 'To Do');
  assert.equal(r.body.tasksMoved.length, 1); assert.equal(r.body.tasksMoved[0].ref, ref(3)); assert.doesNotMatch(r.body.tasksMoved[0].because, /author/);
});
test('an EMPTY plain commit still counts for nothing (the real-commit rule comes first)', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id')];
  commitsOnGithub = [commit('just a ping', [])];
  const r = await sync();
  assert.equal(status(1), 'To Do'); assert.equal(r.body.recorded.commits, 0); assert.equal(r.body.skippedNoChanges.commits, 1);
});
test('two plain commits in one sync move the task once (the second sees it already started)', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id'), mk(2, 'To Do', 'dev-id')];
  commitsOnGithub = [commit('first part'), commit('second part')];
  const r = await sync();
  assert.equal(r.body.recorded.commits, 2);
  // both tasks wait, so the first commit is ambiguous: nothing moves, and the same holds for the second
  assert.equal(r.body.tasksMoved.length, 0);
  db.events = []; db.activity = []; n = 0; db.tasks = [mk(1, 'To Do', 'dev-id')];
  commitsOnGithub = [commit('first part'), commit('second part')];
  const again = await sync();
  assert.equal(again.body.recorded.commits, 2); assert.equal(again.body.tasksMoved.length, 1); assert.equal(status(1), 'In Progress');
});
test('a reference commit and a plain commit in the same sync do not fight over the author\'s tasks', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id'), mk(2, 'To Do', 'dev-id')];
  commitsOnGithub = [commit(`${ref(2)} start task two`), commit('and some more work')];
  const r = await sync();
  assert.equal(status(2), 'In Progress'); assert.equal(status(1), 'To Do');                 // the reference started task 2, so the plain commit is "already working"
  assert.equal(r.body.tasksMoved.length, 1); assert.deepEqual(r.body.taskLinkNotes, []);
});
test('only tasks in To Do are candidates: Backlog, Done and other people\'s tasks are not', async () => {
  db.tasks = [mk(1, 'Backlog', 'dev-id'), mk(2, 'Done', 'dev-id'), mk(3, 'To Do', 'someone-else'), mk(4, 'To Do', null)];
  commitsOnGithub = [commit('some work')];
  const r = await sync();
  assert.equal(r.body.tasksMoved.length, 0); assert.deepEqual(db.tasks.map((t) => t.status), ['Backlog', 'Done', 'To Do', 'To Do']);
});
test('pull requests without a reference are never linked this way', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id')];
  const when = new Date(Date.now() - 120000).toISOString();
  pullsOnGithub = [{ number: 5, title: 'Add search', body: '', head: { ref: 'search' }, user: { login: 'dev' }, created_at: when, merged_at: when, html_url: 'u' }];
  const r = await sync();
  assert.equal(status(1), 'To Do'); assert.equal(r.body.tasksMoved.length, 0); assert.equal(r.body.recorded.prsOpened, 1);
});
test('GITHUB_AUTHOR_FALLBACK=false requires references again', async () => {
  process.env.GITHUB_AUTHOR_FALLBACK = 'false';
  db.tasks = [mk(1, 'To Do', 'dev-id')];
  commitsOnGithub = [commit('fix the login bug')];
  const r = await sync();
  assert.equal(status(1), 'To Do'); assert.equal(r.body.tasksMoved.length, 0); assert.equal(r.body.recorded.commits, 1);
});
test('a project without an In Progress or To Do column is left alone (no crash)', async () => {
  db.project.columns = ['Backlog', 'Doing', 'Done'];
  db.tasks = [mk(1, 'Backlog', 'dev-id')];
  commitsOnGithub = [commit('work')];
  const r = await sync();
  assert.equal(r.code, 200); assert.equal(r.body.tasksMoved.length, 0);
});
test('the task-reference help tells people about both ways', async () => {
  db.tasks = [mk(1, 'To Do', 'dev-id')];
  const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
  await listTaskRefs({ params: { projectId: T(900) }, user: { id: 'u1' } }, res);
  assert.match(res.body.howTo, /commit with no reference moves the author's only task in To Do/);
});
