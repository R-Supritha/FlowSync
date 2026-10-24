// FR1: email verification and password reset. No database, no internet, no real email:
// the user model is an in-memory stand-in and the mail transport is a recorder.
// Run:  node --test --test-force-exit "verification/*.test.js"
process.env.JWT_SECRET = 'test-secret';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------- in-memory User model
const stub = (rel, exports) => { const p = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const db = { users: [], n: 0 };
const oid = () => { db.n += 1; return `64f${String(db.n).padStart(21, '0')}`; };
const matches = (u, q) => Object.entries(q).every(([k, v]) => {
  if (v && typeof v === 'object' && v.$gt !== undefined) return u[k] !== undefined && new Date(u[k]) > new Date(v.$gt);
  return u[k] === v;
});
const wrap = (doc) => { Object.defineProperty(doc, 'save', { enumerable: false, value: async () => {} }); return doc; };
stub('models/User.js', {
  findOne: async (q) => db.users.find((u) => matches(u, q)) || null,
  findById: (id) => { const u = db.users.find((x) => x._id === String(id)) || null; return { select: async () => u, then: (res, rej) => Promise.resolve(u).then(res, rej) }; },
  create: async (doc) => { const u = wrap({ _id: oid(), role: 'Member', ...doc }); db.users.push(u); return u; },
});

const mailer = require('../src/utils/mailer');
const authRouter = require('../src/routes/authRoutes');
const requireVerifiedEmail = require('../src/middleware/requireVerifiedEmail');
const protect = require('../src/middleware/authMiddleware');
const { newToken, hashToken, isTokenShape } = require('../src/utils/authTokens');

let sent = []; let failMail = false;
const transport = { sendMail: async (m) => { if (failMail) throw new Error('SMTP down'); sent.push(m); } };
const tokenIn = (mail) => (mail.text.match(/token=([a-f0-9]{64})/) || [])[1];
const linkIn = (mail) => (mail.text.match(/https?:\/\/\S+/) || [])[0];

let base; let server;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api/auth', authRouter);
  app.post('/api/guarded', protect, requireVerifiedEmail, (req, res) => res.json({ ok: true }));
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());
beforeEach(() => {
  db.users = []; db.n = 0; sent = []; failMail = false; authRouter.resetLimits();
  mailer.setTransportForTests(transport);
  process.env.APP_URL = 'http://localhost:5173'; delete process.env.REQUIRE_EMAIL_VERIFICATION; delete process.env.SMTP_HOST;
});
const call = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};
const register = (over = {}) => call('POST', '/auth/register', { name: 'Raj', email: 'Raj@Example.com', password: 'longenough1', ...over });
const auth = (jwtToken) => ({ Authorization: `Bearer ${jwtToken}` });

// ================================================================ tokens
test('tokens: 64 hex characters, only the SHA-256 hash is meant to be stored', () => {
  const { token, hash } = newToken();
  assert.match(token, /^[a-f0-9]{64}$/); assert.notEqual(hash, token);
  assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex')); assert.equal(hashToken(token), hash);
  assert.notEqual(newToken().token, token);
  for (const bad of ['', 'abc', 'g'.repeat(64), 'A'.repeat(64), 'a'.repeat(63), 123, null, undefined, {}]) assert.equal(isTokenShape(bad), false, String(bad));
  assert.equal(isTokenShape(token), true);
});

