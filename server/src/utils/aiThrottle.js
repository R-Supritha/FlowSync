// A small per-user limit for the AI endpoints, so one person cannot burn through the free AI quota
// (and the team's turn) by pressing a button repeatedly. In memory, so it resets when the server restarts.
const WINDOW_MS = 5 * 60 * 1000;
const hits = new Map();

function aiRateLimit(req, res, next) {
  const limit = Number(process.env.AI_RATE_LIMIT) || 10; // requests per 5 minutes per person
  const key = String(req.user && req.user.id);
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    const wait = Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000));
    res.set('Retry-After', String(wait));
    return res.status(429).json({ success: false, message: `Too many AI requests. Please wait ${wait} seconds and try again.` });
  }
  recent.push(now);
  hits.set(key, recent);
  return next();
}

function resetAiThrottle() {
  hits.clear();
}

module.exports = { aiRateLimit, resetAiThrottle };
