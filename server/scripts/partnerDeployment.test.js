// Run against an isolated local PostgreSQL database with migrations applied.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

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

test('bilateral deployment agreement, roster, attendance, and role scope', async () => {
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
      VALUES ($1, 'test', 'test', $2, $3, 80) RETURNING id`, [tag, today, dateAfter(today, 75)]);
    const school = await user('coordinator', 'coordinator', period.id);
    const host = await user('supervisor', 'supervisor', period.id);
    const outsider = await user('supervisor', 'outsider', period.id);
    const teacherAccount = await user('teacher', 'teacher', period.id);
    await query("INSERT INTO coordinators (user_id,first_name,last_name) VALUES ($1,'School','Test')", [school.id]);
    const secondTeacherAccount = await user('teacher', 'second-teacher', period.id);
    const outsideTeacherAccount = await user('teacher', 'outside-teacher', period.id);
    const outsideSchool = await user('coordinator', 'outside-coordinator', period.id);
    const teacher = await query("INSERT INTO teachers (user_id,first_name,last_name) VALUES ($1,'Teacher','Test') RETURNING id", [teacherAccount.id]);
    const secondTeacher = await query("INSERT INTO teachers (user_id,first_name,last_name) VALUES ($1,'Teacher','Two') RETURNING id", [secondTeacherAccount.id]);
    await query("INSERT INTO teachers (user_id,first_name,last_name) VALUES ($1,'Teacher','Outside')", [outsideTeacherAccount.id]);
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
      if (index !== 2) await query(`INSERT INTO student_requirement_statuses (submission_id,document_type_id,status)
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
    const legacyBatch = await query(`INSERT INTO teacher_batches (coordinator_id, teacher_id, supervisor_id, batch_label, immersion_period_id)
      SELECT id, $2, $3, 'Legacy batch', $4 FROM coordinators WHERE user_id = $1 RETURNING id`, [school.id, teacher.id, host.id, period.id]);
    const legacy = await query(`INSERT INTO deployment_requests (coordinator_id, supervisor_id, batch_label, num_students, direction, teacher_batch_id)
      VALUES ($1, $2, 'Legacy request', 1, 'coordinator_to_supervisor', $3) RETURNING id`, [school.id, host.id, legacyBatch.id]);
    await query('INSERT INTO deployment_request_students (deployment_request_id, student_id) VALUES ($1, $2)', [legacy.id, studentsById.get(eligible[3]).id]);
    await query('INSERT INTO teacher_batch_students (teacher_batch_id, student_id) VALUES ($1, $2)', [legacyBatch.id, eligible[3]]);
    await query(`INSERT INTO student_attendance (student_id, teacher_batch_id, date, status) VALUES ($1, $2, $3, 'absent')`,
      [eligible[3], legacyBatch.id, today]);
    const previousPartner = await query(
      'INSERT INTO partner_institutions (name) VALUES ($1) RETURNING id', [`${tag} Previous workflow`]);
    const previousRequest = await query(`
      INSERT INTO deployment_requests (
        coordinator_id, supervisor_id, batch_label, num_students, direction, status,
        workflow_version, partner_institution_id, teacher_id, immersion_period_id, proposal, confirmed_schedule
      ) VALUES ($1,$2,'Previous partner request',1,'coordinator_to_supervisor','approved',2,$3,$4,$5,$6,$7)
      RETURNING id`,
    [school.id, host.id, previousPartner.id, teacher.id, period.id,
      { start: weekdays[0], end: weekdays[1], dates: weekdays.slice(0, 2), capacity: 1, teacher_ids: [teacher.id] },
      { start: weekdays[0], end: weekdays[1], dates: weekdays.slice(0, 2), capacity: 1 }]);
    await pool.query(readFileSync(join(__dirname, '../db/migrations/045_deployment_agreements.sql'), 'utf8'));
    assert.ok(await query('SELECT 1 FROM retired_deployment_requests WHERE original_request_id = $1', [legacy.id]));
    assert.ok(await query('SELECT 1 FROM student_attendance WHERE teacher_batch_id = $1', [legacyBatch.id]));
    assert.ok(await query('SELECT 1 FROM teacher_batches WHERE id = $1 AND archived_at IS NOT NULL', [legacyBatch.id]));
    const transitioned = await query(
      'SELECT status, original_proposal, confirmed_schedule FROM deployment_requests WHERE id = $1', [previousRequest.id]);
    assert.equal(transitioned.status, 'changes_requested');
    assert.ok(transitioned.original_proposal);
    assert.equal(transitioned.confirmed_schedule, null);
    assert.equal((await call(studentsById.get(eligible[3]), '/placement/me')).placement, null);
    assert.equal((await call(teacherAccount, '/teacher-batches/me', 'GET', undefined, 200, 'coordinator')).batches.length, 0);
    const proposal = { partner_id: partner.id, teacher_ids: [teacher.id, secondTeacher.id],
      start: weekdays[0], end: weekdays[3], capacity: 2, strands: ['STEM'], worksite: 'Main office', notes: 'Report to reception',
      student_ids: eligible.slice(0, 2), creation_key: randomUUID() };
    const create = async (overrides = {}) => {
      const result = await call(school, prefix, 'POST', { ...proposal, creation_key: randomUUID(), ...overrides });
      return prefix + '/' + result.id;
    };
    const read = (actor, path) => call(actor, path);
    const amend = (actor, path, action, body, expected) => call(actor, path + '/' + action, 'PUT', body, expected);
    await call(school, prefix, 'POST', { ...proposal, teacher_ids: [] }, 400);
    await call(school, prefix, 'POST', { ...proposal, student_ids: [eligible[0], eligible[0]] }, 400);
    await call(school, prefix, 'POST', { ...proposal, student_ids: [eligible[2]] }, 409);
    await call(school, prefix, 'POST', { ...proposal, capacity: 1 }, 409);
    const draft = await create({ draft: true, start: '', capacity: '', student_ids: [] });
    assert.equal((await read(school, draft)).request.status, 'draft');
    await call(host, draft, 'GET', undefined, 404);
    await amend(school, draft, 'finalize', { revision: 0 }, 409);
    await amend(school, draft, 'resubmit', { ...proposal, revision: 0, draft: true });
    await amend(school, draft, 'resubmit', { ...proposal, revision: 1 });
    const submitted = (await read(school, draft)).request.proposal;
    assert.equal(submitted.end, weekdays[9]);
    assert.equal(submitted.dates.length, 10);
    assert.equal(submitted.required_hours, 80);
    assert.equal(submitted.daily_hours, 8);
    assert.equal((await read(host, draft)).request.status, 'pending');
    await call(outsider, draft, 'GET', undefined, 404);
    await call(outsideSchool, draft, 'GET', undefined, 404);
    await amend(school, draft, 'review', { revision: 2, status: 'approved' }, 404);
    await amend(host, draft, 'schedule', { revision: 2 }, 404);
    await amend(host, draft, 'review', { revision: 2, status: 'counterproposal', start: weekdays[1], capacity: 2, reason: 'Site unavailable on first date' });
    let result = await read(school, draft);
    assert.equal(result.request.status, 'pending_coordinator_agreement');
    assert.equal(result.request.counterproposal.start, weekdays[1]);
    assert.equal(result.request.counterproposal.end, weekdays[10]);
    assert.equal(result.request.counterproposal.dates.length, 10);
    assert.equal(result.request.confirmed_schedule, null);
    await amend(school, draft, 'counterproposal-decision', { revision: 3, decision: 'reject', reason: 'Transport unavailable' });
    assert.equal((await read(school, draft)).request.status, 'changes_requested');
    await amend(school, draft, 'resubmit', { ...proposal, revision: 4 });
    await amend(host, draft, 'review', { revision: 5, status: 'counterproposal', start: weekdays[0], capacity: 1, reason: 'Fewer available places' });
    await amend(school, draft, 'counterproposal-decision', { revision: 6, decision: 'accept' }, 409);
    await amend(school, draft, 'counterproposal-decision', { revision: 6, decision: 'accept', student_ids: [eligible[0]] });
    result = await read(school, draft);
    assert.equal(result.request.status, 'approved');
    assert.equal(result.request.agreement.coordinator_id, school.id);
    assert.equal(result.request.agreement.supervisor_id, host.id);
    assert.equal(result.request.original_proposal.end, weekdays[9]);
    assert.equal(result.request.confirmed_schedule.capacity, 1);
    assert.equal(result.request.confirmed_schedule.required_hours, 80);
    assert.equal(result.request.confirmed_schedule.daily_hours, 8);
    assert.equal(result.request.teacher_batch_id, null);
    await amend(school, draft, 'finalize', { revision: 7, student_ids: eligible.slice(0, 2) }, 409);
    await amend(school, draft, 'finalize', { revision: 7, student_ids: [eligible[2]] }, 409);
    await amend(school, draft, 'finalize', { revision: 7 });
    result = await read(school, draft);
    const batch = result.request.teacher_batch_id;
    const student = studentsById.get(eligible[0]);
    assert.deepEqual(result.roster.map(({ id }) => id), [eligible[0]]);
    assert.deepEqual((await call(host, '/batches')).batches[0].confirmed_schedule.dates, weekdays.slice(0, 10));
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(0, 10));
    await call(outsider, '/batches/' + batch + '/attendance', 'GET', undefined, 404);
    await call(host, '/teacher/batch/' + batch + '/open', 'POST', undefined, 409, 'attendance');
    await call(host, '/teacher/batch/' + batch + '/schedules', 'PUT', {}, 404, 'attendance');
    await assert.rejects(query(`INSERT INTO student_attendance (student_id, teacher_batch_id, date, status)
      VALUES ($1,$2,$3,'absent')`, [eligible[0], batch, today]), { code: '23514' });
    assert.equal((await call(teacherAccount, '/teacher-batches/me', 'GET', undefined, 200, 'coordinator')).batches[0].id, batch);
    assert.equal((await call(secondTeacherAccount, '/teacher-batches/me', 'GET', undefined, 200, 'coordinator')).batches[0].id, batch);
    assert.equal((await call(secondTeacherAccount, '/teacher-batches/' + batch + '/students', 'GET', undefined, 200, 'coordinator')).students[0].student_id, eligible[0]);
    await call(outsideTeacherAccount, '/teacher-batches/' + batch + '/students', 'GET', undefined, 403, 'coordinator');
    const placement = (await call(student, '/placement/me')).placement;
    assert.deepEqual(placement.attendance_dates, weekdays.slice(0, 10));
    assert.equal(placement.instructions, 'Report to reception');
    assert.equal(placement.teachers.length, 2);
    assert.equal((await call(studentsById.get(eligible[1]), '/placement/me')).placement, null);
    assert.deepEqual((await getStudentSchedules(eligible[0]))[0].attendance_dates.split(','), weekdays.slice(0, 10));
    const counterBoth = await create({ student_ids: [] });
    await amend(host, counterBoth, 'review', { revision: 0, status: 'counterproposal', start: weekdays[1], capacity: 1, reason: 'Site calendar and capacity' });
    await amend(school, counterBoth, 'resubmit', { ...proposal, student_ids: [], revision: 1 });
    await amend(host, counterBoth, 'review', { revision: 2, status: 'approved' });
    await amend(school, counterBoth, 'finalize', { revision: 3, student_ids: [eligible[0]] }, 409);
    const next = await create({ student_ids: [eligible[1]], capacity: 1 });
    await amend(host, next, 'review', { revision: 0, status: 'approved' });
    const outcomes = await Promise.all([
      amend(school, next, 'finalize', { revision: 1, student_ids: [eligible[1]] }, null),
      amend(school, counterBoth, 'finalize', { revision: 3, student_ids: [eligible[1]] }, null),
    ]);
    assert.deepEqual(outcomes.toSorted(), [200, 409]);
    const rejected = await create({ student_ids: [] });
    await amend(host, rejected, 'review', { revision: 0, status: 'rejected', reason: 'Site unavailable' });
    assert.equal((await read(school, rejected)).request.status, 'rejected');
    const cancelled = await create({ student_ids: [] });
    await amend(school, cancelled, 'cancel', { revision: 0, reason: 'School request withdrawn' });
    assert.equal((await read(host, cancelled)).request.status, 'cancelled');
    await amend(host, draft, 'amendment', { revision: 8, start: weekdays[1], reason: 'Additional training day' });
    await amend(host, draft, 'amendment-decision', { revision: 9, decision: 'accept' }, 409);
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(0, 10));
    await amend(school, draft, 'amendment-decision', { revision: 9, decision: 'accept' });
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(1, 11));
    assert.deepEqual((await call(student, '/student/schedule', 'GET', undefined, 200, 'attendance')).schedules[0].attendance_dates.split(','), weekdays.slice(1, 11));
    await amend(school, draft, 'amendment', { revision: 10, start: weekdays[2], reason: 'School calendar update' });
    await amend(host, draft, 'amendment-decision', { revision: 11, decision: 'reject', reason: 'Site closed' });
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(1, 11));
    await query(`INSERT INTO student_daily_documentation (student_id, teacher_batch_id, date, day_number, reasoning, status)
      VALUES ($1,$2,$3,1,'Preserved evidence','submitted')`, [eligible[0], batch, weekdays[0]]);
    const trail = (await read(school, draft)).history;
    assert.ok(trail.some(({ action, after_state }) => action === 'counterproposal_accepted' && after_state.agreement.supervisor_id === host.id));
    await call(school, '/deployment-requests/me', 'GET', undefined, 404);
    await assert.rejects(archivePeriod(period.id, school.id), { status: 409 });
    for (const open of [draft, next, counterBoth]) {
      const { request } = await read(school, open);
      await amend(school, open, 'cancel', { revision: request.revision, reason: 'Close test deployment' });
    }
    const archive = await archivePeriod(period.id, school.id);
    assert.ok(await query('SELECT 1 FROM archive_deployment_requests WHERE archive_period_id = $1 AND original_request_id = $2', [archive.archiveId, result.request.id]));
    assert.ok(await query('SELECT 1 FROM users WHERE id = $1', [host.id]));
  } finally {
    await getIO().close();
    await pool.end();
  }
});