// ================================================================ registration
test('register: the account starts unverified, the password is hashed, and a confirmation link is emailed', async () => {
  const r = await register();
  assert.equal(r.status, 201); assert.equal(r.data.user.emailVerified, false); assert.equal(r.data.verificationEmail, 'sent'); assert.ok(r.data.token);
  const u = db.users[0];
  assert.equal(u.email, 'raj@example.com'); assert.notEqual(u.password, 'longenough1'); assert.ok(await bcrypt.compare('longenough1', u.password));
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'raj@example.com');
  const token = tokenIn(sent[0]);
  assert.equal(linkIn(sent[0]), `http://localhost:5173/verify-email?token=${token}`);
  assert.equal(u.emailVerifyTokenHash, hashToken(token));                       // the database has the hash...
  assert.ok(!JSON.stringify(u).includes(token));                                // ...never the token itself
  assert.ok(new Date(u.emailVerifyExpires) > new Date(Date.now() + 23 * 3600 * 1000));
  assert.ok(!JSON.stringify(r.data).includes(token));                           // and the API never returns it
});
test('register: refuses bad input, and duplicate emails whatever the capital letters', async () => {
  for (const body of [{ name: '' }, { email: '' }, { password: '' }, { email: 'not-an-email' }, { password: 'short' }, { password: 'x'.repeat(129) }, { name: 'x'.repeat(101) }, { name: 42 }]) {
    assert.equal((await register(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(db.users.length, 0);
  assert.equal((await register()).status, 201);
  assert.equal((await register({ email: 'raj@EXAMPLE.com' })).status, 409);
});
test('register: if the email cannot be sent, the account is still created and the answer says so', async () => {
  failMail = true;
  const r = await register();
  assert.equal(r.status, 201); assert.equal(r.data.verificationEmail, 'not_sent'); assert.equal(db.users.length, 1);
});

// ================================================================ verifying the email
test('verify-email: the link confirms the address once; reusing, wrong, malformed and expired links are refused', async () => {
  await register(); const token = tokenIn(sent[0]);
  for (const bad of [{}, { token: 'abc' }, { token: 5 }, { token: 'a'.repeat(64) }]) assert.equal((await call('POST', '/auth/verify-email', bad)).status, 400, JSON.stringify(bad));
  assert.equal(db.users[0].emailVerified, false);
  const ok = await call('POST', '/auth/verify-email', { token });
  assert.equal(ok.status, 200); assert.equal(db.users[0].emailVerified, true);
  assert.equal(db.users[0].emailVerifyTokenHash, undefined); assert.equal(db.users[0].emailVerifyExpires, undefined);
  assert.equal((await call('POST', '/auth/verify-email', { token })).status, 400);                // one use only
  await register({ email: 'late@example.com' }); const late = tokenIn(sent[1]);
  db.users[1].emailVerifyExpires = new Date(Date.now() - 1000);
  const expired = await call('POST', '/auth/verify-email', { token: late });
  assert.equal(expired.status, 400); assert.match(expired.data.message, /invalid or has expired/); assert.equal(db.users[1].emailVerified, false);
});
test('resend-verification: needs a login, replaces the old link, and is limited to 3 per 15 minutes', async () => {
  const reg = await register(); const jwtToken = reg.data.token; const first = tokenIn(sent[0]);
  assert.equal((await call('POST', '/auth/resend-verification')).status, 401);
  const again = await call('POST', '/auth/resend-verification', undefined, auth(jwtToken));
  assert.equal(again.status, 200); assert.equal(sent.length, 2);
  const second = tokenIn(sent[1]); assert.notEqual(second, first);
  assert.equal((await call('POST', '/auth/verify-email', { token: first })).status, 400);         // the old link stopped working
  assert.equal((await call('POST', '/auth/verify-email', { token: second })).status, 200);
  const done = await call('POST', '/auth/resend-verification', undefined, auth(jwtToken));
  assert.equal(done.data.alreadyVerified, true); assert.equal(sent.length, 2);                    // nothing to send once verified
});
test('resend-verification: a mail failure is reported (502), and the third+ request in 15 minutes is a 429', async () => {
  const jwtToken = (await register()).data.token;
  failMail = true;
  assert.equal((await call('POST', '/auth/resend-verification', undefined, auth(jwtToken))).status, 502);
  failMail = false;
  assert.equal((await call('POST', '/auth/resend-verification', undefined, auth(jwtToken))).status, 200);
  assert.equal((await call('POST', '/auth/resend-verification', undefined, auth(jwtToken))).status, 200);
  const r = await call('POST', '/auth/resend-verification', undefined, auth(jwtToken));
  assert.equal(r.status, 429); assert.match(r.data.message, /Too many emails requested/);
});

// ================================================================ forgot / reset password
test('forgot-password: the same answer for known and unknown emails (nobody can list who is registered), and only known ones get mail', async () => {
  await register(); sent = [];
  const known = await call('POST', '/auth/forgot-password', { email: 'RAJ@example.com' });
  const unknown = await call('POST', '/auth/forgot-password', { email: 'nobody@example.com' });
  assert.equal(known.status, 200); assert.deepEqual(known.data, unknown.data); assert.match(known.data.message, /If that email is registered/);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'raj@example.com');
  for (const bad of [{}, { email: '' }, { email: 'nope' }, { email: 7 }]) assert.equal((await call('POST', '/auth/forgot-password', bad)).status, 400, JSON.stringify(bad));
});
test('forgot-password: the link is emailed, only its hash is stored, it expires in an hour, and a newer request replaces the older link', async () => {
  await register(); sent = [];
  await call('POST', '/auth/forgot-password', { email: 'raj@example.com' });
  const one = tokenIn(sent[0]); const u = db.users[0];
  assert.equal(linkIn(sent[0]), `http://localhost:5173/reset-password?token=${one}`);
  assert.equal(u.resetTokenHash, hashToken(one)); assert.ok(!JSON.stringify(u).includes(one));
  const ttl = new Date(u.resetTokenExpires).getTime() - Date.now(); assert.ok(ttl > 59 * 60 * 1000 && ttl <= 60 * 60 * 1000);
  await call('POST', '/auth/forgot-password', { email: 'raj@example.com' });
  const two = tokenIn(sent[1]); assert.notEqual(one, two);
  assert.equal((await call('POST', '/auth/reset-password', { token: one, password: 'brandnewpass1' })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { token: two, password: 'brandnewpass1' })).status, 200);
});
test('forgot-password: a mail failure never shows up in the answer (and gives away nothing)', async () => {
  await register(); failMail = true;
  const r = await call('POST', '/auth/forgot-password', { email: 'raj@example.com' });
  assert.equal(r.status, 200); assert.match(r.data.message, /If that email is registered/);
});
test('SECURITY: the reset link always uses APP_URL, never the Origin or Host of the request (no reset-link poisoning)', async () => {
  await register(); sent = []; process.env.APP_URL = 'https://app.example.org/';
  await call('POST', '/auth/forgot-password', { email: 'raj@example.com' }, { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', Referer: 'https://evil.example/x' });
  const link = linkIn(sent[0]);
  assert.match(link, /^https:\/\/app\.example\.org\/reset-password\?token=[a-f0-9]{64}$/); assert.ok(!sent[0].text.includes('evil'));
});
test('reset-password: sets the new password once, confirms the email, and the old password stops working', async () => {
  await register(); sent = [];
  await call('POST', '/auth/forgot-password', { email: 'raj@example.com' }); const token = tokenIn(sent[0]);
  const ok = await call('POST', '/auth/reset-password', { token, password: 'brandnewpass1' });
  assert.equal(ok.status, 200); const u = db.users[0];
  assert.ok(await bcrypt.compare('brandnewpass1', u.password)); assert.equal(await bcrypt.compare('longenough1', u.password), false);
  assert.equal(u.resetTokenHash, undefined); assert.equal(u.resetTokenExpires, undefined); assert.equal(u.emailVerified, true);
  assert.equal((await call('POST', '/auth/reset-password', { token, password: 'anotherpass12' })).status, 400);      // one use only
  assert.equal((await call('POST', '/auth/login', { email: 'raj@example.com', password: 'brandnewpass1' })).status, 200);
  assert.equal((await call('POST', '/auth/login', { email: 'raj@example.com', password: 'longenough1' })).status, 401);
});
test('reset-password: weak passwords, wrong, malformed and expired links are refused; a weak password does not use up the link', async () => {
  await register(); sent = [];
  await call('POST', '/auth/forgot-password', { email: 'raj@example.com' }); const token = tokenIn(sent[0]);
  for (const password of ['', 'short', 'x'.repeat(129), 7, undefined]) assert.equal((await call('POST', '/auth/reset-password', { token, password })).status, 400, String(password));
  assert.equal((await call('POST', '/auth/reset-password', { token: 'a'.repeat(64), password: 'brandnewpass1' })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { token: 'xyz', password: 'brandnewpass1' })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { password: 'brandnewpass1' })).status, 400);
  assert.ok(await bcrypt.compare('longenough1', db.users[0].password));                                              // nothing changed yet
  authRouter.resetLimits();                                                                                          // this test makes more than 10 requests on purpose
  db.users[0].resetTokenExpires = new Date(Date.now() - 1000);
  const expired = await call('POST', '/auth/reset-password', { token, password: 'brandnewpass1' });
  assert.equal(expired.status, 400); assert.match(expired.data.message, /invalid or has expired/);
  db.users[0].resetTokenExpires = new Date(Date.now() + 60000);
  assert.equal((await call('POST', '/auth/reset-password', { token, password: 'brandnewpass1' })).status, 200);       // the link was still good
});
test('the email endpoints are limited: the 11th request in 15 minutes from one computer gets a 429', async () => {
  for (let i = 0; i < 10; i += 1) assert.equal((await call('POST', '/auth/forgot-password', { email: 'x@example.com' })).status, 200);
  const r = await call('POST', '/auth/forgot-password', { email: 'x@example.com' });
  assert.equal(r.status, 429); assert.match(r.data.message, /Too many attempts/);
  assert.equal((await call('POST', '/auth/reset-password', { token: 'a'.repeat(64), password: 'longenough1' })).status, 429);   // they share one limit
});

// ================================================================ login
test('login: reports whether the email is verified; older accounts (no value stored) count as verified; email case does not matter', async () => {
  await register();
  const fresh = await call('POST', '/auth/login', { email: 'RAJ@example.com', password: 'longenough1' });
  assert.equal(fresh.status, 200); assert.equal(fresh.data.user.emailVerified, false);
  db.users.push(wrap({ _id: oid(), name: 'Old', email: 'old@example.com', role: 'Admin', password: await bcrypt.hash('oldpassword1', 10) }));   // no emailVerified field at all
  const old = await call('POST', '/auth/login', { email: 'old@example.com', password: 'oldpassword1' });
  assert.equal(old.data.user.emailVerified, true);
  assert.equal((await call('POST', '/auth/login', { email: 'old@example.com', password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'ghost@example.com', password: 'x' })).status, 401);
  assert.equal((await call('POST', '/auth/login', {})).status, 400);
  assert.ok(!('password' in fresh.data.user));
});

// ================================================================ the restriction
test('unverified people cannot do the held-back actions; verified and older accounts can; the switch turns it off', async () => {
  const reg = await register(); const unverifiedJwt = reg.data.token;
  const older = wrap({ _id: oid(), name: 'Old', email: 'old@example.com', role: 'Admin', password: 'x' }); db.users.push(older);
  const olderJwt = jwt.sign({ id: older._id, role: 'Admin' }, process.env.JWT_SECRET);
  const blocked = await call('POST', '/guarded', {}, auth(unverifiedJwt));
  assert.equal(blocked.status, 403); assert.equal(blocked.data.emailNotVerified, true); assert.match(blocked.data.message, /verify your email/);
  assert.equal((await call('POST', '/guarded', {}, auth(olderJwt))).status, 200);
  process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
  assert.equal((await call('POST', '/guarded', {}, auth(unverifiedJwt))).status, 200);
  delete process.env.REQUIRE_EMAIL_VERIFICATION;
  await call('POST', '/auth/verify-email', { token: tokenIn(sent[0]) });
  assert.equal((await call('POST', '/guarded', {}, auth(unverifiedJwt))).status, 200);                                   // verified now
  const ghost = jwt.sign({ id: oid(), role: 'Member' }, process.env.JWT_SECRET);
  assert.equal((await call('POST', '/guarded', {}, auth(ghost))).status, 401);
  assert.equal((await call('POST', '/guarded', {})).status, 401);
});

// ================================================================ the mailer
test('mailer: console mode prints the email in the server window; SMTP mode hands it to the transport', async () => {
  mailer.setTransportForTests(null); delete process.env.SMTP_HOST;
  const logged = []; const orig = console.log; console.log = (...a) => logged.push(a.join(' '));
  let r; try { r = await mailer.sendMail({ to: 'a@b.co', subject: 'Hello', text: 'the link is here' }); } finally { console.log = orig; }
  assert.equal(r.mode, 'console'); assert.match(logged.join('\n'), /To: a@b\.co[\s\S]*Subject: Hello[\s\S]*the link is here/);
  mailer.setTransportForTests(transport); process.env.MAIL_FROM = 'FlowSync <me@x.org>';
  assert.equal((await mailer.sendMail({ to: 'a@b.co', subject: 'S', text: 'T' })).mode, 'smtp');
  assert.deepEqual(sent.at(-1), { from: 'FlowSync <me@x.org>', to: 'a@b.co', subject: 'S', text: 'T' });
  process.env.APP_URL = 'https://x.org///'; assert.equal(mailer.resetLink('t'), 'https://x.org/reset-password?token=t'); assert.equal(mailer.verifyLink('t'), 'https://x.org/verify-email?token=t');
  delete process.env.MAIL_FROM;
});
