// Automatic checks for FR11 (AI plan) and FR12 (OCR). They need no database and no internet:
// the AI service is a small fake server and OCR uses server/tessdata.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const token = jwt.sign({ id: 'u1', role: 'Member' }, process.env.JWT_SECRET);
const goodPlan = {
  name: 'Library System', description: 'Borrow and return books',
  objectives: ['Online catalogue'],
  milestones: [{ title: 'MVP', offsetDays: 14 }, { title: 'Launch', offsetDays: 60 }],
  tasks: [
    { title: 'Design database', priority: 'high', estimatedHours: 6, acceptanceCriteria: ['Schema approved'], subtasks: ['ER diagram'], labels: ['backend'], milestoneIndex: 0, dependsOn: [] },
    { title: 'Build search', priority: 'Medium', estimatedHours: 10, acceptanceCriteria: ['Finds by title'], subtasks: [], labels: ['frontend'], milestoneIndex: 1, dependsOn: [0, 5, 1, -1] },
    { title: '', priority: 'Low' },
  ],
  sprintPlan: [{ name: 'Sprint 1', taskIndices: [0, 1, 9] }],
};

// ---- a fake AI service on localhost (OpenAI-compatible and Gemini shapes) ----
let aiMode = 'good';
const aiCalls = [];
const fakeAi = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    aiCalls.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (aiMode === 'badkey') return json(401, { error: { message: 'Incorrect API key provided' } });
    if (aiMode === 'rate') return json(429, { error: { message: 'Rate limit' } });
    if (aiMode === 'garbage') return json(200, { choices: [{ message: { content: 'I cannot help with that.' } }] });
    if (aiMode === 'notjson') return json(200, { choices: [{ message: { content: '{ broken json' } }] });
    if (aiMode === 'notasks') return json(200, { choices: [{ message: { content: JSON.stringify({ name: 'X', tasks: [] }) } }] });
    const content = aiMode === 'fenced' ? '```json\n' + JSON.stringify(goodPlan) + '\n```' : JSON.stringify(goodPlan);
    if (req.url.includes(':generateContent')) return json(200, { candidates: [{ content: { parts: [{ text: content }] } }] });
    json(200, { choices: [{ message: { content } }] });
  });
});

