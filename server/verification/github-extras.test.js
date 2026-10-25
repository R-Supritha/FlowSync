// FR13 through the real GitHub sync: issues, releases and branches. A fake GitHub answers; no database, no internet.
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
const notes = [];
stub('models/Notification.js', { create: async (doc) => { notes.push(doc); return doc; } });
stub('models/ActivityLog.js', { create: async (doc) => { db.activity.push(doc); return { ...doc, populate: async () => {}, toObject: () => doc }; } });
const access = require('../src/utils/access');
stub('utils/access.js', { ...access, getWorkspaceRole: async () => 'Admin' });
const { syncRepository, listTaskRefs } = require('../src/controllers/githubController');
const { encrypt } = require('../src/utils/tokenCrypto');

let commitsOnGithub = []; let pullsOnGithub = []; let issuesOnGithub = []; let releasesOnGithub = []; let branchesOnGithub = []; let issuesStatus = 200; const requested = [];
const fakeGithub = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  requested.push(url.pathname);
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m;
  if ((m = url.pathname.match(/^\/repos\/o\/n\/commits\/(\w+)$/))) { const c = commitsOnGithub.find((x) => x.sha === m[1]); return json(200, { sha: c.sha, files: c.files, stats: { total: c.files.reduce((n, f) => n + f.changes, 0) } }); }
  if (url.pathname === '/repos/o/n/commits') return json(200, commitsOnGithub.map(({ files, ...rest }) => rest));
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)\/files$/))) return json(200, pullsOnGithub.find((x) => x.number === Number(m[1])).files);
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)$/))) { const p = pullsOnGithub.find((x) => x.number === Number(m[1])); return json(200, { number: p.number, changed_files: p.files.length, additions: p.files.reduce((n, f) => n + f.additions, 0), deletions: 0 }); }
  if (url.pathname === '/repos/o/n/pulls') return json(200, pullsOnGithub.map(({ files, ...rest }) => rest));
  if (url.pathname === '/repos/o/n/issues') return issuesStatus === 200 ? json(200, issuesOnGithub) : json(issuesStatus, {});
  if (url.pathname === '/repos/o/n/releases') return json(200, releasesOnGithub);
  if (url.pathname === '/repos/o/n/branches') return json(200, branchesOnGithub);
  return json(404, {});
});
before(async () => { await new Promise((r) => fakeGithub.listen(0, r)); process.env.GITHUB_API_URL = `http://localhost:${fakeGithub.address().port}`; });
after(() => fakeGithub.close());



const DAY = 24 * 3600 * 1000;
const when = (msAgo = 120000) => new Date(Date.now() - msAgo).toISOString();
const issue = (number, title, over = {}) => ({ number, title, body: '', user: { login: 'dev' }, created_at: when(), closed_at: null, html_url: 'u', ...over });
const release = (id, tag, over = {}) => ({ id, tag_name: tag, name: tag, draft: false, published_at: when(), author: { login: 'dev' }, html_url: 'u', ...over });
const commit = (sha, message) => ({ sha, html_url: 'x', author: { login: 'stranger' }, commit: { message, author: { date: when() } }, files: [{ filename: 'a.js', status: 'added', additions: 3, deletions: 0, changes: 3, sha: 'a'.repeat(40) }] });
const ref = (i) => `FS-${T(i).slice(-6)}`;
beforeEach(() => {
  commitsOnGithub = []; pullsOnGithub = []; issuesOnGithub = []; releasesOnGithub = []; branchesOnGithub = []; issuesStatus = 200; requested.length = 0; notes.length = 0;
  db.tasks = [mk(1, 'Review', 'dev-id')]; db.events = []; db.activity = [];
  db.users = [{ _id: 'dev-id', githubUsername: 'dev' }];
  db.project = { _id: T(900), workspace: T(800), isArchived: false, columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'] };
  db.link = { repoFullName: 'o/n', tokenEncrypted: encrypt('github_pat_test'), lastSyncedAt: null, linkedBy: 'u1', knownBranches: [], branchesBaselined: false, recentNewBranches: [], save: async () => {} };
  delete process.env.GITHUB_REQUIRE_CHANGES;
});
const sync = async () => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } }; await syncRepository({ params: { projectId: T(900) }, user: { id: 'u1' } }, res); return res; };
const types = () => db.activity.map((a) => a.type);

