const express = require('express');
const protect = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { getWeeklyContributions, getDayContributions } = require('../controllers/contributionController');

// Mounted at /api
const router = express.Router();

router.get('/users/:id/contributions', protect, validateObjectId('id'), getWeeklyContributions);
router.get('/users/:id/contributions/day', protect, validateObjectId('id'), getDayContributions);

module.exports = router;