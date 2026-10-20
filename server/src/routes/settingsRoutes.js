const express = require('express');
const protect = require('../middleware/authMiddleware');
const { getSettings, updateSettings } = require('../controllers/settingsController');

// Mounted at /api
const router = express.Router();

router.get('/settings', protect, getSettings);
router.put('/settings', protect, updateSettings);

module.exports = router;
