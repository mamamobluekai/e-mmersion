const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const ACCESS_TTL_MS = 15 * MINUTE_MS;
const REFRESH_TTL_MS = 7 * DAY_MS;
const REMEMBER_TTL_MS = 30 * DAY_MS;
const IDLE_MINUTES = 30;
const ADMIN_IDLE_MINUTES = 15;

// Reuse the same deadline in authorization, rotation, and session listings.
function sessionDeadline(role = 'u.role') {
  return `LEAST(s.expires_at, s.last_active_at + CASE WHEN ${role} = 'admin'
    THEN interval '${ADMIN_IDLE_MINUTES} minutes' ELSE interval '${IDLE_MINUTES} minutes' END)`;
}

module.exports = { ACCESS_TTL_MS, REFRESH_TTL_MS, REMEMBER_TTL_MS, sessionDeadline };
