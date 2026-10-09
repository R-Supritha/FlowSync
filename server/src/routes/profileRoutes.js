const express = require('express');
const protect = require('../middleware/authMiddleware');
const { getMyProfile, updateMyProfile, getUserProfile } = require('../controllers/profileController');

const router = express.Router();

router.get('/profile', protect, getMyProfile);
router.put('/profile', protect, updateMyProfile);
router.get('/users/:id/profile', protect, getUserProfile);

module.exports = router;