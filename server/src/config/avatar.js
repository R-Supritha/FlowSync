const path = require('path');
const fs = require('fs');
const express = require('express');
const { UPLOAD_DIR } = require('./upload');

// Profile pictures (FR21) live in their own folder, apart from task files, and are served at /avatars.
const AVATAR_DIR = process.env.AVATAR_DIR || path.join(UPLOAD_DIR, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

// What a picture really is is decided by the first bytes of the file, never by its name or the type the
// browser claims. SVG is not accepted at all: it can carry scripts.
function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg' };
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('latin1'))) return { ext: 'gif' };
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp' };
  return null;
}

// "/avatars/<name>" is one of OUR files: returns its path on disk, or null for anything else
// (an outside link, an empty value, or an attempt to point outside the avatar folder).
function avatarFileOf(url) {
  const m = /^\/avatars\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(String(url || ''));
  if (!m) return null;
  const file = path.join(AVATAR_DIR, m[1]);
  return path.dirname(file) === AVATAR_DIR ? file : null;
}

function removeAvatarFile(url) {
  const file = avatarFileOf(url);
  if (file) fs.unlink(file, () => {}); // best effort
}

// helmet sends "same-origin" for resources, which would stop the app (another port) from showing a picture
// served by the API. Pictures are meant to be shown, so this folder says "cross-origin".
function mountAvatars(app) {
  app.use(
    '/avatars',
    (req, res, next) => {
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static(AVATAR_DIR, { index: false, dotfiles: 'deny', maxAge: '1h' })
  );
}

module.exports = { AVATAR_DIR, MAX_AVATAR_BYTES, detectImage, avatarFileOf, removeAvatarFile, mountAvatars };
