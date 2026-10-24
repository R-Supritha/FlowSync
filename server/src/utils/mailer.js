// Sends the emails FlowSync needs (verify your email, reset your password).
//   - With SMTP_HOST set, mail goes out through that SMTP server (any provider; a Gmail app password is free).
//   - Without it ("console mode") the email is printed in the server window instead, so everything can be
//     demonstrated with no email service at all.
// Links in emails always use APP_URL, never anything taken from the request (that would allow reset-link poisoning).
let transport = null;
let injected = null;

const appUrl = () => String(process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');

function getTransport() {
  if (injected) return injected;
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

// Returns { mode: 'smtp' | 'console' }. Throws if the SMTP server refuses the mail; callers catch and log.
async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (!t) {
    console.log(`\n[mail - console mode] To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { mode: 'console' };
  }
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER || 'FlowSync <no-reply@flowsync.local>', to, subject, text });
  return { mode: 'smtp' };
}

const verifyLink = (token) => `${appUrl()}/verify-email?token=${token}`;
const resetLink = (token) => `${appUrl()}/reset-password?token=${token}`;

function sendVerificationEmail(user, token) {
  return sendMail({
    to: user.email,
    subject: 'Confirm your email for FlowSync',
    text: `Hi ${user.name},\n\nPlease confirm your email address for FlowSync:\n\n${verifyLink(token)}\n\nThis link works for 24 hours. If you did not create an account, you can ignore this email.\n`,
  });
}

function sendResetEmail(user, token) {
  return sendMail({
    to: user.email,
    subject: 'Reset your FlowSync password',
    text: `Hi ${user.name},\n\nSomeone asked to reset the password for this FlowSync account. To choose a new password, open:\n\n${resetLink(token)}\n\nThis link works for 60 minutes and can be used once. If it was not you, ignore this email and your password stays the same.\n`,
  });
}

// for tests
const setTransportForTests = (t) => { injected = t; transport = null; };

module.exports = { sendMail, sendVerificationEmail, sendResetEmail, verifyLink, resetLink, appUrl, setTransportForTests };
