const pool = require('../../db');
const sessions = require('../../services/deviceSessions.service');
const { sessionDeadline } = require('../../config/sessionPolicy');

const pageSize = 25;
const roles = ['admin', 'coordinator', 'teacher', 'supervisor', 'student'];
const statuses = ['success', 'failed', 'pending', 'logout', 'terminated'];
const verificationStatuses = ['pending', 'verified', 'failed', 'not_required'];
const account = `
  LEFT JOIN users u ON u.id = entry.user_id
  LEFT JOIN admins a ON u.role = 'admin' AND a.user_id = u.id
  LEFT JOIN coordinators c ON u.role = 'coordinator' AND c.user_id = u.id
  LEFT JOIN teachers t ON u.role = 'teacher' AND t.user_id = u.id
  LEFT JOIN supervisors p ON u.role = 'supervisor' AND p.user_id = u.id
  LEFT JOIN students st ON u.role = 'student' AND st.user_id = u.id`;
const name = `NULLIF(TRIM(concat_ws(' ', COALESCE(a.first_name,c.first_name,t.first_name,p.first_name,st.first_name),
  COALESCE(a.last_name,c.last_name,t.last_name,p.last_name,st.last_name))), '')`;
const email = 'COALESCE(entry.attempted_email, u.email)';
const status = `CASE entry.event_type WHEN 'login' THEN 'success' WHEN 'new_device' THEN 'success'
  WHEN 'otp_required' THEN 'pending' WHEN 'otp_failed' THEN 'failed' ELSE entry.event_type END`;
const suspicious = `entry.flags && ARRAY['device_profile_changed','recent_password_failures',
  'unfamiliar_session_replacement','otp_attempt_limit','repeated_login_failures']::text[]`;
const metadata = `entry.info->>'name' AS device, entry.info->>'os' AS os,
  entry.info->>'browser' AS browser, entry.info->>'ip' AS ip`;

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode });
}

function endpoint(operation) {
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      await sessions.ensureLoginSchema();
      return res.json(await operation(req));
    } catch (error) {
      if (!error.statusCode) console.error('Admin login activity:', error.code || error.name);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : 'Could not complete the login security request.',
      });
    }
  };
}

function validDate(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !value.startsWith('0000') && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value);
}

const listLoginActivity = endpoint(async ({ query }) => {
  const { search = '', role = null, loginStatus = null, otpStatus = null,
    from = null, to = null, view = 'activity', page = '1' } = query;
  if (typeof search !== 'string' || search.length > 150 || (role !== null && !roles.includes(role))
      || (loginStatus !== null && !statuses.includes(loginStatus)) || (otpStatus !== null && !verificationStatuses.includes(otpStatus))
      || !validDate(from) || !validDate(to) || (from && to && from > to)
      || !['activity', 'suspicious', 'sessions', 'devices'].includes(view)
      || typeof page !== 'string' || !/^[1-9]\d{0,5}$/.test(page)) fail(400, 'Choose valid login activity filters.');

  const offset = (Number(page) - 1) * pageSize;
  let sql;
  let params;
  const accountFilter = (searchEmail) => `($1 = '' OR strpos(lower(COALESCE(${name}, '')), lower($1)) > 0
    OR strpos(lower(COALESCE(${searchEmail}, '')), lower($1)) > 0)
    AND ($2::text IS NULL OR u.role = $2)`;

  if (view === 'sessions' || view === 'devices') {
    const isSession = view === 'sessions';
    // These two views use the same device and account metadata.
    sql = `SELECT ${isSession ? 's.id' : 'entry.id'} AS id, entry.user_id, ${name} AS name, u.email, u.role,
      ${metadata}, entry.created_at, entry.trusted_at, entry.trust_expires_at, entry.trust_last_used_at,
      entry.last_login_at, ${isSession ? `s.last_active_at, ${sessionDeadline()} AS expires_at` : 'NULL AS last_active_at, NULL AS expires_at'}
      FROM account_devices entry
      ${isSession ? 'JOIN account_sessions s ON s.device_id = entry.id AND s.user_id = entry.user_id' : ''}
      ${account}
      WHERE ${isSession
        ? `s.ended_at IS NULL AND ${sessionDeadline()} > now() AND s.authentication_method IS NOT NULL`
        : 'entry.trust_token_hash IS NOT NULL AND entry.trust_expires_at > now() AND entry.removed_at IS NULL'}
      AND ${accountFilter('u.email')}
      ORDER BY entry.last_login_at DESC, entry.id DESC LIMIT $3 OFFSET $4`;
    params = [search.trim(), role, pageSize + 1, offset];
  } else {
    sql = `SELECT entry.id, ${name} AS name, ${email} AS email, u.role, ${metadata}, entry.occurred_at,
      ${status} AS login_status, entry.otp_status, entry.was_trusted, entry.flags,
      CASE WHEN s.ended_at IS NOT NULL THEN 'Ended' WHEN ${sessionDeadline()} <= now() THEN 'Expired'
        WHEN s.id IS NOT NULL THEN 'Active' END AS session_status
      FROM account_login_events entry
      ${account}
      LEFT JOIN account_sessions s ON s.id = entry.session_id
      WHERE entry.occurred_at > now() - interval '90 days'
      AND ${accountFilter(email)}
      AND ($3::text IS NULL OR (${status}) = $3)
      AND ($4::text IS NULL OR entry.otp_status = $4)
      AND ($5::date IS NULL OR entry.occurred_at >= ($5::date::timestamp AT TIME ZONE 'Asia/Manila'))
      AND ($6::date IS NULL OR entry.occurred_at < (($6::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'))
      AND (NOT $7::boolean OR ${suspicious})
      ORDER BY entry.occurred_at DESC, entry.id DESC LIMIT $8 OFFSET $9`;
    params = [search.trim(), role, loginStatus, otpStatus, from, to, view === 'suspicious', pageSize + 1, offset];
  }
  const { rows } = await pool.query(sql, params);
  return { entries: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
});

function manageAccess(action) {
  return endpoint(async (req) => {
    const { userId, id } = req.params;
    if (!/^[1-9]\d{0,9}$/.test(userId) || Number(userId) > 2147483647 || !sessions.isUuid(id)) {
      fail(400, 'Choose a valid account and device or session.');
    }
    const terminate = action === 'terminate_session';
    const result = await sessions.withAccount(userId, async (db) => {
      let ended = [];
      if (terminate) {
        ended = await sessions.endSessions(db, userId, { sessionId: id });
      } else if (!await sessions.revokeDeviceTrust(db, userId, id)) {
        return null;
      }
      if (terminate && !ended.length) return null;
      const info = sessions.deviceInfo(req);
      await db.query(`INSERT INTO audit_logs (user_id, action, details, ip_address, module, status, device)
        VALUES ($1, $2, $3, $4, 'login_activity', 'success', $5)`,
      [req.user.id, action, `Target account ${userId}, record ${id}`, info.ip, info.name]);
      return { ended };
    });
    if (!result) fail(404, terminate ? 'Active session not found.' : 'Trusted device not found.');
    sessions.disconnectSessions(result.ended);
    return { success: true };
  });
}

module.exports = {
  listLoginActivity,
  terminateLoginSession: manageAccess('terminate_session'),
  revokeTrustedDevice: manageAccess('revoke_trusted_device'),
};
