const fs = require('fs');
const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { upload } = require('../config/upload');
const multer = require('multer');
const {
  uploadToProject,
  uploadToTask,
  uploadToComment,
  listProjectFiles,
  listTaskFiles,
  getFile,
  downloadFile,
  deleteFile,
} = require('../controllers/fileController');

// Mounted at /api
const router = express.Router();

// Turns multer's errors (bad type, too large) into the same JSON error shape as the rest of the API.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 20MB)' : err.message;
      return res.status(400).json({ success: false, message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}

// multer saves the file BEFORE the controller decides whether the upload is allowed (right role, room left...).
// When the answer is an error, the file must not stay behind on the disk.
function discardOnError(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode >= 400 && req.file && req.file.path) fs.unlink(req.file.path, () => {});
  });
  next();
}

router.post('/projects/:projectId/files', protect, validateObjectId('projectId'), handleUpload, discardOnError, uploadToProject);
router.get('/projects/:projectId/files', protect, validateObjectId('projectId'), listProjectFiles);

router.post('/tasks/:taskId/files', protect, validateObjectId('taskId'), handleUpload, discardOnError, uploadToTask);
router.get('/tasks/:taskId/files', protect, validateObjectId('taskId'), listTaskFiles);

router.post('/comments/:commentId/files', protect, validateObjectId('commentId'), handleUpload, discardOnError, uploadToComment);

router.get('/files/:id', protect, validateObjectId('id'), getFile);
router.get('/files/:id/download', protect, validateObjectId('id'), downloadFile);
router.delete('/files/:id', protect, validateObjectId('id'), deleteFile);

module.exports = router;
