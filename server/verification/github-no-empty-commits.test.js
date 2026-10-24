// "Empty commits do not count": checks for the rule that a commit or pull request must really change
// something before it moves a task or counts as activity (server/src/utils/githubChanges.js).
// No database, no internet, no GitHub: models are stand-ins and GitHub is a small fake server.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
process.env.GITHUB_TOKEN_KEY = 'ab'.repeat(32);
const http = require('http');
const path = require('path');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const changes = require('../src/utils/githubChanges');
// loaded lazily: the model stand-ins further down must be installed before this module is first loaded
const extractRefs = (text) => require('../src/utils/githubTaskLinks').extractRefs(text);

// ================================================================ the rule itself
const file = (over = {}) => ({ filename: 'a.js', status: 'modified', additions: 3, deletions: 1, changes: 4, patch: '@@', ...over });

test('commit rule: no files = empty; any changed file counts; text lines must reach the minimum', () => {
  assert.equal(changes.commitHasChanges({ files: [], stats: { total: 0 } }, 1), false);              // an empty commit
  assert.equal(changes.commitHasChanges({ files: [file()], stats: { total: 4 } }, 1), true);
  assert.equal(changes.commitHasChanges({ files: [file({ additions: 1, deletions: 0, changes: 1 })], stats: { total: 1 } }, 1), true);
  assert.equal(changes.commitHasChanges({ files: [file({ additions: 1, deletions: 0, changes: 1 })], stats: { total: 1 } }, 5), false); // too small for a stricter team rule
  assert.equal(changes.commitHasChanges({ files: [file({ additions: 5, deletions: 0, changes: 5 })], stats: { total: 5 } }, 5), true);
});
test('commit rule: a picture, a rename or a mode change has no text lines but is still a real change', () => {
  assert.equal(changes.commitHasChanges({ files: [file({ status: 'added', additions: 0, deletions: 0, changes: 0, patch: undefined })], stats: { total: 0 } }, 5), true);
  assert.equal(changes.commitHasChanges({ files: [file({ status: 'renamed', additions: 0, deletions: 0, changes: 0 })], stats: { total: 0 } }, 1), true);
});
test('commit rule: no information at all is not held against the author', () => {
  for (const odd of [null, undefined, {}, 'x', { sha: 'abc' }]) assert.equal(changes.commitHasChanges(odd, 1), true, JSON.stringify(odd));
  assert.equal(changes.commitHasChanges({ files: [file()] }, 1), true);               // no stats: count the lines from the files
  assert.equal(changes.commitHasChanges({ files: [] }, 1), false);                    // an empty file list is still empty
});
test('pull request rule: changed_files must be at least 1', () => {
  assert.equal(changes.pullHasChanges({ changed_files: 0, additions: 0, deletions: 0 }, 1), false);
  assert.equal(changes.pullHasChanges({ changed_files: 2, additions: 10, deletions: 2 }, 1), true);
  assert.equal(changes.pullHasChanges({ changed_files: 1, additions: 2, deletions: 0 }, 5), false);
  assert.equal(changes.pullHasChanges({ changed_files: 1, additions: 0, deletions: 0 }, 5), true); // binary only
  assert.equal(changes.pullHasChanges({}, 1), true);
});
test('settings: GITHUB_MIN_CHANGED_LINES defaults to 1 and ignores nonsense; GITHUB_REQUIRE_CHANGES=false switches it off', () => {
  delete process.env.GITHUB_MIN_CHANGED_LINES; assert.equal(changes.minChangedLines(), 1);
  for (const [v, want] of [['5', 5], ['0', 1], ['-3', 1], ['abc', 1], ['2.9', 2]]) { process.env.GITHUB_MIN_CHANGED_LINES = v; assert.equal(changes.minChangedLines(), want, v); }
  delete process.env.GITHUB_MIN_CHANGED_LINES;
  assert.equal(changes.requireChanges(), true);
  process.env.GITHUB_REQUIRE_CHANGES = 'FALSE'; assert.equal(changes.requireChanges(), false);
  delete process.env.GITHUB_REQUIRE_CHANGES;
});
test('mapLimit: runs everything, keeps the order, and never exceeds the limit', async () => {
  let running = 0; let peak = 0;
  const out = await changes.mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running -= 1; return n * 2; });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]); assert.ok(peak <= 3 && peak >= 2, `peak ${peak}`);
  assert.deepEqual(await changes.mapLimit([], 5, async () => 1), []);
  await assert.rejects(() => changes.mapLimit([1, 2], 2, async () => { throw new Error('boom'); }), /boom/);
});

