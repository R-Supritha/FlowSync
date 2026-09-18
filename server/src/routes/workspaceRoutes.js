const express = require('express');
const protect = require('../middleware/authMiddleware');
const { createWorkspace, getMyWorkspaces } = require('../controllers/workspaceController');

const router = express.Router();

router.post('/', protect, createWorkspace);
router.get('/', protect, getMyWorkspaces);

module.exports = router;