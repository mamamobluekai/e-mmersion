// Run against an isolated local PostgreSQL database with migrations applied.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.pathname.endsWith('_test'),
  'DATABASE_URL must point to an isolated local *_test database.');
process.env.DB_SSL = 'false';
process.env.JWT_SECRET = 'local-integration-test-only';

const jwt = require('jsonwebtoken');
const pool = require('../db');
const { nowInManilaDateOnly } = require('../utils/manilaDate');
const { dateAfter } = require('../services/partnerDeploymentPolicy');
const { getStudentSchedules } = require('../controllers/teacherControllers/immersionSchedule.controller');
const { loadExcludedDates } = require('../utils/immersionDays');
const { initializeSocket, getIO } = require('../sockets');
const { getPreImmersion } = require('../services/studentJourney.service');
const { archivePeriod } = require('../services/periodArchive.service');

test('partner request, supervisor confirmation, school clearance, and concurrent roster updates', async () => {
  const app = require('../app');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  initializeSocket(server);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const health = await fetch(`${base}/health`);
  await health.json();
  const cookie = health.headers.getSetCookie().find((value) => value.startsWith('csrfToken=')).split(';')[0];
  const csrf = cookie.slice('csrfToken='.length);
  const tag = randomUUID();
  const today = nowInManilaDateOnly();
  const seventh = dateAfter(today, 7);
  const prefix = '/partner-deployments';
  const { holidays } = await loadExcludedDates(null, null);
  const weekdays = Array.from({ length: 40 }, (_, index) => dateAfter(seventh, index))
    .filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && !holidays.has(date));

  async function query(sql, params = []) {
    return (await pool.query(sql, params)).rows[0];
  }
  async function user(role, alias, period) {
    return query(`INSERT INTO users (email,password,role,status,terms_accepted,immersion_period_id)
      VALUES ($1,'test-only',$2,'approved',true,$3) RETURNING id, email, role`, [`${alias}-${tag}@example.test`, role, period]);
  }
  async function call(actor, path, method = 'GET', body, expected = 200, role = actor.role) {
    const token = jwt.sign({ id: actor.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const response = await fetch(`${base}/${role}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (expected !== null) assert.equal(response.status, expected, JSON.stringify(data));
    return expected === null ? response.status : data;
  }
  try {
    const period = await query(`INSERT INTO immersion_periods (period_name, academic_year, semester, start_date, end_date, required_hours)
      VALUES ($1, 'test', 'test', $2, $3, 16) RETURNING id`, [tag, today, dateAfter(today, 75)]);
    const school = await user('coordinator', 'coordinator', period.id);
    const host = await user('supervisor', 'supervisor', period.id);
    const outsider = await user('supervisor', 'outsider', period.id);
    const teacherAccount = await user('teacher', 'teacher', period.id);
    await query("INSERT INTO coordinators (user_id,first_name,last_name) VALUES ($1,'School','Test')", [school.id]);
    const teacher = await query("INSERT INTO teachers (user_id,first_name,last_name) VALUES ($1,'Teacher','Test') RETURNING id", [teacherAccount.id]);
    for (const account of [host, outsider]) {
      await query("INSERT INTO supervisors (user_id,first_name,last_name,company_name) VALUES ($1,'Supervisor','Test',$2)",
        [account.id, account.email]);
    }
    const partner = await query("INSERT INTO partner_institutions (name,address) VALUES ($1,'Main office') RETURNING id", [tag]);
    const empty = await query("INSERT INTO partner_institutions (name) VALUES ($1) RETURNING id", [`${tag} Unassigned`]);
    const eligible = [];
    const studentsById = new Map();
    await getPreImmersion(0);
    for (const [index, status] of ['Approved', 'Approved', 'Submitted', 'Approved'].entries()) {
      const account = await user('student', `student-${index}`, period.id);
      const student = await query(`INSERT INTO students (user_id,first_name,last_name,track_strand)
        VALUES ($1,'Student',$2,'STEM') RETURNING id`, [account.id, String(index)]);
      const submission = await query('INSERT INTO student_requirement_submissions (student_id,user_id,status,progress) VALUES ($1,$2,$3,100) RETURNING id',
        [student.id, account.id, status]);
      if (index < 3) await query(`INSERT INTO student_requirement_statuses (submission_id,document_type_id,status)
        SELECT $1,id,'APPROVED' FROM document_types WHERE COALESCE(is_active,true)`, [submission.id]);
      eligible.push(student.id);
      studentsById.set(student.id, account);
    }
    const listing = await call(school, `${prefix}/partners?search=${tag}`);
    assert.ok(listing.partners.some((item) => item.id === empty.id && item.request_count === 0));
    const registerSupervisor = (institution, account) => query(`
      INSERT INTO partner_institution_supervisor_history
        (institution_id, supervisor_user_id, supervisor_first_name, supervisor_last_name, supervisor_email)
      VALUES ($1,$2,'Supervisor','Test',$3)`, [institution.id, account.id, account.email]);
    await registerSupervisor(partner, host);
    const proposal = { partner_id: partner.id, teacher_id: teacher.id, period_id: period.id,
      start: weekdays[0], end: weekdays[3], capacity: 2, strands: ['STEM'], worksite: 'Main office', creation_key: randomUUID() };
    await query("UPDATE users SET status = 'disapproved' WHERE id = $1", [host.id]);
    await call(school, prefix, 'POST', proposal, 409);
    await query("UPDATE users SET status = 'pending_activation' WHERE id = $1", [host.id]);
    const setup = await call(school, `${prefix}/options?partner=${partner.id}`);
    assert.ok(setup.authorised.some(({ id, primary, account_status }) =>
      id === host.id && primary && account_status === 'pending_activation'));
    await call(school, prefix, 'POST', { ...proposal, start: dateAfter(today, 6) }, 400);
    const sent = await call(school, prefix, 'POST', proposal);
    assert.equal((await call(school, prefix, 'POST', proposal)).id, sent.id);
    assert.equal((await call(school, `${prefix}/partners/${partner.id}`)).partner.has_unresolved_request, true);
    await call(school, prefix, 'POST', { ...proposal, creation_key: randomUUID() }, 409);
    const path = `${prefix}/${sent.id}`;
    assert.equal((await call(school, path)).request.supervisor_id, host.id);
    await call(host, path, 'GET', undefined, 403);
    await query("UPDATE users SET status = 'approved' WHERE id = $1", [host.id]);
    assert.ok((await call(host, prefix)).requests.some((item) => item.id === sent.id));
    const prior = await query(`INSERT INTO deployment_requests (coordinator_id,supervisor_id,batch_label,num_students,direction)
      VALUES ($1,$2,'Legacy request',1,'coordinator_to_supervisor') RETURNING id`, [school.id, host.id]);
    await call(outsider, path, 'GET', undefined, 404);
    await call(school, `/partner-institutions/${partner.id}/deactivate`, 'POST', undefined, 409);
    await call(host, `${path}/schedule`, 'PUT', { revision: 0 }, 409);
    await call(school, `${path}/candidates`, 'GET', undefined, 409);
    await call(host, `${path}/review`, 'PUT', { revision: 0, status: 'changes_requested', reason: 'Confirm worksite' });
    await call(school, `${path}/resubmit`, 'PUT', { revision: 1, ...proposal, supervisor_id: outsider.id });
    await call(host, `${path}/review`, 'PUT', { revision: 2, status: 'approved' });
    assert.equal((await call(school, `${prefix}/partners/${partner.id}`)).partner.has_unresolved_request, false);
    const followup = await call(school, prefix, 'POST', { ...proposal, creation_key: randomUUID() });
    const legacy = (await call(school, '/deployment-requests/me')).deployment_requests;
    assert.ok(legacy.some((item) => item.id === prior.id));
    assert.ok(legacy.every((item) => item.id !== sent.id));
    await call(host, `/deployment-requests/${sent.id}/reject`, 'PUT', { reason: 'Wrong flow' }, 404, 'coordinator');
    const windows = { time_in_open: '08:00', time_in_close: '08:30', time_out_open: '17:00', time_out_close: '17:30' };
    const schedule = { start: weekdays[0], end: weekdays[2], capacity: 1, strands: ['STEM'],
      caps: { stem: 1 }, daily_hours: 8, windows };
    await call(host, `${path}/schedule`, 'PUT', { ...schedule, revision: 3 });
    await call(school, `${path}/candidates`, 'GET', undefined, 409);
    const checks = Object.fromEntries(['partner_agreement','worksite_safety','training_plan','learner_safeguards'].map((key) => [key, true]));
    await call(school, `${path}/clearance`, 'PUT', { revision: 4, reference: 'MNHS test clearance', checks });
    assert.deepEqual((await call(school, `${path}/candidates`)).students.map((item) => item.id).sort(), eligible.slice(0, 2).sort());
    const requests = await Promise.all(eligible.slice(0, 2).map((id) =>
      call(school, `${path}/roster`, 'PUT', { revision: 5, add: id }, null)));
    assert.deepEqual(requests.toSorted(), [200, 409]);
    const allocated = await call(school, path);
    const active = allocated.roster.find((member) => !member.deployment_ended_on);
    const replacement = eligible.slice(0, 2).find((id) => id !== active.id);
    assert.equal(allocated.allocation_status, 'fully_filled');
    assert.deepEqual((await getStudentSchedules(active.id))[0].attendance_dates.split(','), weekdays.slice(0, 3));
    await call(school, `${path}/roster`, 'PUT', { revision: 6, remove: active.id, add: replacement, reason: 'Student moved sections' });
    const evidence = await query(`
      INSERT INTO student_daily_documentation (student_id,teacher_batch_id,date,day_number,reasoning,status)
      VALUES ($1,$2,$3,2,'Preserved evidence','submitted') RETURNING id`,
    [replacement, allocated.request.teacher_batch_id, weekdays[1]]);
    const amended = { ...schedule, end: weekdays[3], excluded_dates: [weekdays[1]], reason: 'Worksite closed for one day' };
    await call(host, `${path}/schedule`, 'PUT', { revision: 7, ...amended });
    assert.deepEqual((await getStudentSchedules(replacement))[0].attendance_dates.split(','), weekdays.slice(0, 3));
    await call(school, `${path}/clearance`, 'PUT', { revision: 8, reference: 'MNHS amendment', checks });
    assert.deepEqual((await getStudentSchedules(replacement))[0].attendance_dates.split(','), [weekdays[0], weekdays[2], weekdays[3]]);
    assert.deepEqual(await getStudentSchedules(active.id), []);
    assert.ok(await query('SELECT 1 FROM student_daily_documentation WHERE id = $1', [evidence.id]));
    const final = await call(school, path);
    assert.deepEqual(final.history.map((entry) => entry.action), [
      'amendment_cleared', 'amendment_proposed', 'student_replaced', 'student_allocated', 'school_cleared',
      'schedule_confirmed', 'approved', 'resubmitted', 'changes_requested', 'submitted',
    ]);
    assert.equal(final.request.confirmed_schedule.capacity, 1);
    await call(school, `/teacher-batches/${final.request.teacher_batch_id}/assign`, 'POST', { student_ids: [] }, 409);
    await call(host, `/teacher/batch/${final.request.teacher_batch_id}/schedules`, 'PUT', {}, 409, 'attendance');
    const student = studentsById.get(replacement);
    const studentSchedule = await call(student, '/student/schedule', 'GET', undefined, 200, 'attendance');
    assert.deepEqual(studentSchedule.schedules[0].attendance_dates.split(','), [weekdays[0], weekdays[2], weekdays[3]]);

    await assert.rejects(registerSupervisor(empty, host), { code: '23505', constraint: 'idx_partner_supervisor_one_active_assignment' });
    await query(`INSERT INTO partner_deployment_supervisors (institution_id,supervisor_user_id,reason)
      VALUES ($1,$2,'Historical affiliation fixture')`, [empty.id, host.id]);
    const otherProposal = { ...proposal, partner_id: empty.id, creation_key: randomUUID(), supervisor_id: host.id };
    await call(school, prefix, 'POST', otherProposal, 409);
    await registerSupervisor(empty, outsider);
    const other = await call(school, prefix, 'POST', otherProposal);
    const otherPath = `${prefix}/${other.id}`;
    await call(host, otherPath, 'GET', undefined, 404);
    await call(outsider, `${otherPath}/review`, 'PUT', { revision: 0, status: 'approved' });
    await call(outsider, `${otherPath}/schedule`, 'PUT', { ...schedule, revision: 1 }, 409);
    await call(outsider, `${otherPath}/schedule`, 'PUT', { ...schedule, revision: 1, acknowledge_overlap: true });
    await call(school, `${otherPath}/clearance`, 'PUT', { revision: 2, reference: 'Second placement clearance', checks });
    await call(school, `${otherPath}/roster`, 'PUT', { revision: 3, add: replacement }, 409);
    const supervisorBatches = (await call(host, '/batches')).batches;
    assert.deepEqual(supervisorBatches.filter((batch) => batch.partner_request_id)
      .map((batch) => batch.partner_request_id), [sent.id]);
    await call(school, `${path}/cancel`, 'PUT', { revision: 9, reason: 'Test placement cancelled before its start' });
    await call(school, `${prefix}/${followup.id}/cancel`, 'PUT', { revision: 0, reason: 'Test follow-up request cancelled' });
    await call(school, `${otherPath}/cancel`, 'PUT', { revision: 3, reason: 'Test placement cancelled before its start' });
    const archive = await archivePeriod(period.id, school.id);
    const snapshot = await query(`SELECT partner_deployment FROM archive_deployment_requests
      WHERE archive_period_id = $1 AND original_request_id = $2`, [archive.archiveId, sent.id]);
    assert.equal(snapshot.partner_deployment.confirmed_schedule.capacity, 1);
    assert.equal(snapshot.partner_deployment.history.at(-1).action, 'cancelled');
    assert.ok(await query('SELECT 1 FROM users WHERE id = $1', [host.id]));
  } finally {
    await getIO().close();
    await pool.end();
  }
});
