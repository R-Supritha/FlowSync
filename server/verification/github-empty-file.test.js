// "Committing an EMPTY FILE is not progress either": git gives every empty file the same id, so a commit
// (or pull request) that only adds or removes empty files changes no content and does not move a task.
// No database, no internet, no GitHub: models are stand-ins and GitHub is a small fake server.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
process.env.GITHUB_TOKEN_KEY = 'ab'.repeat(32);
const http = require('http');
const path = require('path');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const changes = require('../src/utils/githubChanges');
const EMPTY = changes.EMPTY_BLOB_SHA;
const extractRefs = (text) => require('../src/utils/githubTaskLinks').extractRefs(text);

// ================================================================ the rule
const f = (over = {}) => ({ filename: 'a.js', status: 'modified', additions: 3, deletions: 1, changes: 4, sha: 'a'.repeat(40), ...over });
const emptyAdd = (name = 'empty.txt') => f({ filename: name, status: 'added', additions: 0, deletions: 0, changes: 0, sha: EMPTY });

test('the id of an empty file is the well-known empty blob id', () => {
  assert.equal(EMPTY, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(require('crypto').createHash('sha1').update('blob 0\0').digest('hex'), EMPTY);   // what git computes for an empty file
});
test('commit rule: adding only an empty file is NOT a real change (with any minimum)', () => {
  const d = { files: [emptyAdd()], stats: { total: 0 } };
  assert.equal(changes.commitHasChanges(d, 1), false); assert.equal(changes.commitHasChanges(d, 5), false);
  assert.equal(changes.commitHasChanges({ files: [emptyAdd('a.txt'), emptyAdd('b.txt')], stats: { total: 0 } }, 1), false);
  assert.equal(changes.commitHasChanges({ files: [f({ status: 'removed', additions: 0, deletions: 0, changes: 0, sha: EMPTY })], stats: { total: 0 } }, 1), false);  // deleting an empty file
});
test('commit rule: an empty file next to a real change still counts, and so do pictures, renames and unknown ids', () => {
  assert.equal(changes.commitHasChanges({ files: [emptyAdd(), f()], stats: { total: 4 } }, 1), true);
  const picture = f({ filename: 'logo.png', status: 'added', additions: 0, deletions: 0, changes: 0, sha: 'b'.repeat(40) });
  assert.equal(changes.commitHasChanges({ files: [picture], stats: { total: 0 } }, 5), true);
  assert.equal(changes.commitHasChanges({ files: [f({ status: 'renamed', additions: 0, deletions: 0, changes: 0, sha: EMPTY })], stats: { total: 0 } }, 1), true);
  assert.equal(changes.commitHasChanges({ files: [f({ status: 'added', additions: 0, deletions: 0, changes: 0, sha: undefined })], stats: { total: 0 } }, 1), true); // cannot tell: not held against the author
});
test('commit rule: an added file with real text is real, and emptying a file (lines deleted) is real', () => {
  assert.equal(changes.commitHasChanges({ files: [f({ status: 'added', additions: 2, deletions: 0, changes: 2, sha: 'c'.repeat(40) })], stats: { total: 2 } }, 1), true);
  assert.equal(changes.commitHasChanges({ files: [f({ status: 'modified', additions: 0, deletions: 4, changes: 4, sha: EMPTY })], stats: { total: 4 } }, 1), true);
});
test('pull request rule: the file list is only used when it is given', () => {
  const base = { changed_files: 1, additions: 0, deletions: 0 };
  assert.equal(changes.pullHasChanges(base, 1), true);                                              // no list: same as before
  assert.equal(changes.pullHasChanges({ ...base, files: [emptyAdd()] }, 1), false);
  assert.equal(changes.pullHasChanges({ ...base, files: [f({ status: 'added', additions: 0, changes: 0, sha: 'd'.repeat(40) })] }, 1), true);
  assert.equal(changes.pullHasChanges({ changed_files: 2, additions: 5, deletions: 0, files: [emptyAdd(), f()] }, 1), true);
});

// ================================================================ filtering events
const commitEv = (sha, text) => ({ key: `o/n:commit:${sha}`, type: 'commit_pushed', date: new Date(), text, meta: { sha } });
const prEv = (number, text) => ({ key: `o/n:pr-opened:${number}`, type: 'pr_opened', date: new Date(), text, meta: { number } });

test('filter: an empty-file commit is dropped, marked and explained; a real one is kept', async () => {
  const info = { e111111: { files: [emptyAdd()], stats: { total: 0 } }, r222222: { files: [f()], stats: { total: 4 } } };
  const r = await changes.filterRealEvents({
    events: [commitEv('e111111', 'FS-aaaaaa add empty file'), commitEv('r222222', 'FS-bbbbbb real')], knownKeys: new Set(), extractRefs,
    getCommit: async (sha) => info[sha], getPull: async () => ({}),
  });
  assert.deepEqual(r.events.map((e) => e.meta.sha), ['r222222']); assert.deepEqual(r.markers, ['o/n:empty:commit:e111111']);
  assert.deepEqual(r.notes, ['FS-aaaaaa: commit e111111 changes no files, so it did not move the task']);
});
test('filter: the pull request file list is fetched only when there are files but no text lines', async () => {
  const pulls = { 1: { changed_files: 1, additions: 0, deletions: 0 }, 2: { changed_files: 1, additions: 0, deletions: 0 }, 3: { changed_files: 2, additions: 9, deletions: 0 } };
  const lists = { 1: [emptyAdd()], 2: [f({ status: 'added', additions: 0, changes: 0, sha: 'e'.repeat(40), filename: 'pic.png' })] };
  const asked = [];
  const r = await changes.filterRealEvents({
    events: [prEv(1, 'FS-aaaaaa'), prEv(2, 'FS-bbbbbb'), prEv(3, 'FS-cccccc')], knownKeys: new Set(), extractRefs,
    getCommit: async () => ({}), getPull: async (n) => pulls[n], getPullFiles: async (n) => { asked.push(n); return lists[n]; },
  });
  assert.deepEqual(asked.sort(), [1, 2]);                                                           // PR 3 has real lines: no extra call
  assert.deepEqual(r.events.map((e) => e.meta.number), [2, 3]);                                     // empty-file PR 1 dropped, picture PR 2 kept
  assert.deepEqual(r.notes, ['FS-aaaaaa: PR #1 has no file changes, so it did not move the task']);
});
test('filter: without a file-list helper a pull request behaves as before', async () => {
  const r = await changes.filterRealEvents({
    events: [prEv(1, 'FS-aaaaaa')], knownKeys: new Set(), extractRefs, getCommit: async () => ({}), getPull: async () => ({ changed_files: 1, additions: 0, deletions: 0 }),
  });
  assert.equal(r.events.length, 1);
});

// ================================================================ the real sync, against a fake GitHub
const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const T = (n) => `64f000000000000000000${String(n).padStart(3, '0')}`;
const db = { tasks: [], events: [], activity: [], link: null, project: null, users: [] };
const chain = (v) => { const c = { select() { return c; }, sort() { return c; }, limit() { return c; }, lean() { return c; }, then: (res, rej) => Promise.resolve(typeof v === 'function' ? v() : v).then(res, rej) }; return c; };
const mk = (n, status, assignee) => { const t = { _id: T(n), project: T(900), title: `Task ${n}`, status, assignee, position: n, isArchived: false }; Object.defineProperty(t, 'save', { value: async () => {}, enumerable: false }); return t; };
stub('models/Project.js', { findById: () => chain(() => db.project) });
stub('models/Workspace.js', { findById: () => chain({ members: [{ user: 'u1' }, { user: 'dev-id' }] }) });
stub('models/User.js', { find: () => chain(() => db.users) });
stub('models/GithubLink.js', { findOne: () => chain(() => db.link) });
stub('models/GithubEvent.js', {
  find: (q) => chain(() => db.events.filter((k) => q.key.$in.includes(k)).map((key) => ({ key }))),
  create: async ({ key }) => { if (db.events.includes(key)) throw Object.assign(new Error('dup'), { code: 11000 }); db.events.push(key); },
  deleteOne: async ({ key }) => { db.events = db.events.filter((k) => k !== key); },
});
stub('models/Task.js', { find: () => chain(() => db.tasks.filter((t) => !t.isArchived)), findById: async (id) => db.tasks.find((t) => String(t._id) === String(id)) || null, findOne: () => chain(null) });
stub('models/ActivityLog.js', { create: async (doc) => { db.activity.push(doc); return { ...doc, populate: async () => {}, toObject: () => doc }; } });
const access = require('../src/utils/access');
stub('utils/access.js', { ...access, getWorkspaceRole: async () => 'Admin' });
const { syncRepository } = require('../src/controllers/githubController');
const { encrypt } = require('../src/utils/tokenCrypto');

let commitsOnGithub = []; let pullsOnGithub = []; let calls = [];
const fakeGithub = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); calls.push(url.pathname);
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m;
  if ((m = url.pathname.match(/^\/repos\/o\/n\/commits\/(\w+)$/))) { const c = commitsOnGithub.find((x) => x.sha === m[1]); return json(200, { sha: c.sha, files: c.files, stats: { total: c.files.reduce((n, x) => n + x.changes, 0) } }); }
  if (url.pathname === '/repos/o/n/commits') return json(200, commitsOnGithub.map(({ files, ...rest }) => rest));
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)\/files$/))) return json(200, pullsOnGithub.find((x) => x.number === Number(m[1])).files);
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)$/))) { const p = pullsOnGithub.find((x) => x.number === Number(m[1])); return json(200, { number: p.number, changed_files: p.files.length, additions: p.files.reduce((n, x) => n + x.additions, 0), deletions: 0 }); }
  if (url.pathname === '/repos/o/n/pulls') return json(200, pullsOnGithub.map(({ files, ...rest }) => rest));
  return json(404, {});
});
before(async () => { await new Promise((r) => fakeGithub.listen(0, r)); process.env.GITHUB_API_URL = `http://localhost:${fakeGithub.address().port}`; });
after(() => fakeGithub.close());

