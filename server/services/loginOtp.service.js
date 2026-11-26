const { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const pool = require('../db');
const mailer = require('../utils/mailer');
const { hashToken } = require('../utils/tokenStore');
const { getRefreshCookieOptions } = require('../utils/refreshCookie');
const sessions = require('./deviceSessions.service');
const { isTestLoginAccount, isLocalRequest } = require('../config/testLogin');
const { sessionDeadline } = require('../config/sessionPolicy');

const legacyTrustCookie = () => process.env.NODE_ENV === 'production' ? '__Host-wimTrust' : 'wimTrust';
const trustCookieOptions = () => ({ ...getRefreshCookieOptions(), path: '/' });
function trustCookie(userId) {
  const suffix = createHmac('sha256', process.env.JWT_SECRET).update(`device-trust-cookie:${userId}`)
    .digest('base64url').slice(0, 16);
  return `${legacyTrustCookie()}-${suffix}`;
}
const expired = () => ({ error: 'This sign-in challenge is no longer valid. Return to sign in and try again.', status: 400 });
const codeDigest = (nonce, code) => createHmac('sha256', process.env.LOGIN_OTP_SECRET || process.env.JWT_SECRET)
  .update(`login-otp:${nonce}:${code}`).digest('hex');
function newCode(nonce, excluded = []) {
  let code;
  let digest;
  do {
    code = String(randomInt(1_000_000)).padStart(6, '0');
    digest = codeDigest(nonce, code);
  } while (excluded.includes(digest));
  return { code, digest };
}

function maskedEmail(email) {
  const at = email.lastIndexOf('@');
  return `${email[0]}•••${email.slice(at)}`;
}

function challengeResponse(challenge, email) {
  return { otpRequired: true, challengeId: challenge.id, maskedEmail: maskedEmail(email),
    expiresAt: challenge.expires_at, resendAt: new Date(new Date(challenge.sent_at).getTime() + 60000) };
}

async function deliver({ challenge, code, email, info }) {
  try {
    const result = await mailer.sendMail({ to: email, subject: 'Your e-MMERSION sign-in code',
      text: `Your sign-in code is ${code}. It expires in 5 minutes.\n\nSign-in browser: ${info.browser} on ${info.os}.\n\nIf you did not request this code, do not share it.` });
    if (!result.sent) throw new Error('Mail provider did not send the code');
    return { challenge: challengeResponse(challenge, email) };
  } catch {
    await pool.query('UPDATE login_otp_verifications SET expires_at = now() WHERE id = $1 AND code_hash = $2', [challenge.id, challenge.code_hash]);
    console.error('Sign-in code email could not be sent.');
    return { error: 'Could not send the sign-in code. Wait one minute and try again.', status: 503 };
  }
}

async function startLogin(req, res, verifiedUser) {
  const rememberMe = req.body?.rememberMe === true;
  const token = sessions.browserToken(req) || randomBytes(32).toString('base64url');
  const registration = hashToken(token);
  const info = sessions.deviceInfo(req);
  const scopedTrust = req.cookies?.[trustCookie(verifiedUser.id)];
  const presented = scopedTrust ?? req.cookies?.[legacyTrustCookie()];
  const trustHash = req.cookies?.csrfToken && typeof presented === 'string' && /^[A-Za-z0-9_-]{43}$/.test(presented)
    ? hashToken(presented) : null;
  const testLogin = isLocalRequest(req) && isTestLoginAccount(verifiedUser.email);
  if (testLogin) await sessions.ensureTestLoginSchema();

  const result = await sessions.withAccount(verifiedUser.id, async (db, user) => {
    if (['password', 'role', 'email', 'status'].some((key) => user[key] !== verifiedUser[key])) return expired();
    if (testLogin) {
      await db.query('DELETE FROM login_otp_verifications WHERE user_id = $1', [user.id]);
      return { session: await sessions.createSession(db, user, req, registration,
        { method: 'test', flags: ['test_account_sign_in'], rememberMe }) };
    }
    const { rows: [device] } = await db.query(`SELECT id, info, trust_token_hash, trust_revoked_at, removed_at,
      trust_expires_at, trust_expires_at > now() AS trust_valid, trust_expires_at <= now() AS trust_expired
      FROM account_devices WHERE user_id = $1 AND registration_hash = $2
      ORDER BY (removed_at IS NULL) DESC, last_login_at DESC LIMIT 1`, [user.id, registration]);
    const { rows: [risk] } = await db.query(`SELECT
      EXISTS (SELECT 1 FROM account_devices WHERE user_id = $1) AS previous_device,
      EXISTS (SELECT 1 FROM account_sessions s WHERE s.user_id = $1 AND s.ended_at IS NULL
        AND ${sessionDeadline('$3::text')} > now()) AS active_session,
      EXISTS (SELECT 1 FROM login_attempts WHERE lower(email) = lower($2) AND attempts >= 3
        AND last_attempt > now() - interval '10 minutes') AS recent_failures`, [user.id, user.email, user.role]);
    const known = device && !device.removed_at;
    const changed = known && (device.info.browser !== info.browser || device.info.os !== info.os);
    const trusted = known && trustHash && device.trust_token_hash === trustHash && device.trust_valid;
    const flags = [!risk.previous_device && 'first_login', !known && 'unfamiliar_device',
      device?.trust_expired && 'trust_expired', (device?.trust_revoked_at || device?.removed_at) && 'trust_revoked',
      changed && 'device_profile_changed', risk.recent_failures && 'recent_password_failures',
      risk.active_session && !trusted && 'unfamiliar_session_replacement'].filter(Boolean);
    if (trusted && !changed && !risk.recent_failures) {
      await db.query('DELETE FROM login_otp_verifications WHERE user_id = $1', [user.id]);
      return {
        session: await sessions.createSession(db, user, req, registration, { method: 'trusted', flags, rememberMe }),
        legacyTrustExpiresAt: scopedTrust == null ? device.trust_expires_at : null,
      };
    }

    const { rows: [previous] } = await db.query(`SELECT *, sent_at > now() - interval '60 seconds' AS cooling_down,
      started_at > now() - interval '15 minutes' AS within_limit, expires_at > now() AS valid
      FROM login_otp_verifications WHERE user_id = $1`, [user.id]);
    if (previous && !previous.consumed_at && previous.within_limit && previous.attempts >= 5) {
      return { error: 'Too many code attempts. Wait 15 minutes before starting a new sign-in.', status: 429 };
    }
    if (previous && !previous.consumed_at && previous.cooling_down) {
      if (previous.valid && previous.registration_hash === registration) {
        await db.query('UPDATE login_otp_verifications SET remember_me = $2 WHERE id = $1', [previous.id, rememberMe]);
        return { challenge: challengeResponse(previous, user.email) };
      }
      return { error: 'Please wait one minute before requesting another sign-in code.', status: 429 };
    }
    if (previous && !previous.consumed_at && previous.within_limit && previous.sends >= 3) {
      return { error: 'Too many code requests. Wait 15 minutes before starting a new sign-in.', status: 429 };
    }
    const carryLimit = previous && !previous.consumed_at && previous.within_limit;
    const nonce = carryLimit ? previous.nonce : randomUUID();
    const excluded = carryLimit ? [...previous.previous_code_hashes, previous.code_hash] : [];
    const { code, digest } = newCode(nonce, excluded);
    const { rows: [challenge] } = await db.query(`INSERT INTO login_otp_verifications
      (user_id, id, registration_hash, security_version, nonce, code_hash, flags, attempts, sends, started_at, expires_at, previous_code_hashes, remember_me)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()),now() + interval '5 minutes',$11,$12)
      ON CONFLICT (user_id) DO UPDATE SET id=excluded.id, registration_hash=excluded.registration_hash,
      security_version=excluded.security_version, nonce=excluded.nonce, code_hash=excluded.code_hash, flags=excluded.flags,
      attempts=excluded.attempts, sends=excluded.sends, started_at=excluded.started_at, sent_at=now(), expires_at=excluded.expires_at,
      consumed_at=NULL, previous_code_hashes=excluded.previous_code_hashes, remember_me=excluded.remember_me
      RETURNING id, code_hash, expires_at, sent_at`, [user.id, randomUUID(), registration, user.login_security_version,
      nonce, digest, flags, carryLimit ? previous.attempts : 0, carryLimit ? previous.sends + 1 : 1,
      carryLimit ? previous.started_at : null, excluded, rememberMe]);
    await sessions.recordEvent(db, user.id, known ? device.id : null, 'otp_required', info, { otp: 'pending', trusted: Boolean(trusted), flags });
    return { challenge, code, email: user.email, info };
  });

  if (!result) return expired();
  if (result.session) {
    sessions.sendSessionCookies(res, result.session, token);
    if (result.legacyTrustExpiresAt) {
      res.cookie(trustCookie(verifiedUser.id), presented, { ...trustCookieOptions(), expires: result.legacyTrustExpiresAt });
      res.clearCookie(legacyTrustCookie(), trustCookieOptions());
    }
  }
  else if (result.challenge) sessions.setBrowserCookie(res, token);
  return result.code ? deliver(result) : result;
}

async function withChallenge(req, operation) {
  const id = req.body?.challengeId;
  const token = sessions.browserToken(req);
  if (!sessions.isUuid(id) || !token) return expired();
  const registration = hashToken(token);
  await sessions.ensureLoginSchema();
  const { rows: [owner] } = await pool.query('SELECT user_id FROM login_otp_verifications WHERE id = $1 AND registration_hash = $2', [id, registration]);
  if (!owner) return expired();
  const result = await sessions.withAccount(owner.user_id, async (db, user) => {
    const { rows: [challenge] } = await db.query(`SELECT *, expires_at > now() AS valid,
      started_at > now() - interval '15 minutes' AS within_limit, sent_at > now() - interval '60 seconds' AS cooling_down
      FROM login_otp_verifications WHERE user_id = $1 AND id = $2 AND registration_hash = $3`, [user.id, id, registration]);
    if (!challenge || challenge.security_version !== user.login_security_version) return expired();
    return operation(db, user, challenge, token);
  });
  return result || expired();
}

async function resend(req) {
  const result = await withChallenge(req, async (db, user, existing) => {
    if (existing.consumed_at || !existing.within_limit || existing.attempts >= 5 || existing.sends >= 3) return expired();
    if (existing.cooling_down) return { error: 'Wait 60 seconds between code requests.', status: 429 };
    const excluded = [...existing.previous_code_hashes, existing.code_hash];
    const { code, digest } = newCode(existing.nonce, excluded);
    const { rows: [challenge] } = await db.query(`UPDATE login_otp_verifications SET previous_code_hashes = $2, code_hash = $3,
      sent_at = now(), expires_at = now() + interval '5 minutes', sends = sends + 1
      WHERE id = $1 RETURNING id, code_hash, expires_at, sent_at`, [existing.id, excluded, digest]);
    return { challenge, code, email: user.email, info: sessions.deviceInfo(req) };
  });
  return result.code ? deliver(result) : result;
}

async function verify(req, res, checkAccess) {
  let logged = false;
  const result = await withChallenge(req, async (db, user, challenge, token) => {
    const code = req.body?.code;
    const validCode = typeof code === 'string' && /^\d{6}$/.test(code) &&
      timingSafeEqual(Buffer.from(codeDigest(challenge.nonce, code), 'hex'), Buffer.from(challenge.code_hash, 'hex'));
    const available = challenge.valid && challenge.within_limit && !challenge.consumed_at && challenge.attempts < 5;
    if (!available || !validCode) {
      if (available) await db.query('UPDATE login_otp_verifications SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
      await sessions.recordEvent(db, user.id, null, 'otp_failed', sessions.deviceInfo(req), { otp: 'failed', flags: [...challenge.flags,
        !available ? 'otp_unavailable' : challenge.attempts === 4 ? 'otp_attempt_limit' : 'incorrect_otp'] });
      logged = true;
      return available && challenge.attempts < 4 ? { error: 'The sign-in code is incorrect.', status: 400 } : expired();
    }
    if (user.status === 'pending_activation' && new Date(user.temporary_password_expires_at) <= new Date()) {
      await sessions.recordEvent(db, user.id, null, 'otp_failed', sessions.deviceInfo(req), { otp: 'failed', flags: ['temporary_password_expired'] });
      logged = true;
      return expired();
    }
    const blocked = await checkAccess(user.role, db);
    if (blocked) {
      await sessions.recordEvent(db, user.id, null, 'failed', sessions.deviceInfo(req), { otp: 'verified', flags: ['login_access_restricted'] });
      logged = true;
      return { blocked };
    }
    const trustToken = req.body?.trustDevice === true ? randomBytes(32).toString('base64url') : null;
    await db.query('UPDATE login_otp_verifications SET consumed_at = now() WHERE id = $1', [challenge.id]);
    const session = await sessions.createSession(db, user, req, challenge.registration_hash,
      { method: 'otp', trustHash: trustToken && hashToken(trustToken), flags: challenge.flags, rememberMe: challenge.remember_me });
    return { session, user, token, trustToken };
  });
  if (!result.session && !logged) {
    await sessions.ensureLoginSchema();
    await sessions.recordEvent(pool, null, null, 'otp_failed', sessions.deviceInfo(req), { otp: 'failed', flags: ['otp_unavailable'] });
  }
  if (result.session) {
    sessions.sendSessionCookies(res, result.session, result.token);
    if (result.trustToken) res.cookie(trustCookie(result.user.id), result.trustToken,
      { ...trustCookieOptions(), maxAge: 30 * 86400000 });
  }
  return result;
}

function sendLoginStep(res, result) {
  res.set('Cache-Control', 'no-store');
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.status(202).json(result.challenge);
}

module.exports = { startLogin, resend, verify, sendLoginStep };
