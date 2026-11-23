// Supervisor-facing views for assigned batches, students, and attendance.
const pool = require('../../db');
const { createNotification } = require('../../services/notification.service');
const { getStudentSchedules } = require('../teacherControllers/immersionSchedule.controller');

// node-postgres returns DATE columns as JS Dates anchored to UTC midnight.
// Serializing those directly would let the client land on a neighbouring
// calendar day in another timezone, so we always read the UTC components —
// that is the exact day the database stored.
function formatDateOnly(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

function shapeAppeal(appeal) {
  return { ...appeal, appeal_date: formatDateOnly(appeal.appeal_date) };
}

async function ensureSupervisorReportsTable(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS supervisor_reports (
      id SERIAL PRIMARY KEY,
      supervisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      batch_id INTEGER,
      batch_source VARCHAR(30) NOT NULL DEFAULT 'deployment',
      teacher_id INTEGER,
      category VARCHAR(80) NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      message TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_supervisor_reports_supervisor ON supervisor_reports(supervisor_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_supervisor_reports_student ON supervisor_reports(student_id)');
}

async function getSupervisorBatches(supervisorUserId) {
  const teacher = await pool.query(
    `SELECT tb.id AS request_id, tb.batch_label, NULL AS strand,
            dr.id AS partner_request_id, dr.confirmed_schedule,
            c.first_name AS coordinator_first_name, c.last_name AS coordinator_last_name,
            c.employee_id AS coordinator_employee_id, c.department AS coordinator_department,
            c.designation AS coordinator_designation, c.school AS coordinator_school,
            cu.email AS coordinator_email, cu.phone AS coordinator_phone,
            t.first_name AS teacher_first_name, t.last_name AS teacher_last_name,
            t.employee_id AS teacher_employee_id, t.department AS teacher_department,
            t.designation AS teacher_designation, t.school AS teacher_school,
            tu.email AS teacher_email, tu.phone AS teacher_phone,
            'teacher' AS source
     FROM teacher_batches tb
     JOIN coordinators c ON c.id = tb.coordinator_id
     LEFT JOIN users cu ON cu.id = c.user_id
     LEFT JOIN teachers t ON t.id = tb.teacher_id
     LEFT JOIN users tu ON tu.id = t.user_id
     JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
     WHERE tb.supervisor_id = $1 AND tb.archived_at IS NULL
     ORDER BY tb.created_at DESC`, [supervisorUserId]
  );
  return teacher.rows;
}

async function getSupervisorPartnerInstitutions(req, res) {
  const result = await pool.query(
    `SELECT DISTINCT ON (pi.id)
            pi.id, pi.name, pi.industry, pi.description, pi.address,
            MIN(dr.confirmed_schedule->>'start') AS deployment_start,
            MAX(dr.confirmed_schedule->>'end') AS deployment_end,
            COUNT(DISTINCT tb.id) AS batch_count
     FROM teacher_batches tb
     JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
     JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
     WHERE tb.supervisor_id = $1 AND dr.supervisor_id = $1 AND tb.archived_at IS NULL
     GROUP BY pi.id
     ORDER BY pi.id`,
    [req.user.id]
  );
  return res.json({ institutions: result.rows });
}

const studentFields = `s.id AS student_id, s.user_id, s.student_number,
  s.first_name, s.middle_name, s.last_name, s.suffix, s.gender, s.birthdate, s.age,
  s.contact_number, COALESCE(u.phone, s.contact_number) AS phone, u.status AS account_status,
  COALESCE(NULLIF(s.email, ''), u.email) AS email, s.home_address, s.grade_level, s.section,
  s.track_strand, s.track_strand AS strand, s.school, s.preferred_industry, s.preferred_company,
  s.career_goal, s.industry_reason, s.guardian_name, s.guardian_relationship, s.guardian_contact,
  s.guardian_email, s.guardian_address, s.emergency_contact, s.emergency_contact_number,
  s.academic_notes, s.photo_url,
  srs.status AS requirements_status,
  cert.certificate_number, cert.cloudinary_url AS certificate_url`;

async function getTeacherBatchStudents(requestId, supervisorUserId) {
  const result = await pool.query(
    `SELECT ${studentFields}, to_jsonb(tb)->>'partner_institution_id' IS NOT NULL AS partner_managed
     FROM teacher_batch_students tbs JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id
     JOIN students s ON s.id = tbs.student_id JOIN users u ON u.id = s.user_id
     JOIN student_requirement_submissions srs ON srs.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT certificate_number, cloudinary_url
       FROM certificates c
       WHERE c.student_id = s.id
       ORDER BY c.created_at DESC
       LIMIT 1
     ) cert ON true
     WHERE tbs.teacher_batch_id = $1 AND tb.supervisor_id = $2
       AND tb.archived_at IS NULL AND tbs.deployment_ended_on IS NULL
     ORDER BY s.last_name, s.first_name`,
    [requestId, supervisorUserId]
  );
  return result.rows.map((student) => {
    if (!student.partner_managed) return student;
    const { student_id, user_id, first_name, last_name, student_number, grade_level, section, track_strand,
      photo_url, requirements_status, certificate_number, certificate_url } = student;
    return { student_id, user_id, first_name, last_name, student_number, grade_level, section, track_strand,
      strand: track_strand, photo_url, requirements_status, certificate_number, certificate_url, partner_managed: true };
  });
}

async function getSupervisorPartnerInstitutionStudents(req, res) {
  const institutionId = Number(req.params.institutionId);
  if (!Number.isInteger(institutionId) || institutionId <= 0 || institutionId > 2147483647) {
    return res.status(400).json({ error: 'Invalid partner institution.' });
  }
  const result = await pool.query(
    `SELECT ${studentFields}
     FROM teacher_batch_students tbs
     JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id
     JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
     JOIN students s ON s.id = tbs.student_id
     JOIN users u ON u.id = s.user_id
     JOIN student_requirement_submissions srs ON srs.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT certificate_number, cloudinary_url
       FROM certificates c
       WHERE c.student_id = s.id
       ORDER BY c.created_at DESC
       LIMIT 1
     ) cert ON true
     WHERE dr.partner_institution_id = $1 AND tb.supervisor_id = $2 AND dr.supervisor_id = $2
       AND tb.archived_at IS NULL AND tbs.deployment_ended_on IS NULL
     ORDER BY s.last_name, s.first_name`,
    [institutionId, req.user.id]
  );
  return res.json({ students: result.rows });
}

async function resolveImmersionDaysForStudent(studentId, batchId) {
  const schedule = (await getStudentSchedules(studentId)).find((row) => row.teacher_batch_id === batchId);
  return schedule ? schedule.attendance_dates.split(',').filter(Boolean).map((date, index) => ({
    date, number: schedule.first_day_number + index, is_makeup: false,
  })) : [];
}

const getStudentProgress = async (req, res) => {
  try {
    const supervisorUserId = req.user.id;
    const { studentId } = req.params;
    const studentProfileId = Number(studentId);

    if (!Number.isInteger(studentProfileId)) {
      return res.status(400).json({ error: 'Invalid student id.' });
    }

    const studentRes = await pool.query(
      `SELECT s.id AS student_id, s.user_id, s.student_number, s.first_name, s.middle_name,
              s.last_name, s.grade_level, s.track_strand, s.photo_url, s.section,
              COALESCE(NULLIF(s.email, ''), u.email) AS email,
              srs.status AS requirements_status, srs.progress AS requirements_progress
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN student_requirement_submissions srs ON srs.user_id = u.id
       WHERE s.id = $1`,
      [studentProfileId]
    );
    const student = studentRes.rows[0];
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    // Scope progress to finalized assignments for this supervisor.
    const ownerRes = await pool.query(
      `SELECT tb.id AS batch_id, tb.batch_label, 'teacher' AS source,
              to_jsonb(tb)->>'partner_institution_id' IS NOT NULL AS partner_managed
       FROM teacher_batches tb
       JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = tb.id
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
       WHERE tb.supervisor_id = $1 AND tbs.student_id = $2 AND tb.archived_at IS NULL AND tbs.deployment_ended_on IS NULL
       ORDER BY (to_jsonb(tbs)->>'deployment_ended_on' IS NULL) DESC, tbs.assigned_at DESC
       LIMIT 1`,
      [supervisorUserId, studentProfileId]
    );

    const batch = ownerRes.rows[0];
    if (!batch) return res.status(403).json({ error: 'This student is not assigned to you.' });
    const teacherBatchId = batch.batch_id;

    // ---- 1. REQUIREMENTS (each document type + the student's file state) ----
    // Form requirements (Personal Information, Guardian & Emergency) are filled
    // in on the Requirements page rather than uploaded, so they are left out of
    // this upload list: there is no file for the supervisor to check.
    const reqRes = batch.partner_managed ? { rows: [] } : await pool.query(
      `SELECT dt.id, dt.code, dt.name, dt.section, dt.sort_order,
              sd.id AS document_id, sd.status AS document_status, sd.original_name,
              sd.uploaded_date, sd.verified_date, sd.remarks
       FROM document_types dt
       LEFT JOIN student_documents sd
              ON sd.document_type_id = dt.id AND sd.student_id = $1
       WHERE dt.is_active IS NOT FALSE
         AND COALESCE(dt.input_type, 'file') <> 'form'
       ORDER BY dt.sort_order, dt.id`,
      [studentProfileId]
    );
    const requirements = reqRes.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      section: row.section,
      uploaded: Boolean(row.document_id),
      // "Completed" = uploaded AND verified by the coordinator.
      completed: row.document_status === 'Verified',
      rejected: row.document_status === 'Rejected',
      status: row.document_id ? row.document_status : 'Not uploaded',
      original_name: row.original_name,
      remarks: row.remarks,
    }));
    const requirementsCompleted = requirements.filter((r) => r.completed).length;

    // ---- 2. ATTENDANCE per immersion day ----
    const immersionDays = await resolveImmersionDaysForStudent(studentProfileId, teacherBatchId);
    const dateList = immersionDays.map((d) => d.date);

    const attRes = dateList.length
      ? await pool.query(
          `SELECT date, status, check_in_time, check_out_time
           FROM student_attendance
           WHERE student_id = $1 AND date = ANY($2::date[])`,
          [studentProfileId, dateList]
        )
      : { rows: [] };
    const attByDate = new Map(attRes.rows.map((r) => [String(r.date).slice(0, 10), r]));

    const attendance = immersionDays.map((day) => {
      const row = attByDate.get(day.date);
      const status = row?.status || 'absent';
      return {
        day_number: day.number,
        date: day.date,
        present: Boolean(row?.check_in_time) || status === 'present',
        status,
        check_in_time: row?.check_in_time || null,
        check_out_time: row?.check_out_time || null,
      };
    });
    const attendancePresent = attendance.filter((a) => a.present).length;

    // ---- 3. DAILY DOCUMENTATION per immersion day ----
    const docRes = teacherBatchId
      ? await pool.query(
          `SELECT date, day_number, status, teacher_score
           FROM student_daily_documentation
           WHERE student_id = $1 AND teacher_batch_id = $2`,
          [studentProfileId, teacherBatchId]
        )
      : { rows: [] };
    const docByDate = new Map(docRes.rows.map((r) => [String(r.date).slice(0, 10), r]));

    const documentation = immersionDays.map((day) => {
      const row = docByDate.get(day.date);
      return {
        day_number: row?.day_number ?? day.number,
        date: day.date,
        submitted: Boolean(row),
        // Graded or reviewed counts as finished documentation work.
        completed: row?.status === 'graded' || row?.status === 'reviewed',
        status: row?.status || 'missing',
        score: row?.teacher_score ?? null,
      };
    });
    const documentationDone = documentation.filter((d) => d.completed).length;

    res.json({
      student: {
        ...student,
        full_name:
          `${student.first_name} ${student.middle_name ? `${student.middle_name} ` : ''}${student.last_name}`.trim(),
      },
      batch: { ...batch, teacher_batch_id: teacherBatchId },
      requirements: {
        items: requirements,
        total: requirements.length,
        completed: requirementsCompleted,
        uploaded: requirements.filter((r) => r.uploaded).length,
        status: student.requirements_status || 'Pending',
        progress: student.requirements_progress ?? 0,
      },
      attendance: {
        days: attendance,
        present: attendancePresent,
        total: attendance.length,
        rate: attendance.length ? Math.round((attendancePresent / attendance.length) * 100) : 0,
      },
      documentation: {
        days: documentation,
        completed: documentationDone,
        total: documentation.length,
        rate: documentation.length ? Math.round((documentationDone / documentation.length) * 100) : 0,
      },
    });
  } catch (err) {
    console.error('getStudentProgress error:', err);
    res.status(500).json({ error: 'Failed to load student progress.' });
  }
};

