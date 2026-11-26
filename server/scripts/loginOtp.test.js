const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');

test('email OTP, trusted devices, and Admin session controls', async () => {
  const database = new URL(process.env.LOGIN_OTP_TEST_DATABASE_URL || 'postgresql://127.0.0.1/wim_login_otp_test');
  assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
  assert.equal(database.pathname, '/wim_login_otp_test');
  process.env.DATABASE_URL = database.href;
  process.env.DB_SSL = 'false';
  process.env.NODE_ENV = 'test';
  process.env.CLIENT_URL = 'http://localhost:5173';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.LOGIN_OTP_SECRET = randomBytes(32).toString('hex');
  delete process.env.LOGIN_OTP_TEST_ACCOUNTS;

  const pool = require('../db');
  const mailer = require('../utils/mailer');
  const { hashPassword } = require('../utils/hashPassword');
  const { nowInManilaDateOnly } = require('../utils/manilaDate');
  const { ensureLoginSchema } = require('../services/deviceSessions.service');
  const { initializeSocket, getIO } = require('../sockets');
  const app = require('../app');
  const mail = new Map();
  mailer.sendMail = async ({ to, subject, text }) => {
    mail.set(`${to}:${subject}`, text);
    return { sent: true };
  };
  const codeFor = (email) => mail.get(`${email}:Your e-MMERSION sign-in code`)?.match(/\b\d{6}\b/)?.[0];
  const ids = [];
  const server = app.listen(0, '127.0.0.1');
  const suffix = randomBytes(5).toString('hex');
  const password = 'Test!SignIn64';
  const otpPath = '/users/login/otp';
  await once(server, 'listening');
  initializeSocket(server);

  function browser(agent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/144.0') {
    const cookies = new Map();
    let csrf;
    async function request(path, { method = 'GET', body, token } = {}) {
      const headers = { 'User-Agent': agent, Cookie: [...cookies.values()].join('; ') };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (csrf) headers['X-CSRF-Token'] = csrf;
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method, headers, body: body && JSON.stringify(body),
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0];
        cookies.set(pair.split('=')[0], pair);
      }
      const data = await response.json();
      csrf = data.csrfToken || csrf;
      return { status: response.status, data, cookies: response.headers.getSetCookie() };
    }
    return {
      request,
      init: () => request('/users/csrf-token'),
      useLegacyTrustCookie() {
        const name = [...cookies.keys()].find((key) => key.startsWith('wimTrust-'));
        assert.ok(name);
        cookies.set('wimTrust', cookies.get(name).replace(name, 'wimTrust'));
        cookies.delete(name);
      },
    };
  }

  async function account(role) {
    const email = `${role}-${ids.length}-${suffix}@example.com`;
    const { rows: [user] } = await pool.query(`INSERT INTO users (email, password, role, status, terms_accepted, new_login_email_alerts)
      VALUES ($1, $2, $3, 'approved', true, true) RETURNING id, email, role`, [email, await hashPassword(password), role]);
    ids.push(user.id);
    return user;
  }

  const login = (client, user, value = password, rememberMe = false) => client.request(user.role === 'admin' ? '/admin/login' : `/users/login/${user.role}`, {
    method: 'POST', body: { email: user.email, password: value, role: user.role, rememberMe },
  });
  const verify = (client, challengeId, code, trustDevice = false) => client.request(`${otpPath}/verify`, {
    method: 'POST', body: { challengeId, code, trustDevice },
  });
  const resend = (client, challengeId) => client.request(`${otpPath}/resend`, { method: 'POST', body: { challengeId } });

  async function challenge(client, user, value, rememberMe) {
    const response = await login(client, user, value, rememberMe);
    assert.equal(response.status, 202, response.data.error);
    assert.equal(response.data.otpRequired, true);
    assert.equal(response.data.accessToken, undefined);
    assert.equal(response.cookies.some((cookie) => cookie.startsWith('refreshToken=')), false);
    assert.match(response.data.maskedEmail, /•••@example\.com$/);
    return response.data.challengeId;
  }

  try {
    await ensureLoginSchema();
    const admin = await account('admin');
    const clients = {};
    for (const user of [admin, ...await Promise.all(['coordinator', 'teacher', 'supervisor', 'student'].map(account))]) {
      const client = browser();
      await client.init();
      const id = await challenge(client, user);
      assert.equal((await client.request('/users/me')).status, 401);
      const response = await verify(client, id, codeFor(user.email), true);
      assert.equal(response.status, 200, response.data.error);
      assert.equal(response.data.user.role, user.role);
      const { iat, exp, sid } = jwt.decode(response.data.accessToken);
      assert.equal(exp - iat, 900);
      const refreshCookie = response.cookies.find((cookie) => cookie.startsWith('refreshToken='));
      const refresh = jwt.decode(refreshCookie.split(';')[0].slice('refreshToken='.length));
      assert.ok(refresh.exp - refresh.iat <= 7 * 86400);
      const { rows: [normalSession] } = await pool.query('SELECT expires_at FROM account_sessions WHERE id = $1', [sid]);
      assert.ok(Math.abs(new Date(normalSession.expires_at).getTime() - Date.now() - 7 * 86400_000) < 5000);
      assert.ok(response.cookies.some((cookie) => /^wimTrust-[\w-]+=[^;]+;.*HttpOnly.*SameSite=Lax/.test(cookie)));
      assert.equal((await client.request('/users/me', { token: response.data.accessToken })).status, 200);
      assert.equal((await verify(client, id, codeFor(user.email))).status, 400);
      clients[user.role] = { user, client, token: response.data.accessToken };
    }

    const { user, client, token } = clients.student;
    const adminToken = clients.admin.token;
    const adminClient = clients.admin.client;
    const adminRequest = (path, method) => adminClient.request(`/admin/login-activity${path}`, { method, token: adminToken });
    assert.equal((await client.request('/admin/login-activity', { token })).status, 403);
    const ownDevices = await clients.supervisor.client.request('/users/security/devices', { token: clients.supervisor.token });
    assert.equal(ownDevices.status, 200, ownDevices.data.error);
    const [ownDevice] = ownDevices.data.devices;
    assert.equal(ownDevice.trusted, true);
    assert.equal((await clients.supervisor.client.request(`/users/security/devices/${ownDevice.id}/trust`, {
      method: 'DELETE', token: clients.supervisor.token,
    })).status, 200);
    await challenge(clients.supervisor.client, clients.supervisor.user);
    await pool.query("UPDATE account_devices SET trust_expires_at = now() WHERE user_id = $1", [clients.coordinator.user.id]);
    await challenge(clients.coordinator.client, clients.coordinator.user);
    const suspiciousBrowser = clients.teacher.client;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal((await login(suspiciousBrowser, clients.teacher.user, 'Wrong!Password5')).status, 401);
    }
    await challenge(suspiciousBrowser, clients.teacher.user);
    const trusted = await login(client, user);
    assert.equal(trusted.status, 200, trusted.data.error);
    const trustedToken = trusted.data.accessToken;
    assert.equal((await client.request('/users/me', { token })).status, 401);

    const other = browser('Mozilla/5.0 (X11; Linux x86_64) Firefox/145.0');
    await other.init();
    const id = await challenge(other, user, password, true);
    assert.equal((await client.request('/users/me', { token: trustedToken })).status, 200);
    const previousCode = codeFor(user.email);
    const incorrect = previousCode === '000000' ? '000001' : '000000';
    assert.equal((await verify(other, id, incorrect)).status, 400);
    assert.equal((await resend(other, id)).status, 429);
    await pool.query("UPDATE login_otp_verifications SET expires_at = now(), sent_at = now() - interval '61 seconds' WHERE user_id = $1", [user.id]);
    assert.equal((await verify(other, id, previousCode)).status, 400);
    assert.equal((await resend(other, id)).status, 202);
    assert.notEqual(codeFor(user.email), previousCode);
    assert.equal((await verify(other, id, previousCode)).status, 400);
    const newSession = await verify(other, id, codeFor(user.email));
    assert.equal(newSession.status, 200, newSession.data.error);
    const rememberedToken = newSession.data.accessToken;
    const { sid: rememberedId } = jwt.decode(rememberedToken);
    const { rows: [remembered] } = await pool.query('SELECT expires_at FROM account_sessions WHERE id = $1', [rememberedId]);
    assert.ok(Math.abs(new Date(remembered.expires_at).getTime() - Date.now() - 30 * 86400_000) < 5000);
    await pool.query("UPDATE account_sessions SET last_active_at = now() - interval '16 minutes' WHERE id = $1", [rememberedId]);
    const sessionStatus = await other.request('/users/session', { token: rememberedToken });
    assert.equal(sessionStatus.status, 200, sessionStatus.data.error);
    assert.ok(sessionStatus.data.remainingMs <= 14 * 60_000);
    const silentRefresh = await other.request('/users/refresh', { method: 'POST' });
    assert.equal(silentRefresh.status, 200, silentRefresh.data.error);
    const statusAfterRefresh = await other.request('/users/session', { token: silentRefresh.data.accessToken });
    assert.ok(statusAfterRefresh.data.remainingMs <= sessionStatus.data.remainingMs);
    const { rows: [afterRefresh] } = await pool.query('SELECT expires_at FROM account_sessions WHERE id = $1', [rememberedId]);
    assert.deepEqual(afterRefresh.expires_at, remembered.expires_at);
    const userActivity = await other.request('/users/session/activity', { method: 'POST', token: silentRefresh.data.accessToken });
    assert.equal(userActivity.status, 200, userActivity.data.error);
    assert.ok(userActivity.data.remainingMs > 29 * 60_000);
    assert.equal((await client.request('/users/me', { token: trustedToken })).status, 401);
    assert.ok(mail.has(`${user.email}:New Login Detected – Your Account Was Accessed`));

    const loginFailure = await login(other, user, 'Wrong!Password5');
    assert.equal(loginFailure.status, 401);
    const history = await adminRequest(`?search=${encodeURIComponent(user.email)}&role=student`);
    assert.equal(history.status, 200, history.data.error);
    assert.ok(history.data.entries.some((entry) => entry.login_status === 'success' && entry.otp_status === 'verified'));
    assert.ok(history.data.entries.some((entry) => entry.login_status === 'failed' && entry.otp_status === 'failed'));
    assert.ok(history.data.entries.some((entry) => entry.login_status === 'failed' && entry.otp_status === null));
    await pool.query(`INSERT INTO students (user_id, first_name, last_name, track_strand)
      VALUES ($1, 'Monitoring', 'Filter Fixture', 'STEM')`, [user.id]);
    const today = nowInManilaDateOnly();
    const filterQuery = new URLSearchParams({ search: 'monitoring filter', role: 'student',
      loginStatus: 'success', otpStatus: 'verified', from: today, to: today });
    const filtered = await adminRequest(`?${filterQuery}`);
    assert.equal(filtered.status, 200, filtered.data.error);
    assert.ok(filtered.data.entries.length > 0);
    assert.ok(filtered.data.entries.every((entry) => entry.email === user.email && entry.role === 'student'
      && entry.login_status === 'success' && entry.otp_status === 'verified'));
    filterQuery.set('to', '2000-01-01');
    assert.equal((await adminRequest(`?${filterQuery}`)).status, 400);
    filterQuery.set('from', '2000-01-01');
    const differentDate = await adminRequest(`?${filterQuery}`);
    assert.equal(differentDate.status, 200, differentDate.data.error);
    assert.deepEqual(differentDate.data.entries, []);

    const devicesPath = `?view=devices&role=student&search=${encodeURIComponent(user.email)}`;
    const devices = await adminRequest(devicesPath);
    assert.equal(devices.status, 200, devices.data.error);
    assert.equal(devices.data.entries.length, 1, 'Only the trusted browser should appear');
    const [device] = devices.data.entries;
    assert.equal(device.user_id, user.id);
    assert.equal(device.browser, 'Chrome');
    const expiredDevices = await adminRequest(`?view=devices&search=${encodeURIComponent(clients.coordinator.user.email)}`);
    assert.equal(expiredDevices.status, 200, expiredDevices.data.error);
    assert.deepEqual(expiredDevices.data.entries, []);
    assert.equal((await adminRequest(`/${user.id}/devices/${device.id}/trust`, 'DELETE')).status, 200);
    const revokedDevices = await adminRequest(devicesPath);
    assert.equal(revokedDevices.status, 200, revokedDevices.data.error);
    assert.deepEqual(revokedDevices.data.entries, []);

    const sessionsPath = `?view=sessions&role=student&search=${encodeURIComponent(user.email)}`;
    const active = await adminRequest(sessionsPath);
    assert.equal(active.status, 200, active.data.error);
    assert.equal(active.data.entries.length, 1);
    assert.equal(active.data.entries[0].browser, 'Firefox');
    assert.equal((await adminRequest(`/${user.id}/sessions/${active.data.entries[0].id}`, 'DELETE')).status, 200);
    const ended = await adminRequest(sessionsPath);
    assert.equal(ended.status, 200, ended.data.error);
    assert.deepEqual(ended.data.entries, []);
    assert.equal((await other.request('/users/me', { token: newSession.data.accessToken })).status, 401);
    assert.equal((await other.request('/users/refresh', { method: 'POST' })).status, 401);
    const { rows: actions } = await pool.query("SELECT action FROM audit_logs WHERE user_id = $1 AND module = 'login_activity'", [admin.id]);
    assert.deepEqual(actions.map(({ action }) => action).sort(), ['revoke_trusted_device', 'terminate_session']);

    const nextId = await challenge(client, user);
    const valid = codeFor(user.email);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await verify(client, nextId, valid === '000000' ? '000001' : '000000')).status, 400);
    }
    assert.equal((await verify(client, nextId, valid)).status, 400);
    assert.equal((await login(client, user)).status, 429);
    const flagged = await adminRequest(`?view=suspicious&search=${encodeURIComponent(user.email)}&otpStatus=failed`);
    assert.equal(flagged.status, 200, flagged.data.error);
    assert.ok(flagged.data.entries.some((entry) => entry.flags.includes('otp_attempt_limit')));
    assert.ok(flagged.data.entries.some((entry) => entry.flags.includes('unfamiliar_session_replacement')));
    const ordinary = await adminRequest(`?view=suspicious&search=${encodeURIComponent(admin.email)}`);
    assert.equal(ordinary.status, 200, ordinary.data.error);
    assert.deepEqual(ordinary.data.entries, []);

    const teacher = clients.teacher;
    const resetToken = randomBytes(32).toString('hex');
    const newPassword = 'Test!Reset64';
    await pool.query("INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [teacher.user.id, resetToken]);
    const reset = () => teacher.client.request('/users/reset-password', {
      method: 'POST', body: { token: resetToken, password: newPassword, confirmPassword: newPassword },
    });
    const resets = await Promise.all([reset(), reset()]);
    assert.deepEqual(resets.map(({ status }) => status).sort(), [200, 401]);
    assert.equal((await teacher.client.request('/users/me', { token: teacher.token })).status, 401);
    assert.equal((await teacher.client.request('/users/refresh', { method: 'POST' })).status, 401);
    await challenge(teacher.client, teacher.user, newPassword);

    const demoAdmin = await account('admin');
    const demoStudent = await account('student');
    process.env.LOGIN_OTP_TEST_ACCOUNTS = ` ${demoAdmin.email.toUpperCase()}, ${demoStudent.email} `;
    const demoClient = browser();
    await demoClient.init();
    assert.equal((await login(demoClient, demoAdmin, 'Wrong!Password5')).status, 401);
    const demo = await login(demoClient, demoAdmin);
    assert.equal(demo.status, 200, demo.data.error);
    assert.equal(codeFor(demoAdmin.email), undefined);
    assert.equal((await demoClient.request('/users/me', { token: demo.data.accessToken })).status, 200);
    const deviceState = await demoClient.request('/users/security/devices', { token: demo.data.accessToken });
    assert.equal(deviceState.data.devices[0].trusted, false);
    const demoHistory = await demoClient.request('/admin/login-activity?search=' + demoAdmin.email, { token: demo.data.accessToken });
    assert.ok(demoHistory.data.entries.some((entry) => entry.flags.includes('test_account_sign_in')));
    const refreshed = await demoClient.request('/users/refresh', { method: 'POST' });
    assert.equal(refreshed.status, 200, refreshed.data.error);
    const demoStudentToken = await login(demoClient, demoStudent);
    assert.equal(demoStudentToken.status, 200);
    assert.equal(codeFor(demoStudent.email), undefined);
    const unlisted = await account('student');
    await challenge(demoClient, unlisted);
    const sharedBrowser = browser();
    await sharedBrowser.init();
    const firstShared = await account('student');
    const secondShared = await account('coordinator');
    const firstChallenge = await challenge(sharedBrowser, firstShared);
    const firstVerified = await verify(sharedBrowser, firstChallenge, codeFor(firstShared.email), true);
    assert.equal(firstVerified.status, 200);
    assert.equal((await sharedBrowser.request('/users/logout', { method: 'POST', token: firstVerified.data.accessToken })).status, 200);
    await sharedBrowser.init();
    sharedBrowser.useLegacyTrustCookie();
    const migrated = await login(sharedBrowser, firstShared);
    assert.equal(migrated.status, 200);
    assert.ok(migrated.cookies.some((cookie) => /^wimTrust-[\w-]+=[^;]+;/.test(cookie)));
    assert.ok(migrated.cookies.some((cookie) => cookie.startsWith('wimTrust=;')));
    const secondChallenge = await challenge(sharedBrowser, secondShared);
    const secondVerified = await verify(sharedBrowser, secondChallenge, codeFor(secondShared.email), true);
    assert.equal(secondVerified.status, 200);
    assert.equal((await login(sharedBrowser, firstShared)).status, 200);
    assert.equal((await login(sharedBrowser, secondShared)).status, 200);
    const { sid: studentSessionId } = jwt.decode(demoStudentToken.data.accessToken);
    await pool.query("UPDATE account_sessions SET last_active_at = now() - interval '31 minutes' WHERE id = $1", [studentSessionId]);
    assert.equal((await demoClient.request('/users/session/activity', { method: 'POST', token: demoStudentToken.data.accessToken })).status, 401);
    assert.equal((await demoClient.request('/users/refresh', { method: 'POST' })).status, 401);

    const renewedDemo = await login(demoClient, demoStudent, password, true);
    assert.equal(renewedDemo.status, 200);
    const { sid: cappedSessionId } = jwt.decode(renewedDemo.data.accessToken);
    const { rows: [cap] } = await pool.query("UPDATE account_sessions SET expires_at = now() + interval '2 hours' WHERE id = $1 RETURNING expires_at", [cappedSessionId]);
    const capped = await demoClient.request('/users/refresh', { method: 'POST' });
    assert.equal(capped.status, 200, capped.data.error);
    const cappedCookie = capped.cookies.find((cookie) => cookie.startsWith('refreshToken='));
    const cappedRefresh = jwt.decode(cappedCookie.split(';')[0].slice('refreshToken='.length));
    assert.ok(cappedRefresh.exp - cappedRefresh.iat <= 7200);
    const { rows: [capAfterRotation] } = await pool.query('SELECT expires_at FROM account_sessions WHERE id = $1', [cappedSessionId]);
    assert.deepEqual(capAfterRotation.expires_at, cap.expires_at);
    await pool.query("UPDATE account_sessions SET expires_at = now() - interval '1 second' WHERE id = $1", [cappedSessionId]);
    assert.equal((await demoClient.request('/users/me', { token: capped.data.accessToken })).status, 401);
    assert.equal((await demoClient.request('/users/refresh', { method: 'POST' })).status, 401);

    const { sid: adminSessionId } = jwt.decode(adminToken);
    await pool.query("UPDATE account_sessions SET last_active_at = now() - interval '16 minutes' WHERE id = $1", [adminSessionId]);
    assert.equal((await adminClient.request('/users/session', { token: adminToken })).status, 401);
    assert.equal((await adminClient.request('/users/refresh', { method: 'POST' })).status, 401);
    process.env.NODE_ENV = 'production';
    assert.equal((await demoClient.request('/users/me', { token: refreshed.data.accessToken })).status, 401);
    assert.equal((await demoClient.request('/users/refresh', { method: 'POST' })).status, 401);
    await challenge(demoClient, demoAdmin);
  } finally {
    await getIO().close();
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
    await pool.end();
  }
});
