const express = require('express');
const protect = require('../middleware/authMiddleware');
const { getMyProfile, updateMyProfile, getUserProfile } = require('../controllers/profileController');
const { receivePicture, uploadAvatar, removeAvatar } = require('../controllers/avatarController');
const { createLimiter } = require('../utils/rateWindow');

// at most 20 picture changes per person per 10 minutes
const pictureLimit = createLimiter({ windowMs: 10 * 60 * 1000, max: 20, message: 'You are changing your picture too often.' });

const router = express.Router();

router.get('/profile', protect, getMyProfile);
router.put('/profile', protect, updateMyProfile);
router.get('/users/:id/profile', protect, getUserProfile);
router.post('/profile/avatar', protect, pictureLimit, receivePicture, uploadAvatar); // FR21
router.delete('/profile/avatar', protect, removeAvatar); // FR21

// for tests
router.resetLimits = () => pictureLimit.reset();

module.exports = router;