let n = 0;
const commit = (message, files, login = 'dev') => { n += 1; return { sha: `abc${String(n).padStart(4, '0')}`, html_url: 'https://x', author: { login }, commit: { message, author: { date: new Date(Date.now() - 120000 + n * 1000).toISOString() } }, files }; };
const realFile = f({ filename: 'a.js', status: 'added', additions: 5, deletions: 0, changes: 5, sha: 'f'.repeat(40) });
beforeEach(() => {
  n = 0; commitsOnGithub = []; pullsOnGithub = []; calls = [];
  db.tasks = [mk(1, 'Backlog', 'someone'), mk(2, 'To Do', 'dev-id')]; db.events = []; db.activity = []; db.users = [{ _id: 'dev-id', githubUsername: 'dev' }];
  db.project = { _id: T(900), workspace: T(800), isArchived: false, columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'] };
  db.link = { repoFullName: 'o/n', tokenEncrypted: encrypt('github_pat_test'), lastSyncedAt: null, linkedBy: 'u1', save: async () => {} };
  delete process.env.GITHUB_REQUIRE_CHANGES; delete process.env.GITHUB_AUTHOR_FALLBACK;
});
const sync = async () => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } }; await syncRepository({ params: { projectId: T(900) }, user: { id: 'u1' } }, res); if (res.code !== 200) console.log('SYNC', res.code, JSON.stringify(res.body)); return res; };
const status = (i) => db.tasks.find((t) => String(t._id) === T(i)).status;
const ref = (i) => `FS-${T(i).slice(-6)}`;

