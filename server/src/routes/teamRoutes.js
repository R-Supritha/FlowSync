const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const {
  createTeam,
  getWorkspaceTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  assignTeamToProject,
  unassignTeamFromProject,
  getProjectTeams,
} = require('../controllers/teamController');

// Mounted at /api
const router = express.Router();

router.post('/workspaces/:workspaceId/teams', protect, validateObjectId('workspaceId'), createTeam);
router.get('/workspaces/:workspaceId/teams', protect, validateObjectId('workspaceId'), getWorkspaceTeams);

router.get('/teams/:id', protect, validateObjectId('id'), getTeam);
router.put('/teams/:id', protect, validateObjectId('id'), updateTeam);
router.delete('/teams/:id', protect, validateObjectId('id'), deleteTeam);

router.post('/teams/:id/members', protect, validateObjectId('id'), addTeamMember);
router.put('/teams/:id/members/:userId', protect, validateObjectId('id'), updateTeamMemberRole);
router.delete('/teams/:id/members/:userId', protect, validateObjectId('id'), removeTeamMember);

router.post('/teams/:id/projects/:projectId', protect, validateObjectId('id', 'projectId'), assignTeamToProject);
router.delete('/teams/:id/projects/:projectId', protect, validateObjectId('id', 'projectId'), unassignTeamFromProject);
router.get('/projects/:projectId/teams', protect, validateObjectId('projectId'), getProjectTeams);

module.exports = router;