// ================================================================ filtering a list of events
const commitEv = (sha, text, extra = {}) => ({ key: `o/n:commit:${sha}`, type: 'commit_pushed', date: new Date(), text, meta: { sha, number: undefined }, ...extra });
const prEv = (type, number, text) => ({ key: `o/n:${type === 'pr_opened' ? 'pr-opened' : 'pr-merged'}:${number}`, type, date: new Date(), text, meta: { number } });

function fetchers({ commitInfo = {}, pullInfo = {} } = {}) {
  const calls = { commits: [], pulls: [] };
  return {
    calls,
    getCommit: async (sha) => { calls.commits.push(sha); return commitInfo[sha] || { files: [file()], stats: { total: 4 } }; },
    getPull: async (number) => { calls.pulls.push(number); return pullInfo[number] || { changed_files: 1, additions: 3, deletions: 0 }; },
  };
}
const EMPTY = { files: [], stats: { total: 0 } };

test('filter: real commits are kept; empty ones are dropped, marked, counted and explained', async () => {
  const f = fetchers({ commitInfo: { bbb2222: EMPTY, ccc3333: EMPTY } });
  const events = [commitEv('aaa1111', 'FS-0140ad real work'), commitEv('bbb2222', 'FS-0140ad faked progress'), commitEv('ccc3333', 'no reference here')];
  const r = await changes.filterRealEvents({ events, knownKeys: new Set(), extractRefs, ...f });
  assert.deepEqual(r.events.map((e) => e.meta.sha), ['aaa1111']);
  assert.deepEqual(r.markers, ['o/n:empty:commit:bbb2222', 'o/n:empty:commit:ccc3333']);
  assert.deepEqual(r.skipped, { commits: 2, pullRequests: 0, alreadyIgnored: 0 });
  assert.deepEqual(r.notes, ['FS-0140ad: commit bbb2222 changes no files, so it did not move the task']);   // only a reference earns a note
});
test('filter: commits that are already recorded or already marked empty cost no GitHub calls', async () => {
  const f = fetchers({ commitInfo: { eee5555: EMPTY } });
  const events = [commitEv('aaa1111', 'x'), commitEv('ddd4444', 'x'), commitEv('eee5555', 'x'), commitEv('fff6666', 'x')];
  const known = new Set(['o/n:commit:aaa1111', 'o/n:empty:commit:ddd4444']);
  const r = await changes.filterRealEvents({ events, knownKeys: known, extractRefs, ...f });
  assert.deepEqual(f.calls.commits.sort(), ['eee5555', 'fff6666']);                       // only the NEW ones were looked at
  assert.deepEqual(r.events.map((e) => e.meta.sha), ['aaa1111', 'fff6666']);              // the recorded one stays (counted as a duplicate by the caller)
  assert.deepEqual(r.skipped, { commits: 1, pullRequests: 0, alreadyIgnored: 1 });
});
test('filter: an empty pull request is ignored for both "opened" and "merged", with one GitHub call per PR', async () => {
  const f = fetchers({ pullInfo: { 7: { changed_files: 0, additions: 0, deletions: 0 }, 8: { changed_files: 3, additions: 9, deletions: 1 } } });
  const events = [prEv('pr_opened', 7, 'FS-aaaaaa'), prEv('pr_merged', 7, 'FS-aaaaaa'), prEv('pr_opened', 8, 'FS-bbbbbb'), prEv('pr_merged', 8, 'FS-bbbbbb')];
  const r = await changes.filterRealEvents({ events, knownKeys: new Set(), extractRefs, ...f });
  assert.deepEqual(r.events.map((e) => `${e.type}:${e.meta.number}`), ['pr_opened:8', 'pr_merged:8']);
  assert.deepEqual(f.calls.pulls.sort(), [7, 8]);
  assert.equal(r.skipped.pullRequests, 2); assert.deepEqual(r.notes, ['FS-aaaaaa: PR #7 has no file changes, so it did not move the task']);
});
test('filter: with GITHUB_REQUIRE_CHANGES=false everything passes and GitHub is not asked', async () => {
  process.env.GITHUB_REQUIRE_CHANGES = 'false';
  const f = fetchers({ commitInfo: { bbb2222: EMPTY } });
  const events = [commitEv('bbb2222', 'x')];
  const r = await changes.filterRealEvents({ events, knownKeys: new Set(), extractRefs, ...f });
  delete process.env.GITHUB_REQUIRE_CHANGES;
  assert.equal(r.events.length, 1); assert.equal(f.calls.commits.length, 0); assert.deepEqual(r.markers, []);
});
test('filter: a stricter minimum (GITHUB_MIN_CHANGED_LINES) also rejects trivial commits', async () => {
  const tiny = { files: [file({ additions: 1, deletions: 0, changes: 1 })], stats: { total: 1 } };
  const f = fetchers({ commitInfo: { ttt0001: tiny } });
  const r = await changes.filterRealEvents({ events: [commitEv('ttt0001', 'FS-aaaaaa')], knownKeys: new Set(), extractRefs, minLines: 3, ...f });
  assert.equal(r.events.length, 0); assert.equal(r.skipped.commits, 1);
});
test('filter: if GitHub cannot be asked, the whole check fails (nothing is half-decided)', async () => {
  const getCommit = async () => { throw Object.assign(new Error('rate limit'), { status: 429 }); };
  await assert.rejects(() => changes.filterRealEvents({ events: [commitEv('a', 'x')], knownKeys: new Set(), extractRefs, getCommit, getPull: async () => ({}) }), /rate limit/);
});

