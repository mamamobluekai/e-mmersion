const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/generateToken');
const tokens = require('../utils/tokenStore');
const { getRefreshCookieOptions } = require('../utils/refreshCookie');
const { normalizeEmail } = require('../utils/normalizeEmail');
const { resetLoginAttempts } = require('../utils/loginAttempts');
const { isTestLoginAccount, isLocalRequest } = require('../config/testLogin');
const { REFRESH_TTL_MS, REMEMBER_TTL_MS, sessionDeadline } = require('../config/sessionPolicy');
const { logSecurityEvent, SECURITY_EVENTS, SEVERITY } = require('../utils/securityLogger');

const deviceCookie = () => process.env.NODE_ENV === 'production' ? '__Host-accountDevice' : 'accountDevice';
const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
let schemaReady;
let loginSchemaReady;
let testLoginSchemaReady;

function ensureSchema() {
  schemaReady ??= (async () => {
    const { rows: [schema] } = await pool.query("SELECT to_regclass('public.device_verification_challenges') IS NOT NULL AS ready");
    if (!schema.ready) await pool.query(await readFile(path.join(__dirname, '../db/migrations/051_device_sessions.sql'), 'utf8'));
  })().catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
}

function ensureLoginSchema() {
  loginSchemaReady ??= (async () => {
    await ensureSchema();
    const { rows: [schema] } = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'login_otp_verifications' AND column_name = 'previous_code_hashes') AS ready`);
    if (!schema.ready) await pool.query(await readFile(path.join(__dirname, '../db/migrations/053_login_otp.sql'), 'utf8'));
    const { rows: [policy] } = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'login_otp_verifications' AND column_name = 'remember_me') AS ready`);
    if (!policy.ready) await pool.query(await readFile(path.join(__dirname, '../db/migrations/055_session_expiration.sql'), 'utf8'));
  })().catch((error) => { loginSchemaReady = undefined; throw error; });
  return loginSchemaReady;
}

function ensureTestLoginSchema() {
  testLoginSchemaReady ??= (async () => {
    await ensureLoginSchema();
    const { rows: [schema] } = await pool.query(`SELECT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.account_sessions'::regclass
        AND conname = 'account_sessions_authentication_method_with_test_check') AS ready`);
    if (!schema.ready) await pool.query(await readFile(path.join(__dirname, '../db/migrations/054_test_login_sessions.sql'), 'utf8'));
  })().catch((error) => { testLoginSchemaReady = undefined; throw error; });
  return testLoginSchemaReady;
}

function usableSession(method, email, req) {
  return method === 'otp' || method === 'trusted'
    || (method === 'test' && isTestLoginAccount(email) && isLocalRequest(req));
}

function deviceInfo(req) {
  const ua = String(req.get('User-Agent') || '').slice(0, 500);
  const tablet = /iPad|Tablet|Android(?!.*Mobile)|Macintosh.*Mobile/i.test(ua);
  const mobile = !tablet && /iPhone|iPod|Android|Mobile/i.test(ua);
  const os = /iPad|Macintosh.*Mobile/i.test(ua) ? 'iPadOS' : /iPhone|iPod/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /CrOS/i.test(ua) ? 'ChromeOS'
      : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
  const browser = /Edg(?:A|iOS)?\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera'
    : /SamsungBrowser\//i.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS\//i.test(ua) ? 'Firefox'
      : /Chrome\/|CriOS\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Unknown';
  const type = tablet ? 'Tablet' : mobile ? 'Mobile' : 'Desktop';
  const name = { Windows: 'Windows PC', iOS: 'iPhone', iPadOS: 'iPad', macOS: 'Mac', ChromeOS: 'Chromebook', Linux: 'Linux computer' }[os]
    || (os === 'Android' ? `Android ${tablet ? 'tablet' : 'phone'}` : `Unknown ${type.toLowerCase()}`);
  // Use only deployment-provided geolocation headers when the ingress strips client-supplied values.
  const location = process.env.SECURITY_TRUST_EDGE_LOCATION === 'true'
    ? ['cf-ipcity', 'cf-region', 'cf-ipcountry'].map((header) => req.get(header)?.trim())
      .filter((part) => part && /^[\p{L}\p{N} .'-]{1,64}$/u.test(part)).join(', ') || null
    : null;
  return { name, type, browser, os, ip: isIP(req.ip || '') ? req.ip : null, location };
}

function deviceSignature(token) {
  return createHmac('sha256', process.env.JWT_SECRET).update(`account-device:${token}`).digest('hex');
}

function browserToken(req) {
  const cookie = req.cookies?.[deviceCookie()];
  const match = typeof cookie === 'string' && /^([A-Za-z0-9_-]{43})\.([a-f0-9]{64})$/.exec(cookie);
  if (!match) return null;
  const [, token, signature] = match;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(deviceSignature(token), 'hex')) ? token : null;
}

function setBrowserCookie(res, token) {
  res.cookie(deviceCookie(), `${token}.${deviceSignature(token)}`, { ...getRefreshCookieOptions(), path: '/', maxAge: 180 * 24 * 60 * 60 * 1000 });
}

async function withAccount(userId, operation) {
  await ensureLoginSchema();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [user] } = await db.query(`SELECT id, email, role, status, password, new_login_email_alerts,
      terms_accepted, skip_splash_screen, temporary_password_expires_at, login_security_version
      FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const result = user ? await operation(db, user) : null;
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

function recordEvent(db, userId, deviceId, type, info, { sid = null, otp = null, trusted = null, flags = [] } = {}) {
  return db.query(`INSERT INTO account_login_events (user_id, device_id, event_type, info, session_id, otp_status, was_trusted, flags)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [userId, deviceId, type, info, sid, otp, trusted, flags]);
}

