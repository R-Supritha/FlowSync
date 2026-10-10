const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { getBoard, updateColumns, reorderColumn } = require('../controllers/kanbanController');

// Mounted at /api
const router = express.Router();

router.get('/projects/:projectId/board', protect, validateObjectId('projectId'), getBoard);
router.put('/projects/:projectId/columns', protect, validateObjectId('projectId'), updateColumns);
router.patch('/projects/:projectId/board/reorder', protect, validateObjectId('projectId'), reorderColumn);

module.exports = router;
