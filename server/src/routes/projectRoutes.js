const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const {
  listTemplates,
  createProject,
  getWorkspaceProjects,
  getProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  addMilestone,
  updateMilestone,
  deleteMilestone,
} = require('../controllers/projectController');

// Mounted at /api
const router = express.Router();

router.get('/project-templates', protect, listTemplates);

router.post('/workspaces/:workspaceId/projects', protect, validateObjectId('workspaceId'), createProject);
router.get('/workspaces/:workspaceId/projects', protect, validateObjectId('workspaceId'), getWorkspaceProjects);

router.get('/projects/:id', protect, validateObjectId('id'), getProject);
router.put('/projects/:id', protect, validateObjectId('id'), updateProject);
router.delete('/projects/:id', protect, validateObjectId('id'), deleteProject);
router.patch('/projects/:id/archive', protect, validateObjectId('id'), archiveProject);
router.patch('/projects/:id/unarchive', protect, validateObjectId('id'), unarchiveProject);

router.post('/projects/:id/milestones', protect, validateObjectId('id'), addMilestone);
router.put('/projects/:id/milestones/:milestoneId', protect, validateObjectId('id', 'milestoneId'), updateMilestone);
router.delete('/projects/:id/milestones/:milestoneId', protect, validateObjectId('id', 'milestoneId'), deleteMilestone);

module.exports = router;