const getSupervisorBatchStudents = async (req, res) => {
  try {
    const batches = await getSupervisorBatches(req.user.id);
    const enriched = [];
    for (const batch of batches) {
      const students = await getTeacherBatchStudents(batch.request_id, req.user.id);

      const userIds = students.map((s) => s.user_id);
      const docsResult = await pool.query(
        `SELECT student_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'Verified')::int AS verified
         FROM student_documents sd JOIN students s ON s.id = sd.student_id
         WHERE s.user_id = ANY($1::int[])
         GROUP BY student_id`,
        [userIds]
      );
      const docsByStudent = new Map(docsResult.rows.map((row) => [row.student_id, { total: Number(row.total), verified: Number(row.verified) }]));

      const attResult = await pool.query(
        `SELECT student_id, COUNT(DISTINCT date)::int AS days
         FROM student_attendance sa JOIN students s ON s.id = sa.student_id
         WHERE s.user_id = ANY($1::int[])
           AND sa.teacher_batch_id = $2 AND sa.check_in_time IS NOT NULL AND sa.check_out_time IS NOT NULL
         GROUP BY student_id`,
        [userIds, batch.request_id]
      );
      const attByStudent = new Map(attResult.rows.map((row) => [row.student_id, Number(row.days)]));

      // Summary rates for the list graph: requirements, attendance, documentation.
      // The same immersion days the detail modal uses, so the two always agree.
      // Form requirements are excluded because they have no file to verify, and
      // this rate is measured from verified uploads.
      const dtRes = await pool.query(
        `SELECT COUNT(*)::int AS total FROM document_types
          WHERE is_active IS NOT FALSE AND COALESCE(input_type, 'file') <> 'form'`
      );
      const requirementsTotal = Number(dtRes.rows[0]?.total || 0);

      const docDayRes = await pool.query(
        `SELECT sdd.student_id,
                COUNT(*) FILTER (WHERE sdd.status IN ('graded', 'reviewed'))::int AS done
         FROM student_daily_documentation sdd
         JOIN students s ON s.id = sdd.student_id
         WHERE s.user_id = ANY($1::int[]) AND sdd.teacher_batch_id = $2
         GROUP BY sdd.student_id`,
        [userIds, batch.request_id]
      );
      const docDaysByStudent = new Map(docDayRes.rows.map((row) => [row.student_id, Number(row.done)]));

      const summaries = new Map();
      for (const s of students) {
        const days = await resolveImmersionDaysForStudent(s.student_id, batch.request_id);
        const totalDays = days.length;
        const present = attByStudent.get(s.student_id) || 0;
        const docsDone = docDaysByStudent.get(s.student_id) || 0;
        const pct = (done) => (totalDays ? Math.round((Math.min(done, totalDays) / totalDays) * 100) : 0);
        summaries.set(s.student_id, {
          requirements_rate: requirementsTotal
            ? Math.round((Math.min(docsByStudent.get(s.student_id)?.verified || 0, requirementsTotal) / requirementsTotal) * 100)
            : 0,
          requirements_total: requirementsTotal,
          attendance_rate: pct(present),
          attendance_total: totalDays,
          documentation_rate: pct(docsDone),
          documentation_total: totalDays,
        });
      }

      const enrichedStudents = students.map((s) => {
        const docs = docsByStudent.get(s.student_id) || { total: 0, verified: 0 };
        const attendanceDays = attByStudent.get(s.student_id) || 0;
        const completed = s.partner_managed
          ? Number(summaries.get(s.student_id)?.attendance_total) > 0 && summaries.get(s.student_id)?.attendance_rate === 100
          : s.requirements_status === 'Approved' && docs.total > 0 && docs.verified === docs.total && attendanceDays >= 10;
        return {
          ...s,
          attendance_days: attendanceDays,
          total_documents: docs.total,
          verified_documents: docs.verified,
          completed,
          ...(summaries.get(s.student_id) || {}),
        };
      });

      enriched.push({ ...batch, students: enrichedStudents });
    }
    res.json({ batches: enriched });
  } catch (err) {
    console.error('getSupervisorBatchStudents error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const getBatchAttendance = async (req, res) => {
  try {
    const supervisorUserId = req.user.id;
    const { requestId } = req.params;
    const { rows: [batch] } = await pool.query(
      `SELECT tb.batch_label, dr.confirmed_schedule->'dates' AS dates
       FROM teacher_batches tb JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id
       WHERE tb.id = $1 AND tb.supervisor_id = $2 AND tb.archived_at IS NULL AND dr.workflow_version = 2 AND dr.status = 'approved'`,
      [requestId, supervisorUserId]);
    if (!batch) return res.status(404).json({ error: 'Deployment not found.' });
    const usersResult = await pool.query(
      `SELECT s.user_id FROM teacher_batch_students tbs JOIN students s ON s.id = tbs.student_id
       WHERE tbs.teacher_batch_id = $1 AND tbs.deployment_ended_on IS NULL`, [requestId]);
    const userIds = usersResult.rows.map((row) => row.user_id);
    if (!userIds.length) return res.json({ batch_label: batch.batch_label, students: [], days: [], dates: [], summary: { total_students: 0, days: 0 } });

    const immersionDays = (batch.dates || []).map((date, index) => ({ date, number: index + 1 }));
    const dates = immersionDays.map((day) => day.date);
    const { from, to } = req.query;
    const filters = [];
    const params = [userIds, dates, requestId];
    if (from) { params.push(from); filters.push(`AND sa.date >= $${params.length}`); }
    if (to) { params.push(to); filters.push(`AND sa.date <= $${params.length}`); }
    const recordsResult = await pool.query(`SELECT sa.id, sa.student_id, sa.date, sa.status, sa.check_in_time, sa.check_out_time, sa.appeal_time_in_id, sa.appeal_time_out_id
      FROM student_attendance sa JOIN students s ON s.id = sa.student_id
      WHERE s.user_id = ANY($1::int[]) AND sa.date = ANY($2::date[]) AND sa.teacher_batch_id = $3 ${filters.join(' ')} ORDER BY sa.date ASC`, params);
    const records = new Map(recordsResult.rows.map((row) => [`${row.student_id}:${String(row.date).slice(0, 10)}`, row]));

    // Pull the appeal reasons so the supervisor can read why a student was
    // marked late / missing without opening another page.
    const appealIds = [
      ...new Set(
        recordsResult.rows
          .flatMap((row) => [row.appeal_time_in_id, row.appeal_time_out_id])
          .filter(Boolean)
      ),
    ];
    const appealsById = new Map();
    if (appealIds.length) {
      const appealRes = await pool.query(
        `SELECT id, student_id, attendance_type, appeal_date, excuse, file_url, file_name,
                status, teacher_comment, created_at, reviewed_at
         FROM attendance_appeals WHERE id = ANY($1::int[])`,
        [appealIds]
      );
      for (const appeal of appealRes.rows) appealsById.set(appeal.id, shapeAppeal(appeal));
    }

    // The `appeal_time_in_id` / `appeal_time_out_id` columns on student_attendance
    // are only written when a teacher APPROVES the appeal (see reviewAppeal), and
    // only then. Relying on them alone means a PENDING appeal — the one the
    // supervisor most needs to see — renders no button at all, and a REJECTED
    // appeal is never shown either. So also look appeals up directly by
    // student + date + attendance_type. Attendance appeals only exist for
    // teacher batches (attendance_appeals.teacher_batch_id references
    // teacher_batches), so deployment batches are skipped.
    const directAppeals = new Map();
    if (dates.length > 0) {
      const directRes = await pool.query(
        `SELECT a.id, a.student_id, a.attendance_type, a.appeal_date, a.excuse,
                a.file_url, a.file_name, a.status, a.teacher_comment,
                a.created_at, a.reviewed_at
         FROM attendance_appeals a
         JOIN students s ON s.id = a.student_id
         WHERE s.user_id = ANY($1::int[])
           AND a.appeal_date = ANY($2::date[]) AND a.teacher_batch_id = $3
         ORDER BY a.created_at DESC`,
        [userIds, dates, requestId]
      );
      for (const appeal of directRes.rows) {
        const key = `${appeal.student_id}:${formatDateOnly(appeal.appeal_date)}:${appeal.attendance_type}`;
        // Newest first, so keep the first hit for a given day/type.
        if (!directAppeals.has(key)) directAppeals.set(key, shapeAppeal(appeal));
      }
    }

    // Prefer the appeal the attendance row explicitly links to; otherwise fall
    // back to the direct lookup so unreviewed appeals still surface.
    const appealFor = (studentId, dateKey, type, linkedId) => {
      const linked = linkedId ? appealsById.get(linkedId) : null;
      if (linked) return linked;
      return directAppeals.get(`${studentId}:${dateKey}:${type}`) || null;
    };

    const studentsResult = await pool.query(`SELECT s.id AS student_id, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand, s.photo_url, u.email
      FROM students s JOIN users u ON u.id = s.user_id WHERE s.user_id = ANY($1::int[]) ORDER BY s.last_name, s.first_name`, [userIds]);
    const students = studentsResult.rows.map((student) => ({
      ...student,
      days: Object.fromEntries(immersionDays.map((day) => {
        const row = records.get(`${student.student_id}:${day.date}`);
        const dateKey = String(row ? row.date : day.date).slice(0, 10);
        // No record at all means attendance was never taken for that day, so it
        // must NOT be reported as absent — but the student may still have filed
        // an appeal for it, which is exactly the case that needs surfacing.
        return [String(day.number), row ? { record_id: row.id, date: day.date, status: row.status, recorded: true, check_in_time: row.check_in_time, check_out_time: row.check_out_time, appeal_time_in_id: row.appeal_time_in_id, appeal_time_out_id: row.appeal_time_out_id, appeal_time_in: appealFor(row.student_id, dateKey, 'time_in', row.appeal_time_in_id), appeal_time_out: appealFor(row.student_id, dateKey, 'time_out', row.appeal_time_out_id) } : { date: day.date, status: null, recorded: false, check_in_time: null, check_out_time: null, appeal_time_in_id: null, appeal_time_out_id: null, appeal_time_in: appealFor(student.student_id, dateKey, 'time_in', null), appeal_time_out: appealFor(student.student_id, dateKey, 'time_out', null) }];
      })),
    }));
    res.json({ batch_label: batch.batch_label, students, days: immersionDays.map((day) => day.number), dates, summary: { total_students: students.length, days: immersionDays.length } });
  } catch (err) {
    console.error('getBatchAttendance error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const createReportConcern = async (req, res) => {
  try {
    const supervisorUserId = req.user.id;
    const studentId = Number(req.body.student_id);
    const institutionId = req.body.partner_institution_id == null ? null : Number(req.body.partner_institution_id);
    const batchId = req.body.batch_id == null ? null : Number(req.body.batch_id);
    const category = String(req.body.category || '').trim();
    const priority = String(req.body.priority || 'normal').trim().toLowerCase();
    const message = String(req.body.message || '').trim();
    const validId = (id) => Number.isInteger(id) && id > 0 && id <= 2147483647;

    if (!validId(studentId) || (institutionId === null && batchId === null) ||
        (institutionId !== null && !validId(institutionId)) || (batchId !== null && !validId(batchId)) ||
        !category || category.length > 80 || !message) {
      return res.status(400).json({ error: 'Select a partner institution and student, and enter a category and report details.' });
    }

    await ensureSupervisorReportsTable();
    const { rows: [created] } = await pool.query(`WITH assigned AS (
      SELECT tb.id AS batch_id, teacher.id AS teacher_id, teacher.user_id AS teacher_user_id,
        pi.id AS partner_institution_id, pi.name AS partner_institution_name
      FROM teacher_batches tb
      JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
      JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
      JOIN teacher_batch_students member ON member.teacher_batch_id = tb.id
      JOIN teachers teacher ON teacher.id = tb.teacher_id
      CROSS JOIN (SELECT to_char(now() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS today) calendar
      WHERE tb.supervisor_id = $1 AND dr.supervisor_id = $1 AND member.student_id = $2
        AND ($3::int IS NULL OR pi.id = $3) AND ($4::int IS NULL OR tb.id = $4)
        AND tb.archived_at IS NULL AND member.deployment_ended_on IS NULL
      ORDER BY CASE WHEN calendar.today BETWEEN
        COALESCE(member.deployment_started_on::text, dr.confirmed_schedule->>'start')
        AND dr.confirmed_schedule->>'end' THEN 0
        WHEN calendar.today < COALESCE(member.deployment_started_on::text, dr.confirmed_schedule->>'start') THEN 1
        ELSE 2 END,
        CASE WHEN calendar.today < COALESCE(member.deployment_started_on::text, dr.confirmed_schedule->>'start')
          THEN COALESCE(member.deployment_started_on::text, dr.confirmed_schedule->>'start') END,
        tb.id DESC
      LIMIT 1
    ), report AS (
      INSERT INTO supervisor_reports (supervisor_id, student_id, batch_id, batch_source, teacher_id, category, priority, message)
      SELECT $1, $2, batch_id, 'teacher', teacher_id, $5, $6, $7 FROM assigned
      RETURNING *
    )
    SELECT report.*, assigned.teacher_user_id, assigned.partner_institution_id, assigned.partner_institution_name
    FROM report JOIN assigned ON assigned.batch_id = report.batch_id`,
    [supervisorUserId, studentId, institutionId, batchId, category,
      ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal', message]);

    if (!created) return res.status(404).json({ error: 'This student has no deployment with an assigned teacher at the selected institution.' });
    const { teacher_user_id: teacherUserId, ...report } = created;

    res.status(201).json({ message: 'Report submitted.', report });
    void createNotification({
      userId: teacherUserId,
      title: 'New report or concern from supervisor',
      message: `A ${report.priority} priority ${report.category} report was submitted for a student at ${report.partner_institution_name}.`,
      type: 'report',
      category: 'reports',
      priority: report.priority,
      actionUrl: '/dashboard/teacher/reports-concerns',
      relatedUserId: supervisorUserId,
      entityType: 'supervisor_report',
      entityId: report.id,
      eventKey: `supervisor-report:${report.id}:created`,
    }).catch((err) => console.error('Teacher report-concern notification failed:', err.message));
  } catch (err) {
    console.error('createReportConcern error:', err);
    res.status(500).json({ error: 'Failed to submit report.' });
  }
};

const reportInstitutionJoins = `
  LEFT JOIN teacher_batches tb ON r.batch_source = 'teacher' AND tb.id = r.batch_id
  LEFT JOIN deployment_requests placement ON placement.teacher_batch_id = tb.id AND placement.workflow_version = 2
  LEFT JOIN retired_deployment_requests dr ON r.batch_source = 'deployment' AND dr.original_request_id = r.batch_id
  LEFT JOIN partner_institutions pi ON pi.id = COALESCE(placement.partner_institution_id, tb.partner_institution_id,
    (dr.snapshot->'request'->>'partner_institution_id')::int)
`;

const getReportsConcerns = async (req, res) => {
  try {
    await ensureSupervisorReportsTable();

    const result = await pool.query(
      `SELECT r.*, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand,
              pi.id AS partner_institution_id, pi.name AS partner_institution_name,
              COALESCE(tb.batch_label, dr.snapshot->'request'->>'batch_label', 'Deployment') AS batch_label
       FROM supervisor_reports r
       JOIN students s ON s.id = r.student_id
       ${reportInstitutionJoins}
       WHERE r.supervisor_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    res.json({ reports: result.rows });
  } catch (err) {
    console.error('getReportsConcerns error:', err);
    res.status(500).json({ error: 'Failed to load reports.' });
  }
};

// The supervisor owns the reports they filed, so they can withdraw one.
// Scoped by supervisor_id so nobody can delete someone else's report.
const deleteReportConcern = async (req, res) => {
  try {
    await ensureSupervisorReportsTable();

    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId)) {
      return res.status(400).json({ error: 'Invalid report id.' });
    }

    const result = await pool.query(
      'DELETE FROM supervisor_reports WHERE id = $1 AND supervisor_id = $2 RETURNING id',
      [reportId, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('deleteReportConcern error:', err);
    res.status(500).json({ error: 'Failed to delete report.' });
  }
};

const getTeacherReportsConcerns = async (req, res) => {
  try {
    await ensureSupervisorReportsTable();

    const teacherUserId = req.user.id;

    const teacherRow = await pool.query(
      "SELECT id FROM teachers WHERE user_id = $1",
      [teacherUserId]
    );
    if (!teacherRow.rows.length) {
      return res.status(400).json({ error: 'Teacher profile not found.' });
    }
    const teacherId = teacherRow.rows[0].id;

    const result = await pool.query(
      `SELECT r.*, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand,
              pi.id AS partner_institution_id, pi.name AS partner_institution_name,
              COALESCE(tb.batch_label, dr.snapshot->'request'->>'batch_label', 'Deployment') AS batch_label,
              tb.id AS teacher_batch_id,
              sup.first_name AS supervisor_first_name, sup.last_name AS supervisor_last_name,
              sup.employee_id AS supervisor_employee_id, sup.company_name AS supervisor_company
       FROM supervisor_reports r
       JOIN students s ON s.id = r.student_id
       ${reportInstitutionJoins}
       LEFT JOIN supervisors sup ON sup.user_id = r.supervisor_id
       WHERE r.teacher_id = $1
       ORDER BY r.created_at DESC`,
      [teacherId]
    );

    res.json({ reports: result.rows });
  } catch (err) {
    console.error('getTeacherReportsConcerns error:', err);
    res.status(500).json({ error: 'Failed to load reports.' });
  }
};

const confirmReportConcern = async (req, res) => {
  try {
    await ensureSupervisorReportsTable();

    const teacherUserId = req.user.id;
    const teacherRow = await pool.query(
      "SELECT id FROM teachers WHERE user_id = $1",
      [teacherUserId]
    );
    if (!teacherRow.rows.length) {
      return res.status(400).json({ error: 'Teacher profile not found.' });
    }
    const teacherId = teacherRow.rows[0].id;

    const reportId = Number(req.params.reportId);
    if (!reportId) {
      return res.status(400).json({ error: 'Report ID is required.' });
    }

    const ownership = await pool.query(
      `SELECT id, supervisor_id, teacher_id, category, priority, status
       FROM supervisor_reports
       WHERE id = $1 AND teacher_id = $2`,
      [reportId, teacherId]
    );
    if (!ownership.rows.length) {
      return res.status(404).json({ error: 'Report or concern not found.' });
    }

    const report = ownership.rows[0];
    if (report.status === 'resolved') {
      return res.json({ message: 'Report already confirmed.', report });
    }

    const result = await pool.query(
      `UPDATE supervisor_reports
       SET status = 'resolved', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [reportId]
    );

    res.json({ message: 'Report confirmed.', report: result.rows[0] });

    // Notify the supervisor that the teacher confirmed the report/concern.
    if (report.supervisor_id) {
      void createNotification({
        userId: report.supervisor_id,
        title: 'Report confirmed by teacher',
        message: `A ${report.priority || 'normal'} priority ${report.category} report was confirmed by the teacher.`,
        type: 'report',
        category: 'reports',
        priority: report.priority || 'normal',
        actionUrl: '/dashboard/supervisor/reports-concerns',
        relatedUserId: teacherUserId,
        entityType: 'supervisor_report',
        entityId: reportId,
        eventKey: `supervisor-report:${reportId}:confirmed`,
      }).catch((err) => console.error('Supervisor confirm notification failed:', err.message));
    }
  } catch (err) {
    console.error('confirmReportConcern error:', err);
    res.status(500).json({ error: 'Failed to confirm report.' });
  }
};

module.exports = {
  getSupervisorBatchStudents,
  getSupervisorPartnerInstitutions,
  getSupervisorPartnerInstitutionStudents,
  getStudentProgress,
  getBatchAttendance,
  createReportConcern,
  getReportsConcerns,
  deleteReportConcern,
  getTeacherReportsConcerns,
  confirmReportConcern,
};
