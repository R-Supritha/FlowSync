// Times the real AI plan generation with your .env key, for several free models, one after another.
// Run from the server folder:   node tools/ai-benchmark.js
// Stop it with Ctrl+C as soon as one line says OK and is fast enough (under about 60 s).
// It prints no secrets. It is not part of the app.
require('dotenv').config({ quiet: true });
const { generateProjectPlan } = require('../src/services/aiService');

const TEXT =
  'Build a library management system where students can search books, borrow up to three at a time and renew online, ' +
  'and librarians add new books and track overdue returns with email reminders.';

const combos = [
  { model: 'gemini-3.5-flash-lite', level: 'low' },
  { model: 'gemini-3.5-flash', level: 'low' },
  { model: 'gemini-3.5-flash-lite', level: '' },
  { model: 'gemini-3.8-flash', level: 'low' },
  { model: 'gemini-2.5-flash-lite', level: '' },
];

(async () => {
  delete process.env.AI_FALLBACK_MODELS; // measure each model on its own
  process.env.AI_TIMEOUT_MS = process.env.BENCH_TIMEOUT_MS || '90000';
  console.log(`Asking for a plan (up to ${process.env.AI_PLAN_MAX_TASKS || 12} tasks). Each try waits at most ${Number(process.env.AI_TIMEOUT_MS) / 1000} s.\n`);
  for (const c of combos) {
    process.env.AI_MODEL = c.model;
    if (c.level) process.env.AI_THINKING_LEVEL = c.level;
    else delete process.env.AI_THINKING_LEVEL;
    const label = `${c.model} (thinking: ${c.level || 'default'})`.padEnd(46);
    const t0 = Date.now();
    try {
      const { plan } = await generateProjectPlan(TEXT);
      console.log(`${label} OK     ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s   ${plan.tasks.length} tasks   "${plan.name}"`);
    } catch (e) {
      console.log(`${label} FAILED ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s   ${String(e.message).slice(0, 150)}`);
    }
  }
  console.log('\nDone. Use the fastest OK model: set AI_MODEL (and AI_THINKING_LEVEL if it helped) in server\\.env, then restart the API.');
  process.exit(0);
})();