// ================================================================ the real sync, against a fake GitHub
const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const T = (n) => `64f000000000000000000${String(n).padStart(3, '0')}`;
const db = { tasks: [], events: [], activity: [], link: null, project: null };
const chain = (v) => { const c = { select() { return c; }, sort() { return c; }, lean() { return c; }, then: (res, rej) => Promise.resolve(typeof v === 'function' ? v() : v).then(res, rej) }; return c; };
const mkTask = (n, status = 'Backlog') => { const t = { _id: T(n), project: T(900), title: `Task ${n}`, status, position: n, isArchived: false }; Object.defineProperty(t, 'save', { value: async () => {}, enumerable: false }); return t; };

stub('models/Project.js', { findById: () => chain(() => db.project) });
stub('models/Workspace.js', { findById: () => chain({ members: [{ user: 'u1' }] }) });
stub('models/User.js', { find: () => chain([]) });
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
const { syncRepository } = require('../src/controllers/githubController');
const { encrypt } = require('../src/utils/tokenCrypto');

let calls = []; let commitsOnGithub = []; let pullsOnGithub = []; let gh;
const fakeGithub = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  calls.push(url.pathname);
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m;
  if ((m = url.pathname.match(/^\/repos\/o\/n\/commits\/(\w+)$/))) { const c = commitsOnGithub.find((x) => x.sha === m[1]); return c ? json(200, { sha: c.sha, files: c.files, stats: { total: c.files.reduce((n, f) => n + f.changes, 0) } }) : json(404, {}); }
  if (url.pathname === '/repos/o/n/commits') return json(200, commitsOnGithub.map(({ files, ...rest }) => rest));
  if ((m = url.pathname.match(/^\/repos\/o\/n\/pulls\/(\d+)$/))) { const p = pullsOnGithub.find((x) => x.number === Number(m[1])); return json(200, { number: p.number, changed_files: p.files, additions: p.files * 3, deletions: 0 }); }
  if (url.pathname === '/repos/o/n/pulls') return json(200, pullsOnGithub);
  return json(404, {});
});
before(async () => { await new Promise((r) => fakeGithub.listen(0, r)); process.env.GITHUB_API_URL = `http://localhost:${fakeGithub.address().port}`; });
after(() => fakeGithub.close());

const commit = (sha, message, fileChanges) => ({ sha, html_url: `https://x/${sha}`, author: { login: 'dev' }, commit: { message, author: { date: new Date(Date.now() - 60000).toISOString() } }, files: fileChanges });
const realChange = [{ filename: 'a.js', status: 'modified', additions: 5, deletions: 1, changes: 6 }];
beforeEach(() => {
  calls = []; commitsOnGithub = []; pullsOnGithub = [];
  db.tasks = [mkTask(1), mkTask(2), mkTask(3)]; db.events = []; db.activity = [];
  db.project = { _id: T(900), workspace: T(800), isArchived: false, columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'] };
  const link = { repoFullName: 'o/n', tokenEncrypted: encrypt('github_pat_test'), lastSyncedAt: null, linkedBy: 'u1', save: async () => {} };
  db.link = link;
  delete process.env.GITHUB_REQUIRE_CHANGES; delete process.env.GITHUB_MIN_CHANGED_LINES;
});
const sync = async () => { const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } }; await syncRepository({ params: { projectId: T(900) }, user: { id: 'u1' } }, res); if (res.code === 500) console.log('SYNC 500:', JSON.stringify(res.body)); return res; };
const status = (n) => db.tasks.find((t) => String(t._id) === T(n)).status;
const ref = (n) => `FS-${T(n).slice(-6)}`;