async function revokeDeviceTrust(db, userId, deviceId) {
  const { rows: [device] } = await db.query(`UPDATE account_devices
    SET trust_token_hash = NULL, trust_expires_at = NULL, trust_revoked_at = now()
    WHERE user_id = $1 AND id = $2 AND removed_at IS NULL AND trust_token_hash IS NOT NULL
    RETURNING registration_hash`, [userId, deviceId]);
  if (!device) return false;
  await db.query('DELETE FROM login_otp_verifications WHERE user_id = $1 AND registration_hash = $2',
    [userId, device.registration_hash]);
  return true;
}

function startLoginActivityCleanup() {
  let running = false;
  async function cleanup() {
    if (running) return;
    running = true;
    try {
      await ensureLoginSchema();
      await pool.query("DELETE FROM account_login_events WHERE occurred_at < now() - interval '90 days'");
      await pool.query("DELETE FROM login_otp_verifications WHERE sent_at < now() - interval '1 day'");
      await pool.query(`UPDATE account_devices SET info = info - 'ip' - 'location'
        WHERE last_login_at < now() - interval '90 days' AND (info ? 'ip' OR info ? 'location')`);
    } catch (error) {
      console.error('Login activity cleanup:', error.code || error.name);
    } finally {
      running = false;
    }
  }
  void cleanup();
  const timer = setInterval(cleanup, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

async function recordFailedLogin(req, email, flags = []) {
  await ensureLoginSchema();
  const token = browserToken(req);
  await pool.query(`INSERT INTO account_login_events (user_id, device_id, event_type, info, attempted_email, flags)
    SELECT u.id, d.id, 'failed', $3::jsonb, attempted.email, $4
    FROM (VALUES ($1::varchar(255))) attempted(email) LEFT JOIN users u ON u.email = attempted.email
    LEFT JOIN account_devices d ON d.user_id = u.id AND d.registration_hash = $2 AND d.removed_at IS NULL
    `, [typeof email === 'string' && email ? email.slice(0, 255) : null, token && tokens.hashToken(token), deviceInfo(req), flags]);
}

function observeLoginFailure(req, res, next) {
  if (req.method !== 'POST') return next();
  res.set('Cache-Control', 'no-store');
  const otpVerification = /\/otp\/verify\/?$/i.test(req.originalUrl.split('?')[0]);
  res.once('finish', () => {
    if (res.statusCode < 400 || res.locals.loginFailureRecorded) return;
    const flags = res.statusCode === 429 ? ['repeated_login_failures'] : [];
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : null;
    const record = otpVerification
      ? ensureLoginSchema().then(() => recordEvent(pool, null, null, 'otp_failed', deviceInfo(req), { otp: 'failed', flags }))
      : recordFailedLogin(req, email, flags);
    void record.catch((error) => console.error('Login activity:', error.code || error.name));
  });
  return next();
}

async function endSessions(db, userId, { deviceId = null, exceptDevice = null, sessionId = null, event = 'terminated' } = {}) {
  const { rows } = await db.query(`UPDATE account_sessions s SET ended_at = now()
    FROM account_devices d, users u WHERE s.user_id = $1 AND u.id = s.user_id AND s.device_id = d.id AND s.ended_at IS NULL
      AND ($2::uuid IS NULL OR s.device_id = $2) AND ($3::uuid IS NULL OR s.device_id <> $3)
      AND ($4::uuid IS NULL OR s.id = $4)
    RETURNING s.id, s.device_id, d.info, ${sessionDeadline()} > now() AS was_active`, [userId, deviceId, exceptDevice, sessionId]);
  const ids = rows.map(({ id }) => id);
  if (ids.length) {
    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE session_id = ANY($1::uuid[]) AND revoked_at IS NULL', [ids]);
    await db.query('DELETE FROM device_verification_challenges WHERE session_id = ANY($1::uuid[])', [ids]);
    const active = rows.filter(({ was_active }) => was_active);
    await db.query(`INSERT INTO account_login_events (user_id, device_id, event_type, info, session_id)
      SELECT $1, item.device_id, $2, item.info, item.id FROM jsonb_to_recordset($3::jsonb) AS item(id uuid, device_id uuid, info jsonb)`,
    [userId, event, JSON.stringify(active)]);
  }
  return ids;
}

function disconnectSessions(ids) {
  if (ids?.length) require('../sockets').disconnectAccountSessions(ids);
}

async function issueTokens(db, user, sid, req, testSession, sessionExpiresAt, oldRefresh = null) {
  const now = Date.now();
  const refreshLifetime = Math.min(REFRESH_TTL_MS, new Date(sessionExpiresAt).getTime() - now);
  const refreshSeconds = Math.floor(refreshLifetime / 1000);
  if (refreshSeconds < 1) return null;
  const accessToken = generateAccessToken({ ...user, sid }, testSession);
  const refresh = generateRefreshToken(user, testSession, refreshSeconds);
  const expiresAt = new Date(now + refreshSeconds * 1000);
  if (oldRefresh) await tokens.rotateRefreshToken(oldRefresh, refresh.jti, db);
  await tokens.storeRefreshToken({ userId: user.id, token: refresh.token, jti: refresh.jti, sessionId: sid, expiresAt, req, db });
  return { accessToken, refreshToken: refresh.token, refreshMaxAge: refreshSeconds * 1000 };
}

async function createSession(db, user, req, registrationHash, { method, trustHash = null, flags = [], rememberMe = false }) {
  const info = deviceInfo(req);
  const found = await db.query(`UPDATE account_devices SET info = $3, last_login_at = now()
    WHERE user_id = $1 AND registration_hash = $2 AND removed_at IS NULL RETURNING id, last_login_at`, [user.id, registrationHash, info]);
  const newDevice = !found.rowCount;
  const device = found.rows[0] || (await db.query(`INSERT INTO account_devices (id, user_id, registration_hash, info)
    VALUES ($1,$2,$3,$4) RETURNING id, last_login_at`, [randomUUID(), user.id, registrationHash, info])).rows[0];
  if (method === 'otp') {
    await db.query(`UPDATE account_devices SET trust_token_hash = $2, trusted_at = CASE WHEN $2::text IS NOT NULL THEN now() END,
      trust_expires_at = CASE WHEN $2::text IS NOT NULL THEN now() + interval '30 days' END,
      trust_last_used_at = CASE WHEN $2::text IS NOT NULL THEN now() END,
      trust_revoked_at = NULL, verified_at = now() WHERE id = $1`, [device.id, trustHash]);
  } else if (method === 'trusted') {
    await db.query('UPDATE account_devices SET trust_last_used_at = now() WHERE id = $1', [device.id]);
  }
  const ended = await endSessions(db, user.id);
  const sid = randomUUID();
  const expiresAt = new Date(Date.now() + (rememberMe ? REMEMBER_TTL_MS : REFRESH_TTL_MS));
  await db.query(`INSERT INTO account_sessions (id, user_id, device_id, expires_at, authentication_method) VALUES ($1,$2,$3,$4,$5)`,
    [sid, user.id, device.id, expiresAt, method]);
  await recordEvent(db, user.id, device.id, newDevice ? 'new_device' : 'login', info,
    { sid, otp: method === 'otp' ? 'verified' : 'not_required', trusted: method === 'trusted' || Boolean(trustHash), flags });
  await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
  await resetLoginAttempts(user.email, db);
  return { ...await issueTokens(db, user, sid, req, method === 'test', expiresAt), ended, newDevice, info, device, sid,
    alertsEnabled: method !== 'test' && user.new_login_email_alerts };
}

function sendSessionCookies(res, result, token) {
  disconnectSessions(result.ended);
  setBrowserCookie(res, token);
  setRefreshCookie(res, result);
}

function setRefreshCookie(res, result) {
  res.cookie('refreshToken', result.refreshToken, { ...getRefreshCookieOptions(), maxAge: result.refreshMaxAge });
}

async function refreshSession(req, presented) {
  let decoded;
  try { decoded = verifyRefreshToken(presented); } catch { return null; }
  if (decoded?.type !== 'refresh' || !Number.isInteger(decoded.id)) return null;
  const result = await withAccount(decoded.id, async (db, user) => {
    if (['pending', 'disapproved'].includes(String(user.status).toLowerCase())) return { inactive: true };
    const row = await tokens.findRefreshToken(presented, db);
    if (!row?.session_id || row.user_id !== user.id || row.jti !== decoded.jti || new Date(row.expires_at) <= new Date()) return null;
    const { rows: [active] } = await db.query(`SELECT s.authentication_method, s.expires_at FROM account_sessions s
      WHERE s.id = $1 AND s.user_id = $2 AND s.ended_at IS NULL AND ${sessionDeadline('$3::text')} > now()`,
    [row.session_id, user.id, user.role]);
    if (!active || !usableSession(active.authentication_method, user.email, req)) return null;
    if (row.revoked_at) {
      if (!row.replaced_by) return null;
      return { replay: true, ended: await endSessions(db, user.id) };
    }
    return issueTokens(db, user, row.session_id, req, active.authentication_method === 'test', active.expires_at, presented);
  });
  if (result?.replay) {
    disconnectSessions(result.ended);
    await logSecurityEvent({ type: SECURITY_EVENTS.TOKEN_REPLAY_DETECTED, severity: SEVERITY.CRITICAL,
      req, userId: decoded.id, detail: 'Rotated refresh token was replayed. Account sessions terminated.' });
    return null;
  }
  return result;
}

async function checkAccessSession(decoded, req, touch = false) {
  if (!decoded?.id || decoded.type !== 'access' || !isUuid(decoded.sid)) return null;
  await ensureLoginSchema();
  const { rows: [session] } = await pool.query(`SELECT s.device_id, s.authentication_method, u.email, ${sessionDeadline()} AS deadline
    FROM account_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 AND s.user_id = $2 AND s.ended_at IS NULL AND ${sessionDeadline()} > now()`, [decoded.sid, decoded.id]);
  if (!session || !usableSession(session.authentication_method, session.email, req)) return null;
  if (touch) {
    const { rows: [updated] } = await pool.query(`UPDATE account_sessions s SET last_active_at = now() FROM users u
      WHERE s.id = $1 AND u.id = s.user_id AND s.ended_at IS NULL AND ${sessionDeadline()} > now()
      RETURNING ${sessionDeadline()} AS deadline`, [decoded.sid]);
    if (!updated) return null;
    session.deadline = updated.deadline;
  }
  return session;
}

async function endCurrentSession(user) {
  if (!user.sid) return;
  disconnectSessions(await withAccount(user.id, (db) => endSessions(db, user.id, { sessionId: user.sid, event: 'logout' })));
}

module.exports = { ensureSchema, ensureLoginSchema, ensureTestLoginSchema, createSession, sendSessionCookies, setRefreshCookie, setBrowserCookie, refreshSession,
  checkAccessSession, endCurrentSession, recordFailedLogin, recordEvent, deviceInfo, withAccount, endSessions,
  disconnectSessions, browserToken, isUuid, revokeDeviceTrust, startLoginActivityCleanup, observeLoginFailure };