let aiPort; let appServer; let base;
before(async () => {
  await new Promise((r) => fakeAi.listen(0, r)); aiPort = fakeAi.address().port;
  const app = express(); app.use(express.json());
  app.use('/api', require('../src/routes/ocrRoutes'));
  // only the generate-plan route is mounted here (the project-creation route needs MongoDB)
  const { generatePlan } = require('../src/controllers/aiProjectController');
  const protect = require('../src/middleware/authMiddleware');
  app.post('/api/ai/generate-plan', protect, generatePlan);
  appServer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${appServer.address().port}/api`;
});
after(() => { fakeAi.close(); appServer.close(); });

const call = async (method, p, { body, auth = true, form } = {}) => {
  const headers = {}; if (auth) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + p, { method, headers, body: payload });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
};
const upload = (file, type) => { const f = new FormData(); f.append('file', new Blob([fs.readFileSync(file)], { type }), path.basename(file)); return f; };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const D = path.join(__dirname, 'samples') + path.sep;
const os = require('os');

// ============================ FR11: the plan sanitiser and the model-reply parser ============================
test('FR11 sanitizePlan: normalises priorities, drops bad dependencies, keeps graph acyclic, skips untitled tasks', () => {
  const { sanitizePlan } = require('../src/services/aiService');
  const { plan, warnings } = sanitizePlan(goodPlan);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].priority, 'High');                       // 'high' -> 'High'
  assert.deepEqual(plan.tasks[1].dependsOn, [0]);                      // 5, 1 (itself) and -1 removed
  assert.equal(plan.tasks[1].milestoneIndex, 1);
  assert.match(warnings[0], /Skipped task 3/);
  assert.deepEqual(plan.sprintPlan[0].taskIndices, [0, 1]);            // index 9 dropped
});
test('FR11 sanitizePlan: rejects unusable plans', () => {
  const { sanitizePlan, AiInvalidResponseError } = require('../src/services/aiService');
  for (const bad of [null, [], 'text', {}, { name: 'X' }, { name: 'X', tasks: [] }, { name: 'X', tasks: [{ title: '' }] }]) {
    assert.throws(() => sanitizePlan(bad), AiInvalidResponseError);
  }
});
test('FR11 sanitizePlan: clamps numbers and lengths', () => {
  const { sanitizePlan, MAX_TASKS } = require('../src/services/aiService');
  const many = Array.from({ length: 60 }, (_, i) => ({ title: `T${i}`, estimatedHours: 99999, milestoneIndex: 7 }));
  const { plan } = sanitizePlan({ name: 'x'.repeat(500), milestones: [{ title: 'm', offsetDays: 9999 }], tasks: many });
  assert.equal(plan.tasks.length, MAX_TASKS);
  assert.equal(plan.name.length, 120);
  assert.equal(plan.tasks[0].estimatedHours, 1000);
  assert.equal(plan.milestones[0].offsetDays, 365);
  assert.equal(plan.tasks[0].milestoneIndex, null);
});
test('FR11 parseModelJson: plain, fenced and prose-wrapped JSON; rejects non-JSON', () => {
  const { parseModelJson, AiInvalidResponseError } = require('../src/services/aiService');
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseModelJson('Sure! Here it is: {"a":3} hope it helps'), { a: 3 });
  assert.throws(() => parseModelJson('no json at all'), AiInvalidResponseError);
  assert.throws(() => parseModelJson('{ broken'), AiInvalidResponseError);
});

// ============================ FR11: POST /api/ai/generate-plan against the fake AI ============================
const REQ = 'Build a library system where students search and borrow books and librarians track overdue returns.';
test('FR11 generate-plan: needs a login, text, and enough text', async () => {
  assert.equal((await call('POST', '/ai/generate-plan', { auth: false, body: { requirements: REQ } })).status, 401);
  assert.equal((await call('POST', '/ai/generate-plan', { body: {} })).status, 400);
  assert.equal((await call('POST', '/ai/generate-plan', { body: { requirements: '   ' } })).status, 400);
  assert.equal((await call('POST', '/ai/generate-plan', { body: { requirements: 'x'.repeat(40001) } })).status, 400);
});
test('FR11 generate-plan: 503 with aiUnavailable when no key is configured', async () => {
  delete process.env.AI_API_KEY;
  const r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
  assert.equal(r.status, 503); assert.equal(r.data.aiUnavailable, true); assert.match(r.data.message, /not configured/);
});
test('FR11 generate-plan: OpenAI-compatible provider returns a validated plan', async () => {
  Object.assign(process.env, { AI_API_KEY: 'k', AI_PROVIDER: 'openai', AI_BASE_URL: `http://localhost:${aiPort}/v1`, AI_MODEL: 'm' });
  aiMode = 'good'; aiCalls.length = 0;
  const r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
  assert.equal(r.status, 200); assert.equal(r.data.plan.tasks.length, 2); assert.ok(r.data.warnings.length >= 1);
  assert.equal(aiCalls[0].url, '/v1/chat/completions');
  assert.equal(aiCalls[0].headers.authorization, 'Bearer k');
  assert.equal(aiCalls[0].body.response_format.type, 'json_object');
});
test('FR11 generate-plan: Gemini provider uses generateContent with the key in a header', async () => {
  Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_BASE_URL: `http://localhost:${aiPort}/v1beta`, AI_MODEL: 'gemini-test' });
  aiCalls.length = 0;
  const r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
  assert.equal(r.status, 200); assert.equal(r.data.plan.name, 'Library System');
  assert.equal(aiCalls[0].url, '/v1beta/models/gemini-test:generateContent');
  assert.equal(aiCalls[0].headers['x-goog-api-key'], 'k');
});
test('FR11 generate-plan: tolerates a fenced JSON reply', async () => {
  aiMode = 'fenced';
  assert.equal((await call('POST', '/ai/generate-plan', { body: { requirements: REQ } })).status, 200);
});
test('FR11 generate-plan: bad key -> 503 with a clear message; rate limit -> 503; junk reply -> 422', async () => {
  aiMode = 'badkey';
  let r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
  assert.equal(r.status, 503); assert.match(r.data.message, /rejected the server credentials/);
  aiMode = 'rate';
  r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
  assert.equal(r.status, 503); assert.match(r.data.message, /HTTP 429/);
  for (const mode of ['garbage', 'notjson', 'notasks']) {
    aiMode = mode;
    r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
    assert.equal(r.status, 422, mode);
  }
});
test('FR11 generate-plan: the AI service being down -> 503, never a crash', async () => {
  process.env.AI_BASE_URL = 'http://localhost:1/v1'; // nothing listens here
  const r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
  assert.equal(r.status, 503); assert.match(r.data.message, /could not be reached/);
});
test('FR11 generate-plan: the API key never appears in any response', async () => {
  aiMode = 'good'; process.env.AI_BASE_URL = `http://localhost:${aiPort}/v1`; process.env.AI_PROVIDER = 'openai';
  const r = await call('POST', '/ai/generate-plan', { body: { requirements: REQ } });
  assert.ok(!JSON.stringify(r.data).includes('"k"') && !JSON.stringify(r.data).includes('Bearer'));
});