test('sync: a REAL commit moves the task; an EMPTY commit with a reference does not', async () => {
  commitsOnGithub = [commit('aaa1111', `${ref(1)} real work`, realChange), commit('bbb2222', `${ref(2)} fake progress`, [])];
  const r = await sync();
  assert.equal(r.code, 200);
  assert.equal(status(1), 'In Progress'); assert.equal(status(2), 'Backlog');
  assert.equal(r.body.recorded.commits, 1); assert.equal(r.body.tasksMoved.length, 1); assert.equal(r.body.tasksMoved[0].ref, ref(1));
  assert.deepEqual(r.body.skippedNoChanges, { commits: 1, pullRequests: 0, alreadyIgnored: 0 });
  assert.deepEqual(r.body.taskLinkNotes, [`${ref(2)}: commit bbb2222 changes no files, so it did not move the task`]);
  assert.equal(db.activity.filter((a) => a.type === 'commit_pushed').length, 1);        // the empty commit is not in the feed or the weekly dots
});
test('sync: the empty commit is looked at once, then remembered (no repeat calls, no repeat notes)', async () => {
  commitsOnGithub = [commit('aaa1111', `${ref(1)} work`, realChange), commit('bbb2222', `${ref(2)} fake`, [])];
  await sync(); calls = [];
  const again = await sync();
  assert.deepEqual(calls.filter((c) => c.includes('/commits/')), []);                    // no detail calls the second time
  assert.equal(again.body.recorded.commits, 0); assert.equal(again.body.skippedAlreadyRecorded, 1);
  assert.deepEqual(again.body.skippedNoChanges, { commits: 0, pullRequests: 0, alreadyIgnored: 1 });
  assert.equal(status(2), 'Backlog'); assert.equal(db.activity.filter((a) => a.type === 'commit_pushed').length, 1);
});
test('sync: a later REAL commit for the same task does move it', async () => {
  commitsOnGithub = [commit('bbb2222', `${ref(2)} fake`, [])];
  await sync(); assert.equal(status(2), 'Backlog');
  commitsOnGithub.push(commit('ccc3333', `${ref(2)} now with real changes`, realChange));
  const r = await sync();
  assert.equal(status(2), 'In Progress'); assert.equal(r.body.tasksMoved[0].ref, ref(2));
});
test('sync: an empty commit WITHOUT a reference is also ignored (and does not inflate activity)', async () => {
  commitsOnGithub = [commit('ddd4444', 'just a ping', [])];
  const r = await sync();
  assert.equal(r.body.recorded.commits, 0); assert.equal(r.body.skippedNoChanges.commits, 1); assert.deepEqual(r.body.taskLinkNotes, []);
});
test('sync: an empty pull request cannot move a task to Review or Done; a real one can', async () => {
  const when = new Date(Date.now() - 120000).toISOString();
  pullsOnGithub = [
    { number: 7, title: `${ref(1)} empty PR`, body: '', head: { ref: 'x' }, user: { login: 'dev' }, created_at: when, merged_at: when, html_url: 'u', files: 0 },
    { number: 8, title: `${ref(2)} real PR`, body: '', head: { ref: 'y' }, user: { login: 'dev' }, created_at: when, merged_at: when, html_url: 'u', files: 2 },
  ];
  const r = await sync();
  assert.equal(status(1), 'Backlog'); assert.equal(status(2), 'Done');
  assert.deepEqual(r.body.skippedNoChanges, { commits: 0, pullRequests: 2, alreadyIgnored: 0 });
  assert.equal(r.body.recorded.prsOpened, 1); assert.equal(r.body.recorded.prsMerged, 1);
  assert.ok(r.body.taskLinkNotes.includes(`${ref(1)}: PR #7 has no file changes, so it did not move the task`));
});
test('sync: GITHUB_REQUIRE_CHANGES=false restores the old behaviour (empty commits count) and asks GitHub nothing extra', async () => {
  process.env.GITHUB_REQUIRE_CHANGES = 'false';
  commitsOnGithub = [commit('bbb2222', `${ref(2)} demo`, [])];
  const r = await sync();
  assert.equal(status(2), 'In Progress'); assert.equal(r.body.recorded.commits, 1);
  assert.deepEqual(calls.filter((c) => c.includes('/commits/')), []);
});
test('sync: if GitHub cannot be asked about a commit, the sync fails cleanly and records nothing', async () => {
  commitsOnGithub = [commit('aaa1111', `${ref(1)} work`, realChange)];
  process.env.GITHUB_API_URL_BACKUP = process.env.GITHUB_API_URL;
  const original = fakeGithub.listeners('request')[0];
  fakeGithub.removeAllListeners('request');
  fakeGithub.on('request', (req, res) => { const u = new URL(req.url, 'http://x'); if (/\/commits\/\w+$/.test(u.pathname)) { res.writeHead(403, { 'x-ratelimit-remaining': '0' }); return res.end('{}'); } return original(req, res); });
  const r = await sync();
  fakeGithub.removeAllListeners('request'); fakeGithub.on('request', original);
  assert.equal(r.code, 429); assert.match(r.body.message, /rate limit/i);
  assert.equal(status(1), 'Backlog'); assert.deepEqual(db.events, []); assert.equal(db.link.lastSyncedAt, null);
});
