const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const {
  linkRepository,
  getLink,
  unlinkRepository,
  syncRepository,
  listTaskRefs,
} = require('../controllers/githubController');

// Mounted at /api
const router = express.Router();

router.post('/projects/:projectId/github', protect, validateObjectId('projectId'), linkRepository);
router.get('/projects/:projectId/github', protect, validateObjectId('projectId'), getLink);
router.delete('/projects/:projectId/github', protect, validateObjectId('projectId'), unlinkRepository);
router.post('/projects/:projectId/github/sync', protect, validateObjectId('projectId'), syncRepository);
router.get('/projects/:projectId/github/task-refs', protect, validateObjectId('projectId'), listTaskRefs);

module.exports = router;
