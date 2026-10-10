const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// Stored outside src/, at server/uploads, so it survives alongside the app root.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// Supported types per FR9: PDF, DOCX, PPT, images, ZIP.
const ALLOWED_MIME_EXT = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME_EXT[file.mimetype] || path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_EXT[file.mimetype]) return cb(null, true);
  cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, DOC/DOCX, PPT/PPTX, images, ZIP.`));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

module.exports = { upload, UPLOAD_DIR, MAX_FILE_SIZE, ALLOWED_MIME_EXT };
