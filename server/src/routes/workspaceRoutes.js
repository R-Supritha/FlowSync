const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const {
  createWorkspace,
  getMyWorkspaces,
  inviteMember,
  removeMember,
  updateWorkspace,
  updateMemberRole,
  deleteWorkspace,
} = require('../controllers/workspaceController');

const router = express.Router();

router.post('/', protect, requireVerifiedEmail, createWorkspace);
router.get('/', protect, getMyWorkspaces);
router.patch('/:id', protect, validateObjectId('id'), updateWorkspace); // FR2 workspace settings
router.delete('/:id', protect, validateObjectId('id'), deleteWorkspace); // FR2
router.post('/:id/invite', protect, validateObjectId('id'), requireVerifiedEmail, inviteMember);
router.patch('/:id/members/:userId', protect, validateObjectId('id', 'userId'), updateMemberRole); // FR2 change role
router.delete('/:id/members/:userId', protect, validateObjectId('id', 'userId'), removeMember);

module.exports = router;
