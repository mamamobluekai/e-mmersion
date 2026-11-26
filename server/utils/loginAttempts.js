const pool = require('../db');

const MAX_ATTEMPTS = 5;
const LOCK_TIME_MINUTES = 15;

const getLoginAttempts = async (email, db = pool) => {
  const result = await db.query(
    'SELECT * FROM login_attempts WHERE LOWER(email) = LOWER($1) ORDER BY last_attempt DESC, id DESC LIMIT 1',
    [email]
  );
  return result.rows[0];
};

function lockAttempts(db, email) {
  return db.query('SELECT pg_advisory_xact_lock(53025, hashtext(lower($1)))', [email]);
}

const incrementLoginAttempts = async (email, ipAddress) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await lockAttempts(db, email);
    const existing = await getLoginAttempts(email, db);
    if (isAccountLocked(existing)) {
      await db.query('COMMIT');
      return { attempts: existing.attempts, lockedUntil: existing.locked_until };
    }
    const attempts = existing && !existing.locked_until ? existing.attempts + 1 : 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCK_TIME_MINUTES * 60 * 1000)
      : null;
    if (existing) {
      await db.query(
        'UPDATE login_attempts SET attempts = $1, locked_until = $2, ip_address = $3, last_attempt = now() WHERE id = $4',
        [attempts, lockedUntil, ipAddress, existing.id]
      );
    } else {
      await db.query('INSERT INTO login_attempts (email, ip_address, attempts) VALUES ($1, $2, 1)', [email, ipAddress]);
    }
    await db.query('COMMIT');
    return { attempts, lockedUntil };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
};

const resetLoginAttempts = async (email, db) => {
  await lockAttempts(db, email);
  await db.query('DELETE FROM login_attempts WHERE LOWER(email) = LOWER($1)', [email]);
};

// Kept for callers that already hold an attempts row.
const isAccountLocked = (attempts) => {
  if (!attempts || !attempts.locked_until) return false;
  return new Date(attempts.locked_until) > new Date();
};

// Reads the lockout state for an email address.
//
// This exists because both login controllers used to call isAccountLocked() with
// an email *string* and await it. On a string, `attempts.locked_until` is
// undefined, so the function always answered false and the lockout branch was
// unreachable - five wrong passwords never locked anything. This is the
// by-address version they actually meant.
//
// `attemptsRemaining` is reported so the UI can warn before the lock, but it is
// only meaningful for an address that exists, so callers must not send it back
// to the client (see utils/loginErrors.js).
const getLockoutState = async (email) => {
  const row = await getLoginAttempts(email);
  if (!row) return { locked: false, minutesRemaining: 0, attempts: 0, attemptsRemaining: MAX_ATTEMPTS };

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const minutes = Math.ceil((new Date(row.locked_until) - Date.now()) / 60000);
    return { locked: true, minutesRemaining: minutes, attempts: row.attempts, attemptsRemaining: 0 };
  }

  return {
    locked: false,
    minutesRemaining: 0,
    attempts: row.attempts,
    // A lock that has already expired starts the count again.
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - (row.locked_until ? 0 : row.attempts)),
  };
};

module.exports = {
  getLoginAttempts,
  incrementLoginAttempts,
  resetLoginAttempts,
  isAccountLocked,
  getLockoutState,
  MAX_ATTEMPTS,
  LOCK_TIME_MINUTES,
};
