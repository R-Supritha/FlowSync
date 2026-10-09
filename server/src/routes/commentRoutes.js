const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { createComment, listComments, updateComment, deleteComment, toggleReaction } = require('../controllers/commentController');

// Mounted at /api
const router = express.Router();

router.post('/tasks/:taskId/comments', protect, validateObjectId('taskId'), createComment);
router.get('/tasks/:taskId/comments', protect, validateObjectId('taskId'), listComments);

router.put('/comments/:id', protect, validateObjectId('id'), updateComment);
router.delete('/comments/:id', protect, validateObjectId('id'), deleteComment);
router.post('/comments/:id/reactions', protect, validateObjectId('id'), toggleReaction);

module.exports = router;