test('issues: an opened and a closed issue become activity, credited to the matched person, once', async () => {
  issuesOnGithub = [issue(5, 'Login page broken'), issue(6, 'Old bug', { created_at: when(400 * DAY), closed_at: when(60000), closed_by: { login: 'dev' } })];
  const r = await sync();
  assert.equal(r.code, 200); assert.equal(r.body.recorded.issuesOpened, 1); assert.equal(r.body.recorded.issuesClosed, 1);
  assert.deepEqual(types().sort(), ['issue_closed', 'issue_opened']);
  assert.ok(db.activity.some((a) => a.message === 'opened issue #5 "Login page broken"' && a.actor === 'dev-id'));
  assert.ok(db.activity.some((a) => a.message === 'closed issue #6 "Old bug"' && a.actor === 'dev-id'));
  assert.deepEqual(db.activity.map((a) => a.category).sort(), ['completed', 'planning']);
  const again = await sync();
  assert.equal(again.body.skippedAlreadyRecorded, 2); assert.equal(db.activity.length, 2);
  assert.equal(db.link.lastSyncSummary.issuesOpened, 0);                                                    // the second sync recorded nothing new
});
test('issues: an issue with no matching profile is credited to whoever linked the repository, and says who it was', async () => {
  issuesOnGithub = [issue(7, 'From a stranger', { user: { login: 'stranger' } })];
  await sync();
  assert.equal(db.activity[0].actor, 'u1'); assert.match(db.activity[0].message, /\(by @stranger\)/); assert.equal(db.activity[0].meta.matchedUser, false);
});
test('issues: pull requests mixed into GitHub\'s issue list are not issues', async () => {
  issuesOnGithub = [{ ...issue(8, 'This is a pull request'), pull_request: { url: 'x' } }, issue(9, 'A real issue')];
  const r = await sync();
  assert.equal(r.body.recorded.issuesOpened, 1); assert.deepEqual(db.activity.map((a) => a.message), ['opened issue #9 "A real issue"']);
});
test('issues: an issue that mentions a task never moves it, and is never looked up as a pull request', async () => {
  issuesOnGithub = [issue(10, `${ref(1)} please look at this`)];
  const r = await sync();
  assert.equal(db.tasks[0].status, 'Review'); assert.deepEqual(r.body.tasksMoved, []);
  assert.ok(!requested.some((p) => p.startsWith('/repos/o/n/pulls/')), requested.join(', '));              // issue number 10 is not pull request 10
});
test('releases: published ones are recorded; drafts and old ones are not; a name different from the tag shows both', async () => {
  releasesOnGithub = [release(1, 'v1.0'), release(2, 'v2.0-wip', { draft: true }), release(3, 'v0.1', { published_at: when(400 * DAY) }), release(4, 'v1.1', { name: 'Spring release' })];
  const r = await sync();
  assert.equal(r.body.recorded.releases, 2);
  assert.deepEqual(db.activity.map((a) => a.message).sort(), ['published release "Spring release" (v1.1)', 'published release "v1.0"']);
  assert.ok(db.activity.every((a) => a.type === 'release_published' && a.category === 'completed'));
  await sync(); assert.equal(db.activity.length, 2);                                                         // not recorded twice
});
test('branches: the first sync only remembers them; later syncs report new ones, and no branch ever lands in the activity feed', async () => {
  branchesOnGithub = [{ name: 'main' }, { name: 'dev' }];
  const first = await sync();
  assert.deepEqual(first.body.newBranches, []); assert.equal(first.body.branchCount, 2);
  assert.deepEqual(db.link.knownBranches, ['main', 'dev']); assert.equal(db.link.branchesBaselined, true);
  branchesOnGithub = [{ name: 'main' }, { name: 'dev' }, { name: 'feature/search' }];
  const second = await sync();
  assert.deepEqual(second.body.newBranches, ['feature/search']); assert.equal(second.body.recorded.newBranches, 1);
  assert.equal(db.link.recentNewBranches[0].name, 'feature/search'); assert.equal(db.link.lastSyncSummary.newBranches, 1);
  assert.equal((await sync()).body.newBranches.length, 0);                                                   // already known now
  branchesOnGithub = [{ name: 'main' }, { name: 'feature/search' }];
  const fourth = await sync();
  assert.equal(fourth.body.branchCount, 2); assert.deepEqual(db.link.knownBranches, ['main', 'feature/search']);   // a deleted branch is forgotten
  assert.equal(db.activity.length, 0);                                                                         // branches are tracked on the link, not credited to a person
});
test('optional sources: a token that cannot read Issues does not stop commits and branches from syncing, and the answer says so', async () => {
  issuesStatus = 403; commitsOnGithub = [commit('abc0001', 'work')]; branchesOnGithub = [{ name: 'main' }];
  const r = await sync();
  assert.equal(r.code, 200); assert.equal(r.body.recorded.commits, 1); assert.equal(r.body.branchCount, 1);
  assert.deepEqual(r.body.unavailable, ['issues']); assert.match(r.body.notes[0], /read access to Issues/);
});
test('a GitHub rate limit on an extra source stops the whole sync (nothing is half-recorded)', async () => {
  issuesStatus = 429; commitsOnGithub = [commit('abc0002', 'work')];
  const r = await sync();
  assert.equal(r.code, 429); assert.equal(db.activity.length, 0); assert.equal(db.events.length, 0); assert.equal(db.link.lastSyncedAt, null);
});
test('a quiet repository: everything is zero and nothing is reported as unavailable', async () => {
  const r = await sync();
  assert.deepEqual(r.body.recorded, { commits: 0, prsOpened: 0, prsMerged: 0, issuesOpened: 0, issuesClosed: 0, releases: 0, newBranches: 0 });
  assert.deepEqual(r.body.unavailable, []); assert.deepEqual(r.body.notes, []); assert.equal(r.body.branchCount, 0);
});
test('commits, pull requests, issues and releases together all land in one sync', async () => {
  commitsOnGithub = [commit('abc0003', `${ref(1)} wip`)];
  pullsOnGithub = [{ number: 3, title: 'PR', body: '', head: { ref: 'b' }, user: { login: 'dev' }, created_at: when(), merged_at: null, html_url: 'u', files: [{ filename: 'a.js', status: 'added', additions: 5, deletions: 0, changes: 5, sha: 'f'.repeat(40) }] }];
  issuesOnGithub = [issue(11, 'An issue')]; releasesOnGithub = [release(9, 'v3')];
  const r = await sync();
  assert.deepEqual(r.body.recorded, { commits: 1, prsOpened: 1, prsMerged: 0, issuesOpened: 1, issuesClosed: 0, releases: 1, newBranches: 0 });
  assert.deepEqual(types().sort(), ['commit_pushed', 'issue_opened', 'pr_opened', 'release_published']);
});
