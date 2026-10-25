const User = require('../models/User');

// FR1: until a person confirms their email, a few sensitive actions are held back
// (creating a workspace, inviting people). Everything else works as normal.
// Accounts created before email verification existed have no "emailVerified" value and count as verified.
// REQUIRE_EMAIL_VERIFICATION=false switches the restriction off.
async function requireVerifiedEmail(req, res, next) {
  try {
    if (String(process.env.REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase() === 'false') return next();
    const user = await User.findById(req.user.id).select('emailVerified');
    if (!user) return res.status(401).json({ success: false, message: 'Account not found' });
    if (user.emailVerified === false) {
      return res.status(403).json({
        success: false,
        emailNotVerified: true,
        message: 'Please verify your email address first. Check your inbox, or use "Resend link" in the banner.',
      });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not check your email status', error: error.message });
  }
}

module.exports = requireVerifiedEmail;
