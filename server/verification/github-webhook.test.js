// GitHub webhook -> Kanban synchronization. No database and no internet: the models and GitHub
// are stand-ins, exactly like the other verification files. AI is deliberately switched off here;
// the AI path is covered with a stubbed model in github-webhook-ai.test.js.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
process.env.GITHUB_TOKEN_KEY = 'ab'.repeat(32);
process.env.GITHUB_WEBHOOK_SECRET = 'webhook-secret';
process.env.AI_API_KEY = '';
delete process.env.GITHUB_REQUIRE_CHANGES;
const path = require('path');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const src = path.join(__dirname, '..', 'src');
const stub = (rel, exports) => { const p = require.resolve(path.join(src, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const T = (n) => `64f000000000000000000${String(n).padStart(3, '0')}`;
const chain = (v) => { const c = { select() { return c; }, sort() { return c; }, limit() { return c; }, lean() { return c; }, then: (res, rej) => Promise.resolve(typeof v === 'function' ? v() : v).then(res, rej) }; return c; };
const task = (n, status, extra = {}) => {
  const t = { _id: T(n), project: T(900), workspace: T(800), title: `Task ${n}`, description: 'Do it', status, position: 0, checklist: [], github: {}, isArchived: false, ...extra };
  Object.defineProperty(t, 'save', { value: async () => {}, enumerable: false });
  return t;
};

const db = { tasks: [], events: [], activity: [], links: [], reviews: [], releaseNotes: [] };
let aiReview = null;
let reviewDoc = null;
function GithubReview(doc) {
  Object.assign(this, doc);
  this._id = 'review1';
  this.save = async () => { reviewDoc = this; };
}
const project = { _id: T(900), workspace: T(800), isArchived: false, columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'] };
const link = { _id: 'link1', project: T(900), workspace: T(800), repoFullName: 'o/n', linkedBy: 'u1', workflow: {}, tokenEncrypted: null };

stub('models/Project.js', { findById: () => chain(project) });
stub('models/Workspace.js', { findById: () => chain({ members: [{ user: 'u1' }] }) });
stub('models/User.js', { find: () => chain([{ _id: 'u1', githubUsername: 'dev' }]) });
stub('models/Task.js', {
  find: () => chain(() => db.tasks.filter((t) => !t.isArchived)),
  findById: async (id) => db.tasks.find((t) => String(t._id) === String(id)) || null,
  findOne: () => chain(null),
});
stub('models/GithubLink.js', { findOne: () => chain(link) });
stub('models/GithubEvent.js', {
  create: async ({ key }) => { if (db.events.includes(key)) throw Object.assign(new Error('duplicate'), { code: 11000 }); db.events.push(key); },
  deleteOne: async ({ key }) => { db.events = db.events.filter((k) => k !== key); },
});
stub('models/GithubTaskLink.js', {
  find: (query) => chain(db.links.filter((row) => Object.entries(query).every(([key, value]) => String(row[key] ?? '') === String(value ?? '')))),
  findOneAndUpdate: async (filter, update) => { db.links.push({ ...filter, ...update.$set }); },
  updateOne: async () => {},
});
stub('models/GithubReview.js', Object.assign(GithubReview, { find: () => chain([]), findOne: async () => reviewDoc }));
stub('services/aiService.js', {
  isAiConfigured: () => Boolean(aiReview),
  generateJson: async () => aiReview,
});
stub('models/ReleaseNote.js', {
  findOne: async ({ prNumber }) => db.releaseNotes.find((n) => n.prNumber === prNumber) || null,
  create: async (doc) => { db.releaseNotes.push(doc); return doc; },
});
stub('models/ActivityLog.js', {
  create: async (doc) => {
    const d = { _id: `a${db.activity.length + 1}`, createdAt: new Date(), ...doc };
    db.activity.push(d);
    return { ...d, populate: async () => {}, toObject: () => d };
  },
});
stub('utils/notify.js', { notify: async () => null });
stub('utils/githubClient.js', { getPull: async () => null, listPullFiles: async () => [] });

const { processWithIdempotency } = require('../src/services/githubKanbanSyncService');

const repo = { full_name: 'o/n' };
const sender = { login: 'dev' };
const push = (deliveryId, sha, message, extra = {}) => ({
  event: 'push',
  deliveryId,
  payload: {
    repository: repo,
    ref: 'refs/heads/FS-000001',
    sender,
    commits: [{ id: sha, message, timestamp: new Date().toISOString(), added: ['a.js'], removed: [], modified: [], author: { username: 'dev' }, url: 'u' }],
    ...extra,
  },
});
const pull = (over = {}) => ({ number: 5, title: 'FS-000001 add login', body: '', html_url: 'http://pr/5', head: { ref: 'FS-000001' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over });
const prEvent = (deliveryId, action, over = {}) => ({ event: 'pull_request', deliveryId, payload: { action, repository: repo, sender, pull_request: pull(over) } });
const current = () => db.tasks[0];

beforeEach(() => {
  db.tasks = [task(1, 'To Do')];
  db.events = [];
  db.activity = [];
  db.links = [];
  db.reviews = [];
  db.releaseNotes = [];
  process.env.AI_API_KEY = '';
  delete process.env.GITHUB_REQUIRE_CHANGES;
  aiReview = null;
  reviewDoc = null;
  project.columns = ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'];
});

test('a push with FS-xxxxxx moves the task to In Progress, records it and is idempotent', async () => {
  const first = await processWithIdempotency(push('d1', 'abc1234', 'FS-000001 start the login page'));
  assert.equal(current().status, 'In Progress');
  assert.equal(current().github.branch, 'FS-000001');
  assert.equal(first.processed.results[0].status, 'moved');
  assert.ok(db.activity.some((a) => a.type === 'commit_pushed'));
  const moved = db.activity.find((a) => a.type === 'task_status_changed');
  assert.match(moved.message, /moved "Task 1" from To Do to In Progress \(commit abc1234\)/);
  assert.equal(moved.meta.source, 'github');
  assert.equal(moved.meta.auto, true);

  const again = await processWithIdempotency(push('d1', 'abc1234', 'FS-000001 start the login page'));
  assert.equal(again.duplicate, true);
  assert.equal(db.activity.filter((a) => a.type === 'task_status_changed').length, 1);
});

test('an empty commit does not move the task', async () => {
  const ev = push('d2', 'abc2222', 'FS-000001 nothing');
  ev.payload.commits[0].added = [];
  await processWithIdempotency(ev);
  assert.equal(current().status, 'To Do');
  assert.equal(db.activity.length, 0);
});

test('an out-of-order old push does not undo a newer PR transition', async () => {
  await processWithIdempotency(prEvent('d3', 'opened'));
  assert.equal(current().status, 'Review');

  const old = push('d4', 'abc3333', 'FS-000001 old work');
  old.payload.commits[0].timestamp = new Date(Date.now() - 60000).toISOString();
  await processWithIdempotency(old);
  assert.equal(current().status, 'Review');
});

test('a pull request with no changed files does not move the task', async () => {
  await processWithIdempotency(prEvent('d4b', 'opened', { changed_files: 0 }));
  assert.equal(current().status, 'To Do');
});

test('a pull request with no task reference is not guessed at', async () => {
  await processWithIdempotency(prEvent('d5', 'opened', { title: 'Add login', head: { ref: 'login' } }));
  assert.equal(current().status, 'To Do');
});

test('changes requested moves out of Review; merge completes the task and writes a release note', async () => {
  await processWithIdempotency(prEvent('d6', 'opened'));
  assert.equal(current().status, 'Review');

  await processWithIdempotency({
    event: 'pull_request_review',
    deliveryId: 'd7',
    payload: { repository: repo, sender, review: { state: 'changes_requested', submitted_at: new Date().toISOString(), user: sender }, pull_request: pull() },
  });
  assert.equal(current().status, 'In Progress');
  assert.ok(db.activity.some((a) => a.type === 'review_submitted'));

  await processWithIdempotency(prEvent('d8', 'closed', { merged: true, merged_at: new Date().toISOString() }));
  assert.equal(current().status, 'Done');
  assert.equal(db.releaseNotes.length, 1);
  assert.equal(db.releaseNotes[0].prNumber, 5);
});

test('a task completed manually is never reopened by a later GitHub event', async () => {
  db.tasks = [task(1, 'Done', { statusSource: 'manual' })];
  await processWithIdempotency(push('d9', 'abc4444', 'FS-000001 more work'));
  assert.equal(current().status, 'Done');
});

test('custom column names are honoured and a missing Changes Requested column falls back', async () => {
  project.columns = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Testing', 'Done'];
  await processWithIdempotency(prEvent('d9b', 'opened'));
  assert.equal(current().status, 'In Review');

  await processWithIdempotency({
    event: 'pull_request_review',
    deliveryId: 'd9c',
    payload: { repository: repo, sender, review: { state: 'changes_requested', submitted_at: new Date().toISOString(), user: sender }, pull_request: pull() },
  });
  assert.equal(current().status, 'In Progress');
});

test('a failed CI check moves a review task back; a merge that requires checks does not finish it', async () => {
  link.workflow = { requireChecksForDone: true };
  try {
    await processWithIdempotency(prEvent('d10', 'opened'));
    await processWithIdempotency({
      event: 'check_run',
      deliveryId: 'd11',
      payload: { repository: repo, sender, check_run: { conclusion: 'failure', status: 'completed', completed_at: new Date().toISOString(), pull_requests: [{ number: 5 }], head_branch: 'FS-000001' } },
    });
    assert.equal(current().status, 'In Progress');

    await processWithIdempotency(prEvent('d12', 'closed', { merged: true, merged_at: new Date().toISOString() }));
    assert.equal(current().status, 'Testing'); // checks did not pass, so it waits for testing
  } finally {
    link.workflow = {};
  }
});

test('a high-confidence blocking AI finding moves the task back and keeps the history', async () => {
  aiReview = {
    verdict: 'changes_requested',
    summary: 'Login stores the password in plain text.',
    findings: [{ title: 'Credential leak', detail: 'Use a hash.', file: 'auth.js', line: 12, severity: 'critical', confidence: 0.95 }],
    acceptanceCriteria: [{ criterion: 'Passwords are hashed', met: false, confidence: 0.9 }],
  };
  await processWithIdempotency(prEvent('d13', 'opened'));
  assert.equal(current().status, 'In Progress');
  assert.equal(current().github.reviewVerdict, 'changes_requested');
  assert.ok(reviewDoc);
  assert.equal(reviewDoc.findings[0].severity, 'critical');
  assert.equal(reviewDoc.findings[0].actionable, true);
  assert.equal(reviewDoc.history.length, 1);
});

test('a low-confidence finding does not move the task back', async () => {
  aiReview = {
    verdict: 'changes_requested',
    summary: 'Possible style issue.',
    findings: [{ title: 'Maybe rename', detail: 'Preference only.', file: 'a.js', line: 1, severity: 'low', confidence: 0.2 }],
    acceptanceCriteria: [],
  };
  await processWithIdempotency(prEvent('d14', 'opened'));
  assert.equal(current().status, 'Review');
  assert.equal(reviewDoc.findings[0].actionable, false);
  assert.equal(current().github.reviewVerdict, 'changes_requested');
});

test('the webhook controller rejects an invalid signature and accepts a valid ping', async () => {
  const crypto = require('crypto');
  const { receiveGithubWebhook } = require('../src/controllers/githubWebhookController');
  const response = () => {
    const res = { code: 200, body: null, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
    return res;
  };
  const raw = Buffer.from(JSON.stringify({ zen: 'hi' }));
  const bad = response();
  await receiveGithubWebhook({ body: raw, headers: {}, get: () => 'sha256=deadbeef' }, bad);
  assert.equal(bad.code, 401);

  const ok = response();
  const signature = 'sha256=' + crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET).update(raw).digest('hex');
  await receiveGithubWebhook({
    body: raw,
    headers: {},
    get: (name) => (name === 'x-hub-signature-256' ? signature : name === 'x-github-event' ? 'ping' : ''),
  }, ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.message, 'pong');
});
