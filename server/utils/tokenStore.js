// Hashed refresh-token storage and the access token deny-list.
// The device session service coordinates rotation and revocation in one transaction.
const crypto = require('crypto');
const pool = require('../db');

const { REFRESH_TTL_MS, ACCESS_TTL_MS } = require('../config/sessionPolicy');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Persist a freshly-issued refresh token.
async function storeRefreshToken({ userId, token, jti, req, sessionId, expiresAt = new Date(Date.now() + REFRESH_TTL_MS), db = pool }) {
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, jti, ip_address, user_agent, expires_at, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      hashToken(token),
      jti,
      req?.ip?.slice(0, 100) || null,
      req?.headers?.['user-agent']?.slice(0, 500) || null,
      expiresAt,
      sessionId,
    ]
  );
  return expiresAt;
}

// Look up a refresh token row by its raw value. Returns null when absent.
async function findRefreshToken(token, db = pool) {
  const result = await db.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1',
    [hashToken(token)]
  );
  return result.rows[0] || null;
}

// Rotate: revoke the presented token and record which jti replaced it.
async function rotateRefreshToken(oldToken, newJti, db = pool) {
  await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP, replaced_by = $1
      WHERE token_hash = $2 AND revoked_at IS NULL`,
    [newJti, hashToken(oldToken)]
  );
}

// Add an access-token jti to the short-lived deny-list. Expiry mirrors the
// access token TTL so the list self-cleans.
async function revokeAccessToken({ jti, userId, reason = 'logout' }) {
  if (!jti) return;
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  await pool.query(
    `INSERT INTO revoked_tokens (jti, user_id, reason, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, userId || null, reason, expiresAt]
  );
}

// Is this access-token jti on the deny-list?
async function isAccessTokenRevoked(jti) {
  if (!jti) return false;
  const result = await pool.query(
    `SELECT 1 FROM revoked_tokens
      WHERE jti = $1 AND expires_at > CURRENT_TIMESTAMP LIMIT 1`,
    [jti]
  );
  return result.rows.length > 0;
}

// Housekeeping: drop deny-list rows past their expiry. Safe to call on a timer.
async function pruneExpiredRevocations() {
  await pool.query('DELETE FROM revoked_tokens WHERE expires_at < CURRENT_TIMESTAMP');
}

module.exports = {
  hashToken,
  storeRefreshToken,
  findRefreshToken,
  rotateRefreshToken,
  revokeAccessToken,
  isAccessTokenRevoked,
  pruneExpiredRevocations,
  REFRESH_TTL_MS,
  ACCESS_TTL_MS,
};
