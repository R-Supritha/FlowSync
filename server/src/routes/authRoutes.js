const express = require('express');
const protect = require('../middleware/authMiddleware');
const { createLimiter } = require('../utils/rateWindow');
const {
  register, login, forgotPassword, resetPassword, verifyEmail, resendVerification,
} = require('../controllers/authController');

const router = express.Router();

// Per computer: the email and reset endpoints can be abused to spam inboxes or to guess tokens.
const byIp = (req) => req.ip;
const emailLimit = createLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts.', key: byIp });
const resendLimit = createLimiter({ windowMs: 15 * 60 * 1000, max: 3, message: 'Too many emails requested.' });

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', emailLimit, forgotPassword); // FR1
router.post('/reset-password', emailLimit, resetPassword); // FR1
router.post('/verify-email', emailLimit, verifyEmail); // FR1
router.post('/resend-verification', protect, resendLimit, resendVerification); // FR1

// for tests
router.resetLimits = () => { emailLimit.reset(); resendLimit.reset(); };

module.exports = router;
