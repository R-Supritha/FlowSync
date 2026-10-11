const crypto = require('crypto');

// AES-256-GCM. The key comes from GITHUB_TOKEN_KEY in .env (64 hex characters).
function getKey() {
  const hex = process.env.GITHUB_TOKEN_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('GITHUB_TOKEN_KEY is missing from .env or is not 64 hex characters');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('hex')).join(':');
}

function decrypt(payload) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 3) throw new Error('Stored GitHub token is corrupted; link the repository again');
  try {
    const [iv, tag, encrypted] = parts.map((p) => Buffer.from(p, 'hex'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) {
    if (/GITHUB_TOKEN_KEY/.test(error.message)) throw error;
    throw new Error('Could not decrypt the stored GitHub token (was GITHUB_TOKEN_KEY changed?). Link the repository again');
  }
}

module.exports = { encrypt, decrypt };