test('sync: a commit that only adds an empty file, WITH a reference, does not move the task and is not recorded', async () => {
  commitsOnGithub = [commit(`${ref(1)} add empty file`, [emptyAdd()])];
  const r = await sync();
  assert.equal(status(1), 'Backlog'); assert.equal(r.body.recorded.commits, 0); assert.equal(r.body.tasksMoved.length, 0);
  assert.deepEqual(r.body.skippedNoChanges, { commits: 1, pullRequests: 0, alreadyIgnored: 0 });
  assert.equal(db.activity.filter((a) => a.type === 'commit_pushed').length, 0);
});
test('sync: the same commit with a real file next to the empty one DOES move the task', async () => {
  commitsOnGithub = [commit(`${ref(1)} add file`, [emptyAdd(), realFile])];
  const r = await sync();
  assert.equal(status(1), 'In Progress'); assert.equal(r.body.recorded.commits, 1);
});
test('sync: a plain commit that only adds an empty file is not matched to the author\'s waiting task', async () => {
  commitsOnGithub = [commit('just an empty file', [emptyAdd()])];
  const r = await sync();
  assert.equal(status(2), 'To Do'); assert.equal(r.body.tasksMoved.length, 0);
});
test('sync: a pull request that only adds an empty file cannot move a task; one with a picture or code can', async () => {
  const when = new Date(Date.now() - 120000).toISOString();
  const pr = (number, title, files) => ({ number, title, body: '', head: { ref: `b${number}` }, user: { login: 'dev' }, created_at: when, merged_at: null, html_url: 'u', files });
  pullsOnGithub = [pr(7, `${ref(1)} empty PR`, [emptyAdd()]), pr(8, `${ref(2)} picture PR`, [f({ filename: 'p.png', status: 'added', additions: 0, deletions: 0, changes: 0, sha: '9'.repeat(40) })])];
  const r = await sync();
  assert.equal(status(1), 'Backlog'); assert.equal(status(2), 'Review');
  assert.equal(r.body.skippedNoChanges.pullRequests, 1); assert.equal(r.body.recorded.prsOpened, 1);
  assert.deepEqual(calls.filter((c) => c.endsWith('/files')).sort(), ['/repos/o/n/pulls/7/files', '/repos/o/n/pulls/8/files']);
});
test('sync: GITHUB_REQUIRE_CHANGES=false switches the whole rule off, empty files included', async () => {
  process.env.GITHUB_REQUIRE_CHANGES = 'false';
  commitsOnGithub = [commit(`${ref(1)} demo`, [emptyAdd()])];
  const r = await sync();
  assert.equal(status(1), 'In Progress'); assert.equal(r.body.recorded.commits, 1);
});
