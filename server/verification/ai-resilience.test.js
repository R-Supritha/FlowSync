// Checks for the free-tier problems seen in real use: an overloaded model (503), a retired model (404),
// a slow "thinking" model, and a rejected key. A small fake AI service stands in for Google.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const token = jwt.sign({ id: 'u1', role: 'Member' }, process.env.JWT_SECRET);
const REQ = 'Build a library system where students search and borrow books and librarians track overdue returns.';
const plan = { name: 'Library', description: 'd', milestones: [{ title: 'MVP', offsetDays: 7 }], tasks: [{ title: 'Design', priority: 'High', estimatedHours: 2, acceptanceCriteria: ['ok'], dependsOn: [] }] };

// behaviour per model name: an array of steps used in order, the last one repeats
let behaviour = {}; let calls = []; let delayMs = 0;
const fakeAi = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const model = decodeURIComponent((req.url.match(/models\/([^:/]+)/) || [])[1] || '');
    const payload = JSON.parse(body || '{}');
    calls.push({ model, payload });
    const steps = behaviour[model] || ['ok'];
    const step = steps[Math.min(calls.filter((c) => c.model === model).length - 1, steps.length - 1)];
    const send = () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (step === '503') return json(503, { error: { message: 'This model is currently experiencing high demand.' } });
      if (step === '404') return json(404, { error: { message: `This model models/${model} is no longer available to new users.` } });
      if (step === '429') return json(429, { error: { message: 'Quota exceeded' } });
      if (step === '403') return json(403, { error: { message: 'API key not valid' } });
      json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] });
    };
    delayMs ? setTimeout(send, delayMs) : send();
  });
});

let base; let appServer; let aiPort;
before(async () => {
  await new Promise((r) => fakeAi.listen(0, r)); aiPort = fakeAi.address().port;
  const { generatePlan } = require('../src/controllers/aiProjectController');
  const protect = require('../src/middleware/authMiddleware');
  const app = express(); app.use(express.json()); app.post('/api/ai/generate-plan', protect, generatePlan);
  appServer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${appServer.address().port}/api`;
});
after(() => { fakeAi.close(); appServer.close(); });
beforeEach(() => {
  behaviour = {}; calls = []; delayMs = 0;
  Object.assign(process.env, { AI_API_KEY: 'k', AI_PROVIDER: 'gemini', AI_BASE_URL: `http://localhost:${aiPort}/v1beta`, AI_MODEL: 'main', AI_RETRY_DELAY_MS: '5' });
  delete process.env.AI_FALLBACK_MODELS; delete process.env.AI_TIMEOUT_MS; delete process.env.AI_THINKING_LEVEL;
});
const generate = async () => {
  const res = await fetch(`${base}/ai/generate-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ requirements: REQ }) });
  return { status: res.status, data: await res.json() };
};

test('an overloaded model (503) is retried and then succeeds', async () => {
  behaviour.main = ['503', '503', 'ok'];
  const r = await generate();
  assert.equal(r.status, 200); assert.equal(r.data.plan.name, 'Library');
  assert.equal(calls.length, 3); assert.ok(calls.every((c) => c.model === 'main'));
});
test('a model that stays overloaded falls back to the next model in AI_FALLBACK_MODELS', async () => {
  process.env.AI_FALLBACK_MODELS = 'second, third';
  behaviour.main = ['503']; behaviour.second = ['ok'];
  const r = await generate();
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map((c) => c.model), ['main', 'main', 'main', 'second']);
});
test('a retired model (404) skips straight to the fallback with no retries', async () => {
  process.env.AI_FALLBACK_MODELS = 'second';
  behaviour.main = ['404']; behaviour.second = ['ok'];
  const r = await generate();
  assert.equal(r.status, 200); assert.deepEqual(calls.map((c) => c.model), ['main', 'second']);
});
test('a rate-limited model (429) also falls back', async () => {
  process.env.AI_FALLBACK_MODELS = 'second';
  behaviour.main = ['429']; behaviour.second = ['ok'];
  assert.equal((await generate()).status, 200); assert.deepEqual(calls.map((c) => c.model), ['main', 'second']);
});
test('a rejected key stops at once: no retries and no fallback models', async () => {
  process.env.AI_FALLBACK_MODELS = 'second';
  behaviour.main = ['403'];
  const r = await generate();
  assert.equal(r.status, 503); assert.match(r.data.message, /rejected the server credentials/); assert.equal(calls.length, 1);
});
test('when every model fails, the message names the last model and what the service said', async () => {
  process.env.AI_FALLBACK_MODELS = 'second';
  behaviour.main = ['404']; behaviour.second = ['404'];
  const r = await generate();
  assert.equal(r.status, 503); assert.equal(r.data.aiUnavailable, true);
  assert.match(r.data.message, /HTTP 404\) for model second: This model models\/second is no longer available/);
});
test('a duplicate of the primary model in AI_FALLBACK_MODELS is not tried twice', async () => {
  process.env.AI_FALLBACK_MODELS = 'main, second';
  behaviour.main = ['404']; behaviour.second = ['ok'];
  await generate(); assert.deepEqual(calls.map((c) => c.model), ['main', 'second']);
});
test('AI_TIMEOUT_MS is honoured: a slow model gives a clear timeout message', async () => {
  process.env.AI_TIMEOUT_MS = '150'; delayMs = 600;
  const r = await generate();
  assert.equal(r.status, 503); assert.match(r.data.message, /timed out/);
});
test('a timeout moves on to the fallback model', async () => {
  process.env.AI_TIMEOUT_MS = '150'; process.env.AI_FALLBACK_MODELS = 'second'; delayMs = 600;
  await generate(); assert.deepEqual(calls.map((c) => c.model), ['main', 'second']);
});
test('the thinking level is sent only when AI_THINKING_LEVEL is set', async () => {
  await generate();
  assert.equal(calls[0].payload.generationConfig.thinkingConfig, undefined);
  process.env.AI_THINKING_LEVEL = 'LOW'; calls = [];
  await generate();
  assert.deepEqual(calls[0].payload.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
});
test('the AI service being unreachable is reported at once (no pointless retries)', async () => {
  process.env.AI_BASE_URL = 'http://localhost:1/v1beta'; process.env.AI_FALLBACK_MODELS = 'second';
  const r = await generate();
  assert.equal(r.status, 503); assert.match(r.data.message, /could not be reached/);
});

test('the AI is asked for a modest number of tasks by default (12), and AI_PLAN_MAX_TASKS changes it', async () => {
  const asked = () => calls.at(-1).payload.systemInstruction.parts[0].text.match(/- 5-(\d+) tasks/)[1];
  await generate(); assert.equal(asked(), '12');
  process.env.AI_PLAN_MAX_TASKS = '20'; await generate(); assert.equal(asked(), '20');
  process.env.AI_PLAN_MAX_TASKS = '2'; await generate(); assert.equal(asked(), '5');      // never below 5
  process.env.AI_PLAN_MAX_TASKS = '999'; await generate(); assert.equal(asked(), '40');   // never above the hard cap
  process.env.AI_PLAN_MAX_TASKS = 'abc'; await generate(); assert.equal(asked(), '12');   // junk falls back
  delete process.env.AI_PLAN_MAX_TASKS;
});
