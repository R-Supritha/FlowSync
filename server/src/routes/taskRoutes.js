const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const {
  createTask,
  getProjectTasks,
  getTask,
  updateTask,
  deleteTask,
  assignTask,
  updateTaskStatus,
  archiveTask,
  unarchiveTask,
} = require('../controllers/taskController');

// Mounted at /api
const router = express.Router();

router.post('/projects/:projectId/tasks', protect, validateObjectId('projectId'), createTask);
router.get('/projects/:projectId/tasks', protect, validateObjectId('projectId'), getProjectTasks);

router.get('/tasks/:id', protect, validateObjectId('id'), getTask);
router.put('/tasks/:id', protect, validateObjectId('id'), updateTask);
router.delete('/tasks/:id', protect, validateObjectId('id'), deleteTask);
router.patch('/tasks/:id/assign', protect, validateObjectId('id'), assignTask);
router.patch('/tasks/:id/status', protect, validateObjectId('id'), updateTaskStatus);
router.patch('/tasks/:id/archive', protect, validateObjectId('id'), archiveTask);
router.patch('/tasks/:id/unarchive', protect, validateObjectId('id'), unarchiveTask);

module.exports = router;