// ============================ FR12: POST /api/ocr/extract ============================
test('FR12 ocr: needs a login and a file', async () => {
  assert.equal((await call('POST', '/ocr/extract', { auth: false, form: upload(D + 'req.docx', DOCX) })).status, 401);
  const r = await call('POST', '/ocr/extract', { body: {} });
  assert.equal(r.status, 400); assert.match(r.data.message, /No file/);
});
test('FR12 ocr: DOCX text is extracted', async () => {
  const r = await call('POST', '/ocr/extract', { form: upload(D + 'req.docx', DOCX) });
  assert.equal(r.status, 200); assert.equal(r.data.source.method, 'docx');
  assert.match(r.data.text, /Library Management System/); assert.match(r.data.text, /overdue returns/);
});
test('FR12 ocr: PPTX text is extracted slide by slide', async () => {
  const r = await call('POST', '/ocr/extract', { form: upload(D + 'req.pptx', PPTX) });
  assert.equal(r.status, 200); assert.equal(r.data.source.method, 'pptx'); assert.equal(r.data.source.pages, 1);
  assert.match(r.data.text, /Functional Requirements: Remaining/);
});
test('FR12 ocr: a normal text PDF uses its embedded text (no OCR needed)', async () => {
  const r = await call('POST', '/ocr/extract', { form: upload(D + 'embedded-text.pdf', 'application/pdf') });
  assert.equal(r.status, 200); assert.equal(r.data.source.method, 'pdf-text'); assert.match(r.data.text, /Library Management System/);
});
test('FR12 ocr: a PDF that pdf-parse can choke on ("bad XRef") is still read, by text or by the OCR fallback', { timeout: 120000 }, async () => {
  const r = await call('POST', '/ocr/extract', { form: upload(D + 'xref-problem.pdf', 'application/pdf') });
  assert.equal(r.status, 200); assert.ok(['pdf-text', 'pdf-ocr'].includes(r.data.source.method)); assert.match(r.data.text, /register and log in/);
});
test('FR12 ocr: a scanned (image-only) PDF is read with OCR', { timeout: 120000 }, async () => {
  const r = await call('POST', '/ocr/extract', { form: upload(D + 'scan.pdf', 'application/pdf') });
  assert.equal(r.status, 200); assert.equal(r.data.source.method, 'pdf-ocr'); assert.match(r.data.text, /Scanned requirements/);
});
test('FR12 ocr: unsupported type and oversized files are refused with JSON', async () => {
  let r = await call('POST', '/ocr/extract', { form: upload(D + 'notes.txt', 'text/plain') });
  assert.equal(r.status, 400); assert.match(r.data.message, /Unsupported file type/);
  const bigFile = path.join(os.tmpdir(), 'flowsync-big.pdf'); fs.writeFileSync(bigFile, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(16 * 1024 * 1024)]));
  r = await call('POST', '/ocr/extract', { form: upload(bigFile, 'application/pdf') }); fs.unlinkSync(bigFile);
  assert.equal(r.status, 400); assert.match(r.data.message, /too large \(max 15MB\)/);
});
test('FR12 ocr: a corrupt file gives a clear 4xx, not a crash', async () => {
  const f = new FormData(); f.append('file', new Blob(['this is not a docx'], { type: DOCX }), 'bad.docx');
  const r = await call('POST', '/ocr/extract', { form: f });
  assert.equal(r.status, 422); assert.match(r.data.message, /could not be read/);
  const g = new FormData(); g.append('file', new Blob(['%PDF-1.4 garbage'], { type: 'application/pdf' }), 'bad.pdf');
  const r2 = await call('POST', '/ocr/extract', { form: g });
  assert.ok([422, 500].includes(r2.status)); assert.equal(r2.data.success, false);
});
test('FR12 ocr: an image is read with OCR, offline, using the bundled language data', { timeout: 120000 }, async () => {
  const r = await call('POST', '/ocr/extract', { form: upload(D + 'text.png', 'image/png') });
  assert.equal(r.status, 200); assert.equal(r.data.source.method, 'ocr'); assert.match(r.data.text.toLowerCase(), /hello/);
});
