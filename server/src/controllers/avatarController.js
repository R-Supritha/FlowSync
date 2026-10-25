const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const User = require('../models/User');
const { AVATAR_DIR, MAX_AVATAR_BYTES, detectImage, removeAvatarFile } = require('../config/avatar');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const reader = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }).single('avatar');

// Runs multer and turns its errors into plain messages.
function receivePicture(req, res, next) {
  reader(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return fail(res, 400, 'The picture must be at most 2 MB');
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return fail(res, 400, 'Send the picture in the "avatar" field');
    return fail(res, 400, 'Could not read the upload');
  });
}

// POST /profile/avatar   (multipart, field "avatar")   PNG, JPEG, GIF or WebP, at most 2 MB
async function uploadAvatar(req, res) {
  let written = null;
  try {
    if (!req.file) return fail(res, 400, 'Choose a picture to upload');
    const kind = detectImage(req.file.buffer);
    if (!kind) return fail(res, 400, 'The file is not a PNG, JPEG, GIF or WebP picture');

    const user = await User.findById(req.user.id).select('avatarUrl');
    if (!user) return fail(res, 404, 'User not found');

    const name = `${req.user.id}-${crypto.randomBytes(8).toString('hex')}.${kind.ext}`;
    written = path.join(AVATAR_DIR, name);
    await fs.promises.writeFile(written, req.file.buffer, { flag: 'wx' });

    const previous = user.avatarUrl;
    user.avatarUrl = `/avatars/${name}`;
    await user.save();
    removeAvatarFile(previous); // the old picture of ours, if there was one
    return res.json({ success: true, user: { avatarUrl: user.avatarUrl } });
  } catch (error) {
    if (written) fs.unlink(written, () => {}); // do not leave a picture nobody points to
    return res.status(500).json({ success: false, message: 'Failed to save the picture', error: error.message });
  }
}

// DELETE /profile/avatar
async function removeAvatar(req, res) {
  try {
    const user = await User.findById(req.user.id).select('avatarUrl');
    if (!user) return fail(res, 404, 'User not found');
    const previous = user.avatarUrl;
    user.avatarUrl = '';
    await user.save();
    removeAvatarFile(previous);
    return res.json({ success: true, user: { avatarUrl: '' } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to remove the picture', error: error.message });
  }
}

module.exports = { receivePicture, uploadAvatar, removeAvatar };
