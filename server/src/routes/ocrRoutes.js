const express = require('express');
const multer = require('multer');
const protect = require('../middleware/authMiddleware');
const { extractDocumentText } = require('../controllers/ocrController');

// Mounted at /api
const router = express.Router();

const MAX_OCR_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

const OCR_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

// Memory storage: uploads are processed and discarded, never written to disk.
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_OCR_FILE_SIZE, files: 1 },
  fileFilter(req, file, cb) {
    if (OCR_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, DOCX, PPTX, PNG, JPEG.'));
  },
});

// Turns multer errors into the same JSON error shape as the rest of the API.
function handleOcrUpload(req, res, next) {
  ocrUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 15MB)' : err.message;
      return res.status(400).json({ success: false, message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}

router.post('/ocr/extract', protect, handleOcrUpload, extractDocumentText);

module.exports = router;
