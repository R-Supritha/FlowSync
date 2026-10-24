const crypto = require('crypto');

// One-time tokens for the links in emails (email verification, password reset).
// The person gets the token; the database keeps only its SHA-256 hash, so a leaked database
// cannot be used to reset anyone's password.
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutes

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function newToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

const isTokenShape = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

module.exports = { newToken, hashToken, isTokenShape, VERIFY_TTL_MS, RESET_TTL_MS };
