const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { newToken, hashToken, isTokenShape, VERIFY_TTL_MS, RESET_TTL_MS } = require('../utils/authTokens');
const { sendVerificationEmail, sendResetEmail } = require('../utils/mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MAX_NAME = 100;
const GENERIC_RESET_MESSAGE = 'If that email is registered, a reset link has been sent. Check your inbox.';

function generateToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
// emailVerified is unset on accounts that predate verification: those count as verified
const isVerified = (user) => user.emailVerified !== false;
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, role: user.role, emailVerified: isVerified(user), avatarUrl: user.avatarUrl || '' });

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (password.length > MAX_PASSWORD) return `Password can have at most ${MAX_PASSWORD} characters`;
  return null;
}

// Gives the user a fresh verification token and emails the link. Never throws: an email problem must not break signup.
async function issueVerification(user) {
  try {
    const { token, hash } = newToken();
    user.emailVerifyTokenHash = hash;
    user.emailVerifyExpires = new Date(Date.now() + VERIFY_TTL_MS);
    await user.save();
    await sendVerificationEmail(user, token);
    return true;
  } catch (error) {
    console.error('Could not send the verification email:', error.message);
    return false;
  }
}

async function register(req, res) {
  try {
    const { name, password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME) return fail(res, 400, `Name must be 1 to ${MAX_NAME} characters`);
    if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address');
    const weak = passwordProblem(password);
    if (weak) return fail(res, 400, weak);

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name: name.trim(), email, password: hashedPassword, emailVerified: false });
    const sent = await issueVerification(user);

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      token,
      user: publicUser(user),
      verificationEmail: sent ? 'sent' : 'not_sent',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Registration failed', error: error.message });
  }
}

async function login(req, res) {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(String(password), user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  }
}

// POST /auth/forgot-password   body: { email }
// The answer is always the same, so nobody can use this to find out which emails are registered.
async function forgotPassword(req, res) {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address');

    const user = await User.findOne({ email });
    if (user) {
      try {
        const { token, hash } = newToken();
        user.resetTokenHash = hash; // a new request replaces any older link
        user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS);
        await user.save();
        await sendResetEmail(user, token);
      } catch (error) {
        console.error('Could not send the password reset email:', error.message);
      }
    }
    return res.json({ success: true, message: GENERIC_RESET_MESSAGE });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not start the password reset', error: error.message });
  }
}

// POST /auth/reset-password   body: { token, password }
async function resetPassword(req, res) {
  try {
    const { token, password } = req.body || {};
    if (!isTokenShape(token)) return fail(res, 400, 'This reset link is invalid or has expired');
    const weak = passwordProblem(password);
    if (weak) return fail(res, 400, weak);

    const user = await User.findOne({ resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } });
    if (!user) return fail(res, 400, 'This reset link is invalid or has expired');

    user.password = await bcrypt.hash(password, 10);
    user.resetTokenHash = undefined; // one use only
    user.resetTokenExpires = undefined;
    user.emailVerified = true; // they just proved they own this mailbox
    user.emailVerifyTokenHash = undefined;
    user.emailVerifyExpires = undefined;
    await user.save();
    return res.json({ success: true, message: 'Your password was changed. You can sign in now.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not reset the password', error: error.message });
  }
}

// POST /auth/verify-email   body: { token }
async function verifyEmail(req, res) {
  try {
    const { token } = req.body || {};
    if (!isTokenShape(token)) return fail(res, 400, 'This verification link is invalid or has expired');

    const user = await User.findOne({ emailVerifyTokenHash: hashToken(token), emailVerifyExpires: { $gt: new Date() } });
    if (!user) return fail(res, 400, 'This verification link is invalid or has expired');

    user.emailVerified = true;
    user.emailVerifyTokenHash = undefined;
    user.emailVerifyExpires = undefined;
    await user.save();
    return res.json({ success: true, message: 'Your email address is confirmed.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not verify the email', error: error.message });
  }
}

// POST /auth/resend-verification   (signed in)
async function resendVerification(req, res) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return fail(res, 404, 'Account not found');
    if (isVerified(user)) return res.json({ success: true, alreadyVerified: true, message: 'Your email is already confirmed.' });

    const sent = await issueVerification(user);
    if (!sent) return fail(res, 502, 'We could not send the email right now. Please try again in a few minutes.');
    return res.json({ success: true, message: 'A new confirmation link was sent. Check your inbox.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not resend the email', error: error.message });
  }
}

module.exports = { register, login, forgotPassword, resetPassword, verifyEmail, resendVerification };
