const crypto = require('crypto');
const { processWithIdempotency, deliveryIdFor } = require('../services/githubKanbanSyncService');

function signatureMatches(rawBody, signature, secret) {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// POST /api/github/webhook
// Mounted with express.raw() BEFORE express.json(), because the HMAC must be checked against
// the exact bytes GitHub sent, not against a re-serialized object.
async function receiveGithubWebhook(req, res) {
  try {
    const secret = String(process.env.GITHUB_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      return res.status(503).json({ success: false, message: 'GitHub webhooks are not configured on this server (set GITHUB_WEBHOOK_SECRET)' });
    }

    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const signature = req.get('x-hub-signature-256') || '';
    if (!signatureMatches(raw, signature, secret)) {
      return res.status(401).json({ success: false, message: 'Invalid GitHub webhook signature' });
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      return res.status(400).json({ success: false, message: 'Webhook body is not valid JSON' });
    }

    const event = String(req.get('x-github-event') || '').trim();
    if (event === 'ping') {
      return res.json({ success: true, message: 'pong' });
    }
    if (!event) {
      return res.status(400).json({ success: false, message: 'Missing X-GitHub-Event header' });
    }

    const deliveryId = deliveryIdFor(req.headers, raw);
    const result = await processWithIdempotency({ event, payload, deliveryId });
    return res.json({ success: true, event, delivery: deliveryId, ...result });
  } catch (error) {
    console.error('GitHub webhook failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to process the GitHub webhook' });
  }
}

module.exports = { receiveGithubWebhook, signatureMatches };
