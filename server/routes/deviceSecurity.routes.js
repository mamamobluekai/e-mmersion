const express = require('express');
const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const pool = require('../db');
const mailer = require('../utils/mailer');
const { hashToken } = require('../utils/tokenStore');
const { writeLimiter } = require('../middleware/rateLimiters');
const { sessionDeadline } = require('../config/sessionPolicy');
const { ensureLoginSchema, withAccount, endSessions, disconnectSessions, browserToken, isUuid, revokeDeviceTrust } = require('../services/deviceSessions.service');

const router = express.Router();
const pageSize = 25;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function endpoint(operation) {
  return async (req, res) => {
    try {
      if (!req.user.sid || !req.user.deviceId) fail(401, 'Sign in again to manage your devices.');
      await ensureLoginSchema();
      res.set('Cache-Control', 'private, no-store');
      res.json(await operation(req));
    } catch (error) {
      if (!error.status) console.error('Account device security:', error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not complete the account security request.' });
    }
  };
}

async function currentDevice(db, user, registration = null) {
  const { rows: [device] } = await db.query(`SELECT d.id, d.verified_at, d.registration_hash
    FROM account_sessions s JOIN account_devices d ON d.id = s.device_id
    WHERE s.id = $1 AND s.user_id = $2 AND s.ended_at IS NULL AND ${sessionDeadline('$3::text')} > now()
      AND d.removed_at IS NULL`, [user.sid, user.id, user.role]);
  if (!device || (registration && device.registration_hash !== registration)) fail(401, 'Sign in again from this browser to verify your device.');
  return device;
}

router.get('/devices', endpoint(async ({ user }) => {
  const [devices, settings] = await Promise.all([
    pool.query(`SELECT d.id, d.info, d.last_login_at, d.verified_at, d.removed_at, d.id = $2::uuid AS is_current,
      d.created_at, d.trusted_at, d.trust_expires_at, d.trust_last_used_at,
      coalesce(d.trust_token_hash IS NOT NULL AND d.trust_expires_at > now() AND d.removed_at IS NULL, false) AS trusted,
      max(s.last_active_at) AS last_active_at,
      coalesce(bool_or(s.ended_at IS NULL AND ${sessionDeadline('$3::text')} > now()), false) AS active
      FROM account_devices d LEFT JOIN account_sessions s ON d.id = s.device_id
      WHERE d.user_id = $1 GROUP BY d.id ORDER BY is_current DESC, d.last_login_at DESC`, [user.id, user.deviceId, user.role]),
    pool.query('SELECT new_login_email_alerts FROM users WHERE id = $1', [user.id]),
  ]);
  return { devices: devices.rows, emailAlerts: settings.rows[0].new_login_email_alerts };
}));

router.get('/activity', endpoint(async ({ user, query }) => {
  const { device = null, date = null, before = null } = query;
  if ((device !== null && device !== 'unknown' && !isUuid(device)) ||
      (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000') ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) ||
      (before !== null && (typeof before !== 'string' || !/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n))) {
    fail(400, 'Choose a valid date or device.');
  }
  const { rows } = await pool.query(`SELECT id, device_id, event_type, info, occurred_at
    FROM account_login_events WHERE user_id = $1 AND occurred_at > now() - interval '90 days'
      AND ($2::date IS NULL OR (occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Manila')
        AND occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')))
      AND (NOT $3::boolean OR device_id IS NULL) AND ($4::uuid IS NULL OR device_id = $4)
      AND ($5::bigint IS NULL OR id < $5) ORDER BY id DESC LIMIT $6`,
  [user.id, date, device === 'unknown', device === 'unknown' ? null : device, before, pageSize + 1]);
  const entries = rows.slice(0, pageSize);
  return { entries, next: rows.length > pageSize ? entries.at(-1).id : null };
}));

router.patch('/alerts', writeLimiter, endpoint(async (req) => {
  if (typeof req.body?.enabled !== 'boolean') fail(400, 'Choose an email alert preference.');
  return withAccount(req.user.id, async (db) => {
    await currentDevice(db, req.user);
    await db.query('UPDATE users SET new_login_email_alerts = $2 WHERE id = $1', [req.user.id, req.body.enabled]);
    return { emailAlerts: req.body.enabled };
  });
}));

function manageDevice(remove) {
  return endpoint(async (req) => {
    const target = req.params.id;
    if (!isUuid(target)) fail(400, 'Choose a valid device.');
    const ended = await withAccount(req.user.id, async (db) => {
      const current = await currentDevice(db, req.user);
      if (target.toLowerCase() === current.id) fail(409, 'Use Sign out to end your current session.');
      const { rowCount } = await db.query('SELECT 1 FROM account_devices WHERE id = $1 AND user_id = $2 AND removed_at IS NULL', [target, req.user.id]);
      if (!rowCount) fail(404, 'Device not found.');
      const sessions = await endSessions(db, req.user.id, { deviceId: target });
      if (remove) {
        await revokeDeviceTrust(db, req.user.id, target);
        await db.query('UPDATE account_devices SET removed_at = now(), verified_at = NULL WHERE id = $1 AND user_id = $2', [target, req.user.id]);
      }
      return sessions;
    });
    disconnectSessions(ended);
    return { removed: remove };
  });
}

router.post('/devices/:id/logout', writeLimiter, manageDevice(false));
router.delete('/devices/:id', writeLimiter, manageDevice(true));
router.delete('/devices/:id/trust', writeLimiter, endpoint(async (req) => {
  const target = req.params.id;
  if (!isUuid(target)) fail(400, 'Choose a valid device.');
  const revoked = await withAccount(req.user.id, async (db) => {
    await currentDevice(db, req.user);
    return revokeDeviceTrust(db, req.user.id, target);
  });
  if (!revoked) fail(404, 'Trusted device not found.');
  return { revoked };
}));

router.post('/logout-others', writeLimiter, endpoint(async ({ user }) => {
  const ended = await withAccount(user.id, async (db) => {
    const current = await currentDevice(db, user);
    return endSessions(db, user.id, { exceptDevice: current.id });
  });
  disconnectSessions(ended);
  return { ended: ended.length };
}));

function codeHash(nonce, code) {
  return createHmac('sha256', process.env.JWT_SECRET).update(`${nonce}:${code}`).digest('hex');
}

function registrationHash(req) {
  const token = browserToken(req);
  if (!token) fail(409, 'Allow cookies for this site and sign in again to verify this device.');
  return hashToken(token);
}

router.post('/verification/send', writeLimiter, endpoint(async (req) => {
  const registration = registrationHash(req);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const nonce = randomUUID();
  const email = await withAccount(req.user.id, async (db, user) => {
    const device = await currentDevice(db, req.user, registration);
    if (device.verified_at) fail(409, 'This device is already verified.');
    const { rowCount } = await db.query(`INSERT INTO device_verification_challenges (session_id, nonce, code_hash, email, expires_at)
      VALUES ($1,$2,$3,$4,now() + interval '10 minutes')
      ON CONFLICT (session_id) DO UPDATE SET nonce = excluded.nonce, code_hash = excluded.code_hash, email = excluded.email,
        expires_at = excluded.expires_at, sent_at = now(), attempts = 0
      WHERE device_verification_challenges.sent_at < now() - interval '1 minute'`, [req.user.sid, nonce, codeHash(nonce, code), user.email]);
    if (!rowCount) fail(429, 'Wait one minute before requesting another code.');
    return user.email;
  });

  try {
    const result = await mailer.sendMail({ to: email, subject: 'Verify your e-MMERSION device',
      text: `Your device verification code is ${code}. It expires in 10 minutes. Keep this code private.` });
    if (!result.sent) throw new Error(result.reason || 'Email unavailable');
  } catch (error) {
    await pool.query('DELETE FROM device_verification_challenges WHERE session_id = $1 AND nonce = $2', [req.user.sid, nonce]);
    console.error('Device verification email:', error.message);
    fail(503, 'Could not send the verification code. Try again later.');
  }
  return { sent: true };
}));

router.post('/verification/confirm', writeLimiter, endpoint(async (req) => {
  const code = req.body?.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) fail(400, 'Enter the six-digit code.');
  const registration = registrationHash(req);
  const verified = await withAccount(req.user.id, async (db, user) => {
    const device = await currentDevice(db, req.user, registration);
    const { rows: [challenge] } = await db.query(`SELECT nonce, code_hash FROM device_verification_challenges
      WHERE session_id = $1 AND email = $2 AND expires_at > now() AND attempts < 5`, [req.user.sid, user.email]);
    if (!challenge) return false;
    if (!timingSafeEqual(Buffer.from(codeHash(challenge.nonce, code), 'hex'), Buffer.from(challenge.code_hash, 'hex'))) {
      await db.query('UPDATE device_verification_challenges SET attempts = attempts + 1 WHERE session_id = $1', [req.user.sid]);
      return false;
    }
    await db.query('UPDATE account_devices SET verified_at = now() WHERE id = $1 AND user_id = $2', [device.id, user.id]);
    await db.query('DELETE FROM device_verification_challenges WHERE session_id = $1', [req.user.sid]);
    return true;
  });
  if (!verified) fail(400, 'The code is incorrect or expired. Request a new code if needed.');
  return { verified: true };
}));

module.exports = router;
