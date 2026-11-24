const { createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/generateToken');
const tokens = require('../utils/tokenStore');
const { getRefreshCookieOptions } = require('../utils/refreshCookie');
const { logSecurityEvent, SECURITY_EVENTS, SEVERITY } = require('../utils/securityLogger');

const deviceCookie = () => process.env.NODE_ENV === 'production' ? '__Host-accountDevice' : 'accountDevice';
const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
let schemaReady;

function ensureSchema() {
  schemaReady ??= (async () => {
    const { rows: [schema] } = await pool.query("SELECT to_regclass('public.device_verification_challenges') IS NOT NULL AS ready");
    if (!schema.ready) await pool.query(await readFile(path.join(__dirname, '../db/migrations/051_device_sessions.sql'), 'utf8'));
  })().catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
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

async function withAccount(userId, operation) {
  await ensureSchema();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [user] } = await db.query(`SELECT id, email, role, status, password, new_login_email_alerts
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

function recordEvent(db, userId, deviceId, type, info) {
  return db.query(`INSERT INTO account_login_events (user_id, device_id, event_type, info)
    VALUES ($1, $2, $3, $4)`, [userId, deviceId, type, info]);
}

async function recordFailedLogin(req, email) {
  await ensureSchema();
  const token = browserToken(req);
  await pool.query(`INSERT INTO account_login_events (user_id, device_id, event_type, info)
    SELECT u.id, d.id, 'failed', $3::jsonb FROM users u
    LEFT JOIN account_devices d ON d.user_id = u.id AND d.registration_hash = $2 AND d.removed_at IS NULL
    WHERE u.email = $1`, [email, token && tokens.hashToken(token), deviceInfo(req)]);
}

async function endSessions(db, userId, { deviceId = null, exceptDevice = null, sessionId = null, event = 'terminated' } = {}) {
  const { rows } = await db.query(`UPDATE account_sessions s SET ended_at = now()
    FROM account_devices d WHERE s.user_id = $1 AND s.device_id = d.id AND s.ended_at IS NULL
      AND ($2::uuid IS NULL OR s.device_id = $2) AND ($3::uuid IS NULL OR s.device_id <> $3)
      AND ($4::uuid IS NULL OR s.id = $4)
    RETURNING s.id, s.device_id, d.info, s.expires_at > now() AS was_active`, [userId, deviceId, exceptDevice, sessionId]);
  const ids = rows.map(({ id }) => id);
  if (ids.length) {
    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE session_id = ANY($1::uuid[]) AND revoked_at IS NULL', [ids]);
    await db.query('DELETE FROM device_verification_challenges WHERE session_id = ANY($1::uuid[])', [ids]);
    const active = rows.filter(({ was_active }) => was_active);
    await db.query(`INSERT INTO account_login_events (user_id, device_id, event_type, info)
      SELECT $1, item.device_id, $2, item.info FROM jsonb_to_recordset($3::jsonb) AS item(device_id uuid, info jsonb)`,
    [userId, event, JSON.stringify(active)]);
  }
  return ids;
}

function disconnectSessions(ids) {
  if (ids?.length) require('../sockets').disconnectAccountSessions(ids);
}

async function issueTokens(db, user, sid, req, oldRefresh = null) {
  const accessToken = generateAccessToken({ ...user, sid });
  const refresh = generateRefreshToken(user);
  const expiresAt = new Date(Date.now() + tokens.REFRESH_TTL_MS);
  if (oldRefresh) await tokens.rotateRefreshToken(oldRefresh, refresh.jti, db);
  await tokens.storeRefreshToken({ userId: user.id, token: refresh.token, jti: refresh.jti, sessionId: sid, expiresAt, req, db });
  await db.query('UPDATE account_sessions SET expires_at = $2, last_active_at = now() WHERE id = $1', [sid, expiresAt]);
  return { accessToken, refreshToken: refresh.token };
}

async function startSession(req, res, verifiedUser) {
  const token = browserToken(req) || randomBytes(32).toString('base64url');
  const registrationHash = tokens.hashToken(token);
  const info = deviceInfo(req);
  const result = await withAccount(verifiedUser.id, async (db, user) => {
    if (user.password !== verifiedUser.password || user.email !== verifiedUser.email ||
        user.role !== verifiedUser.role || user.status !== verifiedUser.status) return null;
    const found = await db.query(`UPDATE account_devices SET info = $3, last_login_at = now()
      WHERE user_id = $1 AND registration_hash = $2 AND removed_at IS NULL RETURNING id, last_login_at`, [user.id, registrationHash, info]);
    const newDevice = !found.rowCount;
    const device = found.rows[0] || (await db.query(`INSERT INTO account_devices (id, user_id, registration_hash, info)
      VALUES ($1,$2,$3,$4) RETURNING id, last_login_at`, [randomUUID(), user.id, registrationHash, info])).rows[0];
    const ended = await endSessions(db, user.id, { deviceId: device.id });
    const sid = randomUUID();
    await db.query(`INSERT INTO account_sessions (id, user_id, device_id, expires_at) VALUES ($1,$2,$3,$4)`,
      [sid, user.id, device.id, new Date(Date.now() + tokens.REFRESH_TTL_MS)]);
    await recordEvent(db, user.id, device.id, newDevice ? 'new_device' : 'login', info);
    return { ...await issueTokens(db, user, sid, req), ended, newDevice, info, device, sid, alertsEnabled: user.new_login_email_alerts };
  });
  if (!result) return null;
  disconnectSessions(result.ended);
  res.cookie(deviceCookie(), `${token}.${deviceSignature(token)}`, { ...getRefreshCookieOptions(), path: '/', maxAge: 180 * 24 * 60 * 60 * 1000 });
  res.cookie('refreshToken', result.refreshToken, { ...getRefreshCookieOptions(), maxAge: tokens.REFRESH_TTL_MS });
  return result;
}

async function refreshSession(req, presented) {
  let decoded;
  try { decoded = verifyRefreshToken(presented); } catch { return null; }
  if (decoded?.type !== 'refresh' || !Number.isInteger(decoded.id)) return null;
  const result = await withAccount(decoded.id, async (db, user) => {
    if (['pending', 'disapproved'].includes(String(user.status).toLowerCase())) return { inactive: true };
    const row = await tokens.findRefreshToken(presented, db);
    if (!row?.session_id || row.user_id !== user.id || row.jti !== decoded.jti || new Date(row.expires_at) <= new Date()) return null;
    const active = await db.query('SELECT 1 FROM account_sessions WHERE id = $1 AND user_id = $2 AND ended_at IS NULL AND expires_at > now()', [row.session_id, user.id]);
    if (!active.rowCount) return null;
    if (row.revoked_at) {
      if (!row.replaced_by) return null;
      return { replay: true, ended: await endSessions(db, user.id) };
    }
    return issueTokens(db, user, row.session_id, req, presented);
  });
  if (result?.replay) {
    disconnectSessions(result.ended);
    await logSecurityEvent({ type: SECURITY_EVENTS.TOKEN_REPLAY_DETECTED, severity: SEVERITY.CRITICAL,
      req, userId: decoded.id, detail: 'Rotated refresh token was replayed. Account sessions terminated.' });
    return null;
  }
  return result;
}

async function checkAccessSession(decoded, touch = false) {
  if (!decoded?.id || (decoded.type && decoded.type !== 'access')) return null;
  // Untyped bearer tokens were issued before refresh rotation. Modern tokens require a session.
  if (!decoded.sid) return decoded.type ? null : {};
  if (!isUuid(decoded.sid)) return null;
  await ensureSchema();
  const { rows: [session] } = await pool.query(`SELECT device_id, last_active_at FROM account_sessions
    WHERE id = $1 AND user_id = $2 AND ended_at IS NULL AND expires_at > now()`, [decoded.sid, decoded.id]);
  if (session && touch && Date.now() - new Date(session.last_active_at).getTime() > 60_000) {
    await pool.query(`UPDATE account_sessions SET last_active_at = now()
      WHERE id = $1 AND ended_at IS NULL AND last_active_at < now() - interval '1 minute'`, [decoded.sid]);
  }
  return session || null;
}

async function endCurrentSession(user) {
  if (!user.sid) return;
  disconnectSessions(await withAccount(user.id, (db) => endSessions(db, user.id, { sessionId: user.sid, event: 'logout' })));
}

module.exports = { ensureSchema, startSession, refreshSession, checkAccessSession, endCurrentSession, recordFailedLogin,
  withAccount, endSessions, disconnectSessions, browserToken, isUuid };
