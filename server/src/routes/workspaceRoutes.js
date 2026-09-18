const express = require('express');
const protect = require('../middleware/authMiddleware');
const {
  createWorkspace,
  getMyWorkspaces,
  inviteMember,
  removeMember,
} = require('../controllers/workspaceController');

const router = express.Router();

router.post('/', protect, createWorkspace);
router.get('/', protect, getMyWorkspaces);
router.post('/:id/invite', protect, inviteMember);
router.delete('/:id/members/:userId', protect, removeMember);

module.exports = router;