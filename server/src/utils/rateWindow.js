// A small per-person limit: at most `max` requests in any `windowMs`. In memory, so it resets when the
// server restarts. Used to stop one person flooding a channel.
function createLimiter({ windowMs, max, message, key: keyOf }) {
  const hits = new Map();
  const middleware = (req, res, next) => {
    const key = keyOf ? String(keyOf(req)) : String(req.user && req.user.id);
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const wait = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.set('Retry-After', String(wait));
      return res.status(429).json({ success: false, message: `${message} Please wait ${wait} seconds.` });
    }
    recent.push(now);
    hits.set(key, recent);
    return next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = { createLimiter };
