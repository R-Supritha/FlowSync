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

router.post('/projects/:projectId/files', protect, validateObjectId('projectId'), handleUpload, uploadToProject);
router.get('/projects/:projectId/files', protect, validateObjectId('projectId'), listProjectFiles);

router.post('/tasks/:taskId/files', protect, validateObjectId('taskId'), handleUpload, uploadToTask);
router.get('/tasks/:taskId/files', protect, validateObjectId('taskId'), listTaskFiles);

router.post('/comments/:commentId/files', protect, validateObjectId('commentId'), handleUpload, uploadToComment);

router.get('/files/:id', protect, validateObjectId('id'), getFile);
router.get('/files/:id/download', protect, validateObjectId('id'), downloadFile);
router.delete('/files/:id', protect, validateObjectId('id'), deleteFile);

module.exports = router;
