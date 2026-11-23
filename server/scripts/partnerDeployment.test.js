// Run against an isolated local PostgreSQL database with migrations applied.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Writable } = require('node:stream');

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
    await query("INSERT INTO coordinators (user_id,first_name,last_name,school,department) VALUES ($1,'School','Test','Test High School','Senior High School')", [school.id]);
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
    // Restore the pre-agreement schema for this fixture before rerunning migration 045.
    await pool.query('ALTER TABLE deployment_requests DROP CONSTRAINT IF EXISTS deployment_requests_agreement_state');
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
    const stagePartners = async (stage, requestingStage = '') =>
      (await read(school, `${prefix}/partners?search=${tag}&stage=${stage}&requesting_stage=${requestingStage}`)).partners;
    const includesPartner = (items) => items.some(({ id }) => id === partner.id);
    const requestingPartner = async () => (await stagePartners('requesting')).find(({ id }) => id === partner.id);
    const supervisorRequests = async (stage) => (await read(host, `${prefix}?requesting_stage=${stage}`)).requests;
    assert.ok(includesPartner(await stagePartners('no_request')));
    await call(school, prefix, 'POST', { ...proposal, teacher_ids: [] }, 400);
    await call(school, prefix, 'POST', { ...proposal, student_ids: [eligible[0], eligible[0]] }, 400);
    await call(school, prefix, 'POST', { ...proposal, student_ids: [eligible[2]] }, 409);
    await call(school, prefix, 'POST', { ...proposal, capacity: 1 }, 409);
    const rejected = await create({ student_ids: [] });
    await amend(host, rejected, 'review', { revision: 0, status: 'rejected', reason: 'Site unavailable' });
    assert.equal((await read(school, rejected)).request.status, 'rejected');
    assert.ok(includesPartner(await stagePartners('no_request')));
    const cancelled = await create({ student_ids: [] });
    const submittedRequest = (await read(school, cancelled)).request;
    assert.equal((await requestingPartner()).open_request_id, submittedRequest.id);
    await amend(school, cancelled, 'cancel', { revision: 0, reason: 'School request withdrawn' });
    assert.equal((await read(host, cancelled)).request.status, 'cancelled');
    assert.equal(await requestingPartner(), undefined);
    assert.ok(includesPartner(await stagePartners('no_request')));
    const abandonedDraft = await create({ draft: true, start: '', capacity: '', student_ids: [] });
    const abandonedRequest = (await read(school, abandonedDraft)).request;
    assert.equal((await requestingPartner()).open_request_id, abandonedRequest.id);
    await amend(school, abandonedDraft, 'cancel', { revision: abandonedRequest.revision, reason: 'Draft withdrawn' });
    assert.equal((await read(school, abandonedDraft)).request.status, 'cancelled');
    assert.equal(await requestingPartner(), undefined);
    assert.ok(includesPartner(await stagePartners('no_request')));
    const cancelledHistory = await read(school, `${prefix}?status=cancelled`);
    assert.ok(cancelledHistory.requests.some(({ id }) => id === submittedRequest.id));
    assert.ok(cancelledHistory.requests.some(({ id }) => id === abandonedRequest.id));
    assert.ok(cancelledHistory.requests.every(({ status }) => status === 'cancelled'));
    const draft = await create({ draft: true, start: '', capacity: '', student_ids: [], worksite: 'Alternate address' });
    const draftRequest = (await read(school, draft)).request;
    assert.equal(draftRequest.status, 'draft');
    assert.equal(draftRequest.proposal.worksite, 'Main office');
    assert.equal((await requestingPartner()).open_request_id, draftRequest.id);
    assert.ok(includesPartner(await stagePartners('requesting', 'in_progress')));
    assert.equal((await supervisorRequests('in_progress')).some(({ id }) => id === draftRequest.id), false);
    assert.equal(includesPartner(await stagePartners('no_request')), false);
    await call(host, draft, 'GET', undefined, 404);
    await amend(school, draft, 'finalize', { revision: 0 }, 409);
    await amend(school, draft, 'resubmit', { ...proposal, revision: 0, draft: true });
    await amend(school, draft, 'resubmit', { ...proposal, revision: 1, worksite: 'Alternate address' });
    const submitted = (await read(school, draft)).request.proposal;
    assert.equal(submitted.worksite, 'Main office');
    assert.equal(submitted.end, weekdays[9]);
    assert.equal(submitted.dates.length, 10);
    assert.equal(submitted.required_hours, 80);
    assert.equal(submitted.daily_hours, 8);
    assert.equal((await read(host, draft)).request.status, 'pending');
    assert.ok(includesPartner(await stagePartners('requesting', 'in_progress')));
    assert.ok((await supervisorRequests('in_progress')).some(({ id }) => id === draftRequest.id));
    await call(outsider, draft, 'GET', undefined, 404);
    await call(outsideSchool, draft, 'GET', undefined, 404);
    await amend(school, draft, 'review', { revision: 2, status: 'approved' }, 404);
    await amend(host, draft, 'schedule', { revision: 2 }, 404);
    await amend(host, draft, 'review', { revision: 2, status: 'counterproposal', start: weekdays[1], capacity: 2, reason: 'Site unavailable on first date' });
    let result = await read(school, draft);
    assert.equal(result.request.status, 'pending_coordinator_agreement');
    assert.equal(result.request.requesting_stage, 'changes_requested');
    assert.ok(includesPartner(await stagePartners('requesting', 'changes_requested')));
    assert.equal(includesPartner(await stagePartners('requesting', 'in_progress')), false);
    assert.ok((await supervisorRequests('changes_requested')).some(({ id }) => id === draftRequest.id));
    assert.equal((await supervisorRequests('in_progress')).some(({ id }) => id === draftRequest.id), false);
    assert.equal(result.request.counterproposal.start, weekdays[1]);
    assert.equal(result.request.counterproposal.end, weekdays[10]);
    assert.equal(result.request.counterproposal.dates.length, 10);
    assert.equal(result.request.confirmed_schedule, null);
    await amend(school, draft, 'counterproposal-decision', { revision: 3, decision: 'reject', reason: 'Transport unavailable' });
    assert.equal((await read(school, draft)).request.status, 'changes_requested');
    assert.ok(includesPartner(await stagePartners('requesting', 'changes_requested')));
    await amend(school, draft, 'resubmit', { ...proposal, revision: 4 });
    assert.ok(includesPartner(await stagePartners('requesting', 'in_progress')));
    assert.ok((await supervisorRequests('in_progress')).some(({ id }) => id === draftRequest.id));
    await amend(host, draft, 'review', { revision: 5, status: 'counterproposal', start: weekdays[0], capacity: 1, reason: 'Fewer available places' });
    await amend(school, draft, 'counterproposal-decision', { revision: 6, decision: 'accept' }, 409);
    await amend(school, draft, 'counterproposal-decision', { revision: 6, decision: 'accept', student_ids: [eligible[0]] });
    result = await read(school, draft);
    assert.equal(result.request.status, 'approved');
    assert.ok((await supervisorRequests('history')).some(({ id }) => id === draftRequest.id));
    assert.equal(result.request.agreement.coordinator_id, school.id);
    assert.equal(result.request.agreement.supervisor_id, host.id);
    assert.equal(result.request.original_proposal.end, weekdays[9]);
    assert.equal(result.request.confirmed_schedule.capacity, 1);
    assert.equal(result.request.confirmed_schedule.required_hours, 80);
    assert.equal(result.request.confirmed_schedule.daily_hours, 8);
    assert.equal(result.request.teacher_batch_id, null);
    assert.ok(includesPartner(await stagePartners('approved')));
    assert.equal(includesPartner(await stagePartners('completed')), false);
    const approvedPartners = await read(school, `${prefix}/partners?search=${tag}`);
    assert.equal(approvedPartners.partners.find(({ id }) => id === partner.id).active_request_id, result.request.id);
    assert.equal((await read(school, `${prefix}/partners/${partner.id}`)).partner.active_request_id, result.request.id);
    const preferenceStudent = studentsById.get(eligible[2]);
    const requirementForm = await call(preferenceStudent, '/requirements/me');
    assert.ok(requirementForm.partnerInstitutions.some(({ id }) => id === partner.id));
    await call(preferenceStudent, '/requirements/me', 'PUT', { preferred_partner_institution_id: partner.id + 99999 }, 400);
    await call(preferenceStudent, '/requirements/me', 'PUT', { preferred_partner_institution_id: partner.id });
    assert.equal((await query('SELECT preferred_partner_institution_id FROM students WHERE id = $1', [eligible[2]])).preferred_partner_institution_id, partner.id);
    const approvedPreferenceStudent = studentsById.get(eligible[3]);
    await call(approvedPreferenceStudent, '/requirements/me/partner-preference', 'PUT', { preferred_partner_institution_id: partner.id });
    assert.equal((await call(approvedPreferenceStudent, '/requirements/me/status')).submission.status, 'Approved');
    const prioritized = await read(school, draft + '/assignment-candidates');
    assert.equal(prioritized.students[0].id, eligible[3]);
    assert.equal(prioritized.students[0].preferred_match, true);
    assert.ok(prioritized.students.some(({ id }) => id === eligible[1]));
    assert.equal(prioritized.students.some(({ id }) => id === eligible[2]), false);
    await call(school, prefix, 'POST', { ...proposal, creation_key: randomUUID(), student_ids: [] }, 409);
    await amend(school, draft, 'finalize', { revision: 7, student_ids: eligible.slice(0, 2) }, 409);
    await amend(school, draft, 'finalize', { revision: 7, student_ids: [eligible[2]] }, 409);
    await amend(school, draft, 'finalize', { revision: 7 });
    result = await read(school, draft);
    assert.equal(result.request.teacher_batch_id, null);
    assert.equal(includesPartner(await stagePartners('approved')), false);
    assert.equal((await call(studentsById.get(eligible[0]), '/placement/me')).assignment.status, 'pending');
    await amend(outsider, draft, 'review-students', { revision: 8, decisions: [{ student_id: eligible[0], status: 'accepted' }] }, 404);
    await amend(host, draft, 'review-students', { revision: 8, decisions: [{ student_id: eligible[0], status: 'accepted' }] });
    result = await read(school, draft);
    assert.equal(result.request.teacher_batch_id, null);
    assert.ok((await stagePartners('completed')).some(({ deployment_request_id }) => deployment_request_id === result.request.id));
    assert.equal(includesPartner(await stagePartners('approved')), false);
    const student = studentsById.get(eligible[0]);
    assert.deepEqual(await getStudentSchedules(eligible[0]), []);
    assert.equal((await call(student, '/placement/me')).assignment.status, 'accepted');
    assert.equal((await call(student, '/journey')).stages.immersion, 'locked');
    assert.deepEqual((await call(teacherAccount, '/teacher-partner-institutions/me', 'GET', undefined, 200, 'coordinator')).institutions, []);
    assert.deepEqual((await call(host, '/batches')).batches, []);
    const firstSelection = { request_ids: [result.request.id], creation_key: randomUUID() };
    const { batch: firstBatch } = await call(school, prefix + '/batches', 'POST', firstSelection);
    assert.equal(firstBatch.name, 'BATCH - 1');
    assert.deepEqual((await call(school, prefix + '/batches', 'POST', firstSelection)).batch, firstBatch);
    await call(school, prefix + '/batches', 'POST', { ...firstSelection, creation_key: randomUUID() }, 409);
    assert.deepEqual((await read(outsideSchool, prefix + '/batches')).batches, []);
    assert.equal(includesPartner(await stagePartners('completed')), false);
    result = await read(school, draft);
    const batch = result.request.teacher_batch_id;
    assert.equal(result.request.coordinator_batch_id, firstBatch.id);
    assert.equal((await call(student, '/journey')).stages.immersion, 'active');
    assert.deepEqual(result.roster.map(({ id }) => id), [eligible[0]]);
    assert.deepEqual((await call(host, '/batches')).batches[0].confirmed_schedule.dates, weekdays.slice(0, 10));
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(0, 10));
    await call(outsider, '/batches/' + batch + '/attendance', 'GET', undefined, 404);
    await call(host, '/teacher/batch/' + batch + '/open', 'POST', undefined, 409, 'attendance');
    await call(host, '/teacher/batch/' + batch + '/schedules', 'PUT', {}, 404, 'attendance');
    await assert.rejects(query(`INSERT INTO student_attendance (student_id, teacher_batch_id, date, status)
      VALUES ($1,$2,$3,'absent')`, [eligible[0], batch, today]), { code: '23514' });
    assert.equal((await call(teacherAccount, '/teacher-batches/me', 'GET', undefined, 200, 'coordinator')).batches[0].id, batch);
    const teacherInstitutions = (await call(teacherAccount, '/teacher-partner-institutions/me', 'GET', undefined, 200, 'coordinator')).institutions;
    assert.equal(teacherInstitutions.find(({ id }) => id === partner.id).supervisor_name, 'Supervisor Test');
    const overviewPath = `/teacher-partner-institutions/${partner.id}/overview`;
    const teacherOverview = (actor, expected = 200) => call(actor, overviewPath, 'GET', undefined, expected, 'coordinator');
    assert.notEqual(partner.id, batch);
    const initialOverview = { student_count: 1, present_count: 0, documentation: [
      { student_id: eligible[0], total_docs: 0, graded_count: 0, pending_count: 0 },
    ] };
    assert.deepEqual(await teacherOverview(teacherAccount), initialOverview);
    assert.deepEqual(await teacherOverview(secondTeacherAccount), initialOverview);
    await teacherOverview(outsideTeacherAccount, 403);
    const { institutions: reportInstitutions } = await read(host, '/partner-institutions');
    assert.deepEqual(reportInstitutions.map(({ id }) => id), [partner.id]);
    const institutionRoster = `/partner-institutions/${partner.id}/students`;
    assert.deepEqual((await read(host, institutionRoster)).students.map(({ student_id }) => student_id), [eligible[0]]);
    assert.deepEqual((await read(outsider, institutionRoster)).students, []);
    const reportPath = '/reports-concerns';
    const teacherReportPath = '/teacher/reports-concerns';
    const concern = { partner_institution_id: partner.id, student_id: eligible[0],
      category: 'Attendance', priority: 'high', message: 'Review the attendance record.' };
    await call(outsider, reportPath, 'POST', concern, 404);
    await call(host, reportPath, 'POST', { ...concern, partner_institution_id: empty.id }, 404);
    await call(host, reportPath, 'POST', { ...concern, student_id: eligible[1] }, 404);
    const { report } = await call(host, reportPath, 'POST', concern, 201);
    assert.equal(report.partner_institution_id, partner.id);
    assert.equal(report.teacher_id, teacher.id);
    assert.equal(report.batch_id, batch);
    assert.deepEqual((await read(outsider, reportPath)).reports, []);
    assert.deepEqual((await call(outsideTeacherAccount, teacherReportPath, 'GET', undefined, 200, 'coordinator')).reports, []);
    const { reports: teacherReports } = await call(teacherAccount, teacherReportPath, 'GET', undefined, 200, 'coordinator');
    assert.equal(teacherReports[0].partner_institution_id, partner.id);
    assert.equal(teacherReports[0].partner_institution_name, tag);
    const confirmReport = `${teacherReportPath}/${report.id}/confirm`;
    await call(outsideTeacherAccount, confirmReport, 'PATCH', {}, 404, 'coordinator');
    await call(teacherAccount, confirmReport, 'PATCH', {}, 200, 'coordinator');
    assert.ok((await read(host, reportPath)).reports.some(({ id, partner_institution_id, status }) =>
      id === report.id && partner_institution_id === partner.id && status === 'resolved'));
    await call(outsider, `${reportPath}/${report.id}`, 'DELETE', undefined, 404);
    await call(host, `${reportPath}/${report.id}`, 'DELETE');
    assert.deepEqual((await read(host, reportPath)).reports, []);
    assert.equal((await call(secondTeacherAccount, '/teacher-batches/me', 'GET', undefined, 200, 'coordinator')).batches[0].id, batch);
    assert.equal((await call(secondTeacherAccount, '/teacher-batches/' + batch + '/students', 'GET', undefined, 200, 'coordinator')).students[0].student_id, eligible[0]);
    await call(outsideTeacherAccount, '/teacher-batches/' + batch + '/students', 'GET', undefined, 403, 'coordinator');
    const placement = (await call(student, '/placement/me')).placement;
    assert.ok(placement.approval_date);
    assert.deepEqual(placement.attendance_dates, weekdays.slice(0, 10));
    assert.equal(placement.instructions, 'Report to reception');
    assert.equal(placement.teachers.length, 2);
    assert.equal((await call(studentsById.get(eligible[1]), '/placement/me')).placement, null);
    assert.deepEqual((await getStudentSchedules(eligible[0]))[0].attendance_dates.split(','), weekdays.slice(0, 10));
    const alternatePartner = await query("INSERT INTO partner_institutions (name,address) VALUES ($1,'Main office') RETURNING id", [`${tag} Alternate`]);
    const nextPartner = await query("INSERT INTO partner_institutions (name,address) VALUES ($1,'Main office') RETURNING id", [`${tag} Next`]);
    const nextHost = await user('supervisor', 'next-host', period.id);
    await query("INSERT INTO supervisors (user_id,first_name,last_name,company_name) VALUES ($1,'Supervisor','Next',$2)",
      [nextHost.id, nextHost.email]);
    await registerSupervisor(alternatePartner, outsider);
    await registerSupervisor(nextPartner, nextHost);
    const counterBoth = await create({ partner_id: alternatePartner.id, student_ids: [] });
    const revisionOptions = await read(outsider, counterBoth + '/review-options');
    assert.ok(revisionOptions.teachers.some(({ id }) => id === secondTeacher.id));
    assert.ok(revisionOptions.strands.includes('STEM'));
    await call(host, counterBoth + '/review-options', 'GET', undefined, 404);
    const changes = { status: 'changes_requested', start: weekdays[1], capacity: 1,
      teacher_ids: [secondTeacher.id], strands: null, reason: 'Please use the revised date and teacher.' };
    await amend(host, counterBoth, 'review', { ...changes, revision: 0 }, 404);
    await amend(outsider, counterBoth, 'review', { ...changes, revision: 0 });
    const returned = (await read(school, counterBoth)).request;
    assert.equal(returned.status, 'changes_requested');
    assert.equal(returned.counterproposal.reason, changes.reason);
    assert.deepEqual(returned.counterproposal.teacher_ids, [secondTeacher.id]);
    assert.equal(returned.counterproposal.teacher_name, 'Teacher Two');
    assert.equal(returned.counterproposal.strands, null);
    assert.equal(returned.proposal.start, weekdays[0]);
    const returnedCards = await stagePartners('requesting', 'changes_requested');
    const returnedCard = returnedCards.find(({ id }) => id === alternatePartner.id);
    assert.equal(returnedCard.requested_changes.reason, changes.reason);
    assert.equal(returnedCard.proposal.capacity, 2);
    const revised = { ...proposal, start: weekdays[1], capacity: 1, teacher_ids: [secondTeacher.id], strands: null, student_ids: [] };
    await amend(school, counterBoth, 'resubmit', { ...revised, revision: 0 }, 409);
    await amend(school, counterBoth, 'resubmit', { ...revised, revision: 1 });
    const supervisorInbox = await read(outsider, prefix);
    const revisionCard = supervisorInbox.requests.find(({ id }) => id === returned.id);
    assert.equal(revisionCard.status, 'pending');
    assert.equal(revisionCard.coordinator_school, 'Test High School');
    assert.equal(revisionCard.previous_proposal.capacity, 2);
    assert.match(revisionCard.previous_proposal.teacher_name, /Teacher Test/);
    assert.equal(revisionCard.original_proposal.start, weekdays[0]);
    assert.equal(revisionCard.proposal.start, weekdays[1]);
    assert.equal(revisionCard.coordinator_department, 'Senior High School');
    const commentOnly = { ...changes, revision: 2, reason: 'Add instructions about safety equipment.' };
    await amend(outsider, counterBoth, 'review', { ...commentOnly, reason: '' }, 400);
    await amend(outsider, counterBoth, 'review', commentOnly);
    await amend(school, counterBoth, 'resubmit', { ...revised, revision: 3, notes: 'Bring safety equipment.' });
    await amend(outsider, counterBoth, 'review', { revision: 4, status: 'approved' });
    const approvedRevision = await read(school, counterBoth);
    assert.equal(approvedRevision.request.id, returned.id);
    assert.equal(approvedRevision.request.status, 'approved');
    assert.equal(approvedRevision.request.previous_proposal.notes, proposal.notes);
    assert.equal(approvedRevision.request.proposal.notes, 'Bring safety equipment.');
    assert.deepEqual(approvedRevision.history.filter(({ action }) => action === 'revision_requested').map(({ reason, actor_id }) => [reason, actor_id]),
      [[commentOnly.reason, outsider.id], [changes.reason, outsider.id]]);
    assert.equal(approvedRevision.history.filter(({ action, actor_id }) => action === 'resubmitted' && actor_id === school.id).length, 2);
    await amend(school, counterBoth, 'finalize', { revision: 5, student_ids: [eligible[0]] }, 409);
    const next = await create({ partner_id: nextPartner.id, student_ids: [eligible[1]], capacity: 2 });
    await amend(nextHost, next, 'review', { revision: 0, status: 'approved' });
    const outcomes = await Promise.all([
      amend(school, next, 'finalize', { revision: 1, student_ids: [eligible[1]] }, null),
      amend(school, counterBoth, 'finalize', { revision: 5, student_ids: [eligible[1]] }, null),
    ]);
    assert.deepEqual(outcomes.toSorted(), [200, 409]);
    const owner = outcomes[0] === 200 ? next : counterBoth;
    const other = outcomes[0] === 200 ? counterBoth : next;
    const reviewer = outcomes[0] === 200 ? nextHost : outsider;
    const ownerRequest = (await read(school, owner)).request;
    const otherRequest = (await read(school, other)).request;
    await assert.rejects(query(`INSERT INTO partner_student_assignments (deployment_request_id, student_id, status)
      VALUES ($1,$2,'pending')`, [otherRequest.id, eligible[1]]), { code: '23505' });
    const studentRejection = { student_id: eligible[1], status: 'rejected', reason: 'Shift unavailable' };
    assert.equal((await read(school, other + '/assignment-candidates')).students.some(({ id }) => id === eligible[1]), false);
    const pendingList = await read(reviewer, prefix + '/student-approvals');
    assert.ok(pendingList.assignments.some(({ student_id, status, eligible: canAccept }) =>
      student_id === eligible[1] && status === 'pending' && canAccept));
    await amend(reviewer, owner, 'review-students', { revision: ownerRequest.revision,
      decisions: [{ ...studentRejection, reason: '' }] }, 400);
    await amend(reviewer, owner, 'review-students', { revision: ownerRequest.revision, decisions: [studentRejection] });
    const returnedStudents = await read(school, prefix + '/student-approvals');
    assert.ok(returnedStudents.assignments.some(({ student_id, status, rejection_reason }) =>
      student_id === eligible[1] && status === 'rejected' && rejection_reason === studentRejection.reason));
    assert.equal((await read(school, other + '/assignment-candidates')).students.some(({ id }) => id === eligible[1]), false);
    await amend(school, owner, 'submit-students', { revision: ownerRequest.revision + 1, student_ids: [], release_ids: [eligible[1]] });
    assert.ok((await read(school, other + '/assignment-candidates')).students.some(({ id }) => id === eligible[1]));
    const nextRevision = (await read(school, next)).request.revision;
    await amend(school, next, 'submit-students', { revision: nextRevision, student_ids: [eligible[1], eligible[3]] });
    await amend(nextHost, next, 'review-students', { revision: nextRevision + 1, decisions: [
      { student_id: eligible[1], status: 'accepted' }, { student_id: eligible[3], status: 'rejected', reason: 'Adjust shift' },
    ] });
    const mixedReview = await read(school, next);
    assert.deepEqual(mixedReview.roster, []);
    const stillAvailable = (await stagePartners('approved')).find(({ id }) => id === nextPartner.id);
    assert.equal(stillAvailable.assigned_students, 1);
    assert.equal((await read(school, counterBoth + '/assignment-candidates')).students.some(({ id }) => id === eligible[1]), false);
    assert.equal((await call(studentsById.get(eligible[3]), '/placement/me')).placement, null);
    await amend(school, next, 'submit-students', { revision: nextRevision + 2, student_ids: [eligible[3]] });
    const awaitingApproval = await read(school, prefix + '/student-approvals');
    const summary = awaitingApproval.deployment_summaries[mixedReview.request.id];
    assert.equal(summary.id, nextPartner.id);
    assert.equal(summary.address, 'Main office');
    assert.equal(summary.request_count, 1);
    assert.equal(summary.assigned_students, 1);
    assert.equal(summary.is_active, true);
    assert.equal(summary.schedule_status, 'upcoming');
    assert.deepEqual(summary.confirmed_schedule, mixedReview.request.confirmed_schedule);
    await amend(nextHost, next, 'review-students', { revision: nextRevision + 3, decisions: [{ student_id: eligible[3], status: 'accepted' }] });
    assert.equal((await read(school, prefix + '/student-approvals')).deployment_summaries[mixedReview.request.id], undefined);
    const reviewed = await read(school, next);
    assert.ok(reviewed.history.some(({ after_state }) => after_state?.decisions?.some(({ reason }) => reason === 'Adjust shift')));
    assert.equal(reviewed.roster.length, 0);

    const approved = await query(`UPDATE student_requirement_submissions SET status = 'Approved', progress = 100
      WHERE student_id = $1 RETURNING id`, [eligible[2]]);
    await query(`INSERT INTO student_requirement_statuses (submission_id,document_type_id,status)
      SELECT $1,id,'APPROVED' FROM document_types WHERE COALESCE(is_active,true)`, [approved.id]);
    const alternate = (await read(school, counterBoth)).request;
    await amend(school, counterBoth, 'submit-students', { revision: alternate.revision, student_ids: [eligible[2]] });
    await amend(outsider, counterBoth, 'review-students', { revision: alternate.revision + 1,
      decisions: [{ student_id: eligible[2], status: 'accepted' }] });
    const secondSelection = { request_ids: [reviewed.request.id, alternate.id], creation_key: randomUUID() };
    await query('UPDATE partner_institutions SET is_active = false WHERE id = $1', [nextPartner.id]);
    await call(school, prefix + '/batches', 'POST', secondSelection, 400);
    assert.equal((await read(school, counterBoth)).request.teacher_batch_id, null);
    await query('UPDATE partner_institutions SET is_active = true WHERE id = $1', [nextPartner.id]);
    const { batch: secondBatch } = await call(school, prefix + '/batches', 'POST', secondSelection);
    assert.equal(secondBatch.name, 'BATCH - 2');
    // Migration 047 grouped earlier deployments without a batch creation key.
    const backfilledBatch = await query(`INSERT INTO coordinator_deployment_batches (coordinator_id, batch_number)
      VALUES ($1, 3) RETURNING id`, [school.id]);
    await query('UPDATE deployment_requests SET coordinator_batch_id = $2 WHERE id = $1',
      [previousRequest.id, backfilledBatch.id]);
    const monitored = (await read(school, prefix + '/batches')).batches;
    assert.deepEqual(monitored.map(({ name }) => name), ['BATCH - 2', 'BATCH - 1']);
    assert.deepEqual(monitored[0].deployments.map(({ request_id, student_count }) => [request_id, student_count]),
      [[alternate.id, 1], [reviewed.request.id, 2]]);
    const rosterUrl = (id) => `${prefix}/batches/${id}/roster`;
    const { students_by_request: liveRoster } = await read(school, rosterUrl(secondBatch.id));
    assert.deepEqual(liveRoster[alternate.id].map(({ student_id }) => student_id), [eligible[2]]);
    assert.deepEqual(liveRoster[reviewed.request.id].map(({ student_id }) => student_id), [eligible[1], eligible[3]]);
    await call(outsideSchool, rosterUrl(secondBatch.id), 'GET', undefined, 404);
    await call(school, rosterUrl(backfilledBatch.id), 'GET', undefined, 404);
    assert.equal((await read(school, next)).roster.length, 2);

    await amend(host, draft, 'amendment', { revision: 10, start: weekdays[1], reason: 'Additional training day' });
    await amend(host, draft, 'amendment-decision', { revision: 11, decision: 'accept' }, 409);
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(0, 10));
    await amend(school, draft, 'amendment-decision', { revision: 11, decision: 'accept' });
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(1, 11));
    assert.deepEqual((await call(student, '/student/schedule', 'GET', undefined, 200, 'attendance')).schedules[0].attendance_dates.split(','), weekdays.slice(1, 11));
    await amend(school, draft, 'amendment', { revision: 12, start: weekdays[2], reason: 'School calendar update' });
    await amend(host, draft, 'amendment-decision', { revision: 13, decision: 'reject', reason: 'Site closed' });
    assert.deepEqual((await call(host, '/batches/' + batch + '/attendance')).dates, weekdays.slice(1, 11));
    await query(`INSERT INTO student_daily_documentation (student_id, teacher_batch_id, date, day_number, reasoning, status)
      VALUES ($1,$2,$3,1,'Preserved evidence','submitted')`, [eligible[0], batch, weekdays[0]]);
    const attendance = await query(`INSERT INTO student_attendance (student_id, teacher_batch_id, date, status)
      VALUES ($1,$2,$3,'present') RETURNING id`, [eligible[0], batch, weekdays[1]]);
    // Simulate a published deployment that was grouped by the backfill.
    await query('UPDATE coordinator_deployment_batches SET creation_key = NULL WHERE id = $1', [firstBatch.id]);
    const availableToRebatch = (await stagePartners('completed')).find(({ id }) => id === partner.id);
    assert.equal(availableToRebatch.schedule_published, true);
    const rebatchSelection = { request_ids: [result.request.id], creation_key: randomUUID() };
    const { batch: replacementBatch } = await call(school, prefix + '/batches', 'POST', rebatchSelection);
    const regrouped = (await read(school, draft)).request;
    assert.equal(regrouped.coordinator_batch_id, replacementBatch.id);
    assert.equal(regrouped.teacher_batch_id, batch);
    assert.equal(includesPartner(await stagePartners('completed')), false);
    assert.deepEqual((await call(school, prefix + '/batches', 'POST', rebatchSelection)).batch, replacementBatch);
    assert.ok(await query('SELECT 1 FROM student_attendance WHERE id = $1 AND teacher_batch_id = $2', [attendance.id, batch]));
    assert.deepEqual((await getStudentSchedules(eligible[0]))[0].attendance_dates.split(','), weekdays.slice(1, 11));
    assert.equal((await call(student, '/journey')).stages.immersion, 'active');
    const evaluationApi = (actor, path, method = 'GET', body, expected = 200) =>
      call(actor, path, method, body, expected, 'evaluation');
    const evaluationRoster = (await evaluationApi(host, '/my-students')).students;
    const evaluationStudent = evaluationRoster.find(({ student_id }) => student_id === eligible[0]);
    assert.equal(evaluationStudent.partner_institution_id, partner.id);
    assert.equal(evaluationStudent.partner_institution_name, tag);
    assert.equal(evaluationStudent.batch_id, batch);
    assert.equal(evaluationStudent.attendance_days, 0);
    assert.equal(evaluationStudent.required_attendance_days, 10);
    assert.equal((await evaluationApi(outsider, '/my-students')).students.some(({ student_id }) => student_id === eligible[0]), false);
    const originalCriteria = await evaluationApi(host, '/criteria');
    const criteriaDraft = [
      { ...originalCriteria.criteria[0], category_name: 'Cooperation', indicators: ['Works with others', 'Shares updates'] },
      { id: 'new-category', category_name: 'Work quality', indicators: ['Checks completed work'] },
    ];
    const savedCriteria = await evaluationApi(host, '/criteria', 'PUT', {
      criteria: criteriaDraft, criteriaVersion: originalCriteria.criteria_version,
    });
    const [cooperation, workQuality] = savedCriteria.criteria;
    assert.deepEqual(savedCriteria.criteria.map(({ category_name }) => category_name), ['Cooperation', 'Work quality']);
    assert.ok(Number.isInteger(workQuality.id) && workQuality.id !== cooperation.id);
    assert.deepEqual(await evaluationApi(host, '/criteria'), {
      criteria: savedCriteria.criteria, criteria_version: savedCriteria.criteria_version,
    });
    await evaluationApi(host, '/criteria', 'PUT', { criteria: criteriaDraft, criteriaVersion: originalCriteria.criteria_version }, 409);
    const scores = {
      [cooperation.id]: { indicators: [5, 'N/A'] },
      [workQuality.id]: { indicators: [3] },
    };
    const evaluationPayload = { batchId: batch, studentId: eligible[0], partnerInstitutionId: partner.id,
      criteriaVersion: savedCriteria.criteria_version, categoryScores: scores, comments: 'Shows steady progress.' };
    await evaluationApi(host, '/submit', 'POST', evaluationPayload, 400);
    await evaluationApi(outsider, '/submit', 'POST', evaluationPayload, 403);
    await evaluationApi(host, '/submit', 'POST', { ...evaluationPayload, partnerInstitutionId: empty.id }, 403);
    await query(`INSERT INTO student_attendance (student_id, teacher_batch_id, date, status, check_in_time, check_out_time)
      SELECT $1, $2, day, 'checked_out', day + time '08:00', day + time '17:00' FROM unnest($3::date[]) day
      ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status,
        check_in_time = EXCLUDED.check_in_time, check_out_time = EXCLUDED.check_out_time`,
    [eligible[0], batch, weekdays.slice(1, 11)]);
    assert.equal((await evaluationApi(host, '/my-students')).students.find(({ student_id }) => student_id === eligible[0]).attendance_days, 10);
    await evaluationApi(host, '/submit', 'POST', { ...evaluationPayload, categoryScores: {} }, 400);
    await evaluationApi(host, '/submit', 'POST', {
      ...evaluationPayload, categoryScores: { ...scores, [workQuality.id]: { indicators: [6] } },
    }, 400);
    const { evaluation: createdEvaluation } = await evaluationApi(host, '/submit', 'POST', evaluationPayload, 201);
    assert.equal(Number(createdEvaluation.overall_percentage), 80);
    assert.deepEqual(createdEvaluation.category_scores[0].ratings, [5, 'N/A']);
    assert.deepEqual(createdEvaluation.category_scores[0].indicator_labels, cooperation.indicators);
    const evaluationUrl = `/student/${eligible[0]}?batchId=${batch}`;
    assert.equal((await evaluationApi(host, evaluationUrl)).evaluation.comments, 'Shows steady progress.');
    await evaluationApi(outsider, evaluationUrl, 'GET', undefined, 403);
    const { evaluation: updatedEvaluation } = await evaluationApi(host, '/submit', 'POST', {
      ...evaluationPayload, comments: 'Updated comments.',
    });
    assert.equal(updatedEvaluation.id, createdEvaluation.id);
    const teacherGrades = (await evaluationApi(secondTeacherAccount, '/teacher/my-batch')).groups;
    const teacherPlacement = teacherGrades.find(({ batch_id }) => batch_id === batch);
    assert.equal(teacherPlacement.partner_institution_id, partner.id);
    assert.equal(teacherPlacement.students[0].evaluation.id, createdEvaluation.id);

    const certificateApi = (actor, path, method = 'GET', body, expected = 200) =>
      call(actor, '/certificate' + path, method, body, expected, 'supervisor');
    const appealApi = (actor, path, method = 'GET', body, expected = 200) =>
      call(actor, path, method, body, expected, 'appeals');
    const deploymentQuery = `?deploymentRequestId=${regrouped.id}`;
    const certificateAction = (action) => `/${action}/${student.id}${deploymentQuery}`;
    await query(`INSERT INTO certificate_templates (supervisor_id, teacher_batch_id, school_name)
      VALUES ($1,$2,'Previous partner design')`, [host.id, batch]);
    const assignedCertificates = await certificateApi(host, '/eligible?all=true');
    const certificateStudent = assignedCertificates.eligible.find(({ student_id }) => student_id === eligible[0]);
    assert.equal(certificateStudent.partner_institution_id, partner.id);
    assert.equal(certificateStudent.partner_institution_name, tag);
    assert.equal(certificateStudent.deployment_request_id, regrouped.id);
    assert.equal(certificateStudent.completed, false);
    assert.ok(!(await certificateApi(outsider, '/eligible?all=true')).eligible.some(({ student_id }) => student_id === eligible[0]));
    await certificateApi(outsider, certificateAction('force'), 'POST', undefined, 403);
    await certificateApi(host, certificateAction('generate'), 'POST', undefined, 400);
    await certificateApi(host, '/template/me?institutionId=' + empty.id, 'GET', undefined, 403);
    await certificateApi(host, '/template/me', 'PUT', { partner_institution_id: 'invalid' }, 400);

    const designQuery = '/template/me?institutionId=' + partner.id;
    const previousDesign = await certificateApi(host, designQuery);
    assert.equal(previousDesign.company_name, tag);
    assert.equal(previousDesign.school_name, 'Previous partner design');
    const template = await certificateApi(host, '/template/me', 'PUT', {
      partner_institution_id: partner.id, company_name: 'Unrelated host', school_name: 'Partner certificate design',
    });
    assert.equal(template.company_name, tag);
    assert.equal((await certificateApi(host, designQuery)).school_name, template.school_name);

    const cloudinary = require('../db/cloudinary');
    const uploads = new Map();
    const previousUpload = cloudinary.uploader.upload_stream;
    const previousDestroy = cloudinary.uploader.destroy;
    cloudinary.uploader.upload_stream = ({ public_id }, callback) => {
      const chunks = [];
      return new Writable({
        write(chunk, encoding, done) { chunks.push(chunk); done(); },
        final(done) {
          uploads.set(public_id, Buffer.concat(chunks));
          callback(null, { public_id, secure_url: `https://example.test/raw/upload/${public_id}.pdf` });
          done();
        },
      });
    };
    cloudinary.uploader.destroy = async (id) => { uploads.delete(id); };
    const historicalDays = Array.from({ length: 10 }, (_, index) => dateAfter(today, index - 9));
    const appealDraft = { evaluationId: createdEvaluation.id, categoryId: cooperation.id, reason: 'Review the rating.' };
    try {
      const forced = await certificateApi(host, certificateAction('force'), 'POST', undefined, 201);
      assert.equal(forced.forced, true);
      assert.ok(uploads.get(forced.certificate.certificate_number).subarray(0, 4).equals(Buffer.from('%PDF')));
      const forcedRow = (await certificateApi(host, '/eligible?all=true')).eligible.find(({ student_id }) => student_id === eligible[0]);
      assert.equal(forcedRow.can_undo, true);
      await certificateApi(outsider, certificateAction('undo'), 'DELETE', undefined, 403);
      await certificateApi(host, certificateAction('undo'), 'DELETE');
      assert.equal(uploads.size, 0);
      await appealApi(student, '/', 'POST', appealDraft, 403);

      // Make the fixture's agreed workdays historical so the student can enter Post-Immersion.
      await query("UPDATE deployment_requests SET confirmed_schedule = jsonb_set(confirmed_schedule, '{dates}', $2::jsonb) WHERE id = $1",
        [regrouped.id, JSON.stringify(historicalDays)]);
      const original = await query('SELECT deployment_started_on FROM teacher_batch_students WHERE teacher_batch_id = $1 AND student_id = $2',
        [batch, eligible[0]]);
      await query('UPDATE teacher_batch_students SET deployment_started_on = $3 WHERE teacher_batch_id = $1 AND student_id = $2',
        [batch, eligible[0], historicalDays[0]]);
      await query(`INSERT INTO student_attendance (student_id, teacher_batch_id, date, status, check_in_time, check_out_time)
        SELECT $1, $2, day, 'present', day + time '08:00', day + time '17:00' FROM unnest($3::date[]) day`,
      [eligible[0], batch, historicalDays]);
      await query(`INSERT INTO student_daily_documentation (student_id, teacher_batch_id, date, day_number, reasoning, status)
        SELECT $1, $2, day, ord, 'Reviewed daily journal', 'graded'
        FROM unnest($3::date[]) WITH ORDINALITY dates(day, ord)`, [eligible[0], batch, historicalDays]);

      assert.equal((await call(student, '/journey')).stages.post, 'completed');
      const currentOverview = await teacherOverview(secondTeacherAccount);
      assert.equal(currentOverview.present_count, 1);
      assert.deepEqual(currentOverview.documentation.find(({ student_id }) => student_id === eligible[0]),
        { student_id: eligible[0], total_docs: 10, graded_count: 10, pending_count: 0 });
      assert.equal((await evaluationApi(student, '/me')).evaluation.partner_institution_id, partner.id);
      await appealApi(student, '/supervisor', 'GET', undefined, 403);
      await appealApi(student, '/', 'POST', { ...appealDraft, categoryId: 2147483647 }, 400);
      assert.deepEqual((await Promise.all([
        appealApi(student, '/', 'POST', appealDraft, null),
        appealApi(student, '/', 'POST', appealDraft, null),
      ])).sort(), [201, 409]);
      const { appeals: [appeal] } = await appealApi(host, '/supervisor');
      assert.equal(appeal.partner_institution_id, partner.id);
      assert.equal(appeal.category_name, cooperation.category_name);
      assert.equal(appeal.deployment_request_id, regrouped.id);
      const reply = `/${appeal.id}/respond`;
      const resolution = { status: 'approved', response: 'I will review the rating.' };
      assert.deepEqual((await appealApi(outsider, '/supervisor')).appeals, []);
      await appealApi(outsider, reply, 'PATCH', resolution, 404);
      await appealApi(host, reply, 'PATCH', { ...resolution, response: ' ' }, 400);
      assert.deepEqual((await Promise.all([
        appealApi(host, reply, 'PATCH', resolution, null),
        appealApi(host, reply, 'PATCH', resolution, null),
      ])).sort(), [200, 409]);
      const { appeals: [myAppeal] } = await appealApi(student, '/my');
      assert.equal(myAppeal.status, 'approved');
      assert.equal(myAppeal.supervisor_response, resolution.response);
      const { appeal: declined } = await appealApi(student, '/', 'POST', { ...appealDraft, categoryId: workQuality.id }, 201);
      await appealApi(host, `/${declined.id}/respond`, 'PATCH', { status: 'rejected', response: 'Rating confirmed.' });
      assert.ok((await appealApi(student, '/my')).appeals.some((item) => item.id === declined.id && item.status === 'rejected'));

      const { id: legacyEvaluation } = await query(`INSERT INTO student_evaluations
        (student_id, evaluator_id, batch_id, overall_percentage) VALUES ($1,$2,$3,80) RETURNING id`,
      [eligible[0], host.id, legacyBatch.id]);
      await appealApi(student, '/', 'POST', { ...appealDraft, evaluationId: legacyEvaluation, categoryId: null }, 404);
      await query('DELETE FROM student_evaluations WHERE id = $1', [legacyEvaluation]);
      const notifications = (await pool.query(`SELECT user_id, action_url FROM notifications
        WHERE entity_type = 'grade_appeal' AND entity_id = $1 ORDER BY id`, [appeal.id])).rows;
      assert.deepEqual(notifications, [
        { user_id: host.id, action_url: '/dashboard/supervisor/grade-appeals' },
        { user_id: student.id, action_url: '/dashboard/student/post-immersion/evaluation' },
      ]);

      const eligibleCertificates = await certificateApi(host, '/eligible');
      assert.ok(eligibleCertificates.eligible.some(({ student_id }) => student_id === eligible[0]));
      assert.deepEqual((await Promise.all([
        certificateApi(host, certificateAction('generate'), 'POST', undefined, null),
        certificateApi(host, certificateAction('generate'), 'POST', undefined, null),
      ])).sort(), [200, 201]);
      assert.equal(uploads.size, 1);
      const issued = await query('SELECT * FROM certificates WHERE student_id = $1', [eligible[0]]);
      assert.equal(issued.deployment_request_id, regrouped.id);
      assert.equal(issued.partner_institution_id, partner.id);
      assert.equal(issued.template_snapshot.school_name, template.school_name);
      assert.equal(issued.attendance_days, 10);
      await certificateApi(host, certificateAction('undo'), 'DELETE', undefined, 404);
      await certificateApi(host, '/template/me', 'PUT', { partner_institution_id: partner.id, school_name: 'New design' });
      assert.equal((await query('SELECT template_snapshot FROM certificates WHERE id = $1', [issued.id])).template_snapshot.school_name, template.school_name);
      assert.equal((await call(student, '/me', 'GET', undefined, 200, 'certificate')).certificate.certificate_number, issued.certificate_number);
      const download = await fetch(base + '/certificate/me/download', {
        headers: { Authorization: 'Bearer ' + jwt.sign({ id: student.id }, process.env.JWT_SECRET) },
      });
      assert.equal(download.status, 200);
      assert.equal(download.headers.get('content-type'), 'application/pdf');
      assert.ok(Buffer.from(await download.arrayBuffer()).subarray(0, 4).equals(Buffer.from('%PDF')));

      await query("UPDATE deployment_requests SET confirmed_schedule = jsonb_set(confirmed_schedule, '{dates}', $2::jsonb) WHERE id = $1",
        [regrouped.id, JSON.stringify(weekdays.slice(1, 11))]);
      await query('UPDATE teacher_batch_students SET deployment_started_on = $3 WHERE teacher_batch_id = $1 AND student_id = $2',
        [batch, eligible[0], original.deployment_started_on]);
    } finally {
      cloudinary.uploader.upload_stream = previousUpload;
      cloudinary.uploader.destroy = previousDestroy;
    }
    const trail = (await read(school, draft)).history;
    assert.ok(trail.some(({ action, after_state }) => action === 'counterproposal_accepted' && after_state.agreement.supervisor_id === host.id));
    await call(school, '/deployment-requests/me', 'GET', undefined, 404);
    await assert.rejects(archivePeriod(period.id, school.id), { status: 409 });
    for (const open of [draft, next, counterBoth, `${prefix}/${previousRequest.id}`]) {
      const { request } = await read(school, open);
      await amend(school, open, 'cancel', { revision: request.revision, reason: 'Close test deployment' });
    }
    const archive = await archivePeriod(period.id, school.id);
    assert.ok(await query('SELECT 1 FROM archive_deployment_requests WHERE archive_period_id = $1 AND original_request_id = $2', [archive.archiveId, result.request.id]));
    assert.ok(await query('SELECT 1 FROM users WHERE id = $1', [host.id]));
    const archivedBatches = (await read(school, prefix + '/batches')).batches;
    assert.equal(archivedBatches.length, 2);
    assert.ok(archivedBatches.every(({ deployments }) => deployments.every(({ archived }) => archived)));
    const { students_by_request: archivedRoster } = await read(school, rosterUrl(secondBatch.id));
    assert.deepEqual(archivedRoster[reviewed.request.id].map(({ student_id }) => student_id), [eligible[1], eligible[3]]);
    assert.ok(archivedRoster[alternate.id][0].deployment_ended_on);
    assert.equal(archivedRoster[alternate.id][0].email, undefined);
  } finally {
    await getIO().close();
    await pool.end();
  }
});
