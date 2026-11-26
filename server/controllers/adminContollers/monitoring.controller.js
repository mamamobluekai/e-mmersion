const pool = require('../../db');
const { getPreImmersion, getRequirementProgress, getStudentJourney } = require('../../services/studentJourney.service');
const { nowInManilaDateOnly } = require('../../utils/manilaDate');
const { ensureFeedbackSchema } = require('../evaluationControllers/immersionFeedback.controller');

const PAGE_SIZE = 20;
const roles = new Map([
  ['student', {
    table: 'students',
    fields: `p.student_number AS identifier, p.track_strand AS affiliation, p.section AS subgroup,
             p.archived_at, p.preferred_partner_institution_id`,
  }],
  ['supervisor', {
    table: 'supervisors',
    fields: 'p.employee_id AS identifier, p.company_name AS affiliation, p.designation AS subgroup, NULL AS archived_at',
  }],
  ['teacher', {
    table: 'teachers',
    fields: 'p.employee_id AS identifier, p.school AS affiliation, p.department AS subgroup, NULL AS archived_at',
  }],
]);
const accountGroups = new Set(['all', 'active', 'pending', 'other', 'archived']);

function profilesQuery(role) {
  const { table, fields } = roles.get(role);
  const archiveCheck = role === 'student' ? "WHEN p.archived_at IS NOT NULL THEN 'archived'" : '';
  return `SELECT u.id, p.id AS profile_id, u.email, u.status, to_jsonb(u)->>'last_login' AS last_login,
            COALESCE(NULLIF(concat_ws(' ', p.first_name, p.last_name), ''), u.email) AS name,
            ip.period_name, ${fields},
            CASE ${archiveCheck}
              WHEN lower(u.status) IN ('approved', 'active') THEN 'active'
              WHEN lower(u.status) = 'pending' THEN 'pending'
              ELSE 'other'
            END AS account_group
          FROM users u
          LEFT JOIN ${table} p ON p.user_id = u.id
          LEFT JOIN immersion_periods ip ON ip.id = u.immersion_period_id
          WHERE u.role = $1`;
}

async function listMonitoring(req, res) {
  const { role } = req.params;
  if (!roles.has(role)) return res.status(404).json({ error: 'Monitoring role not found.' });

  const { search = '', status = 'all', page = '1' } = req.query;
  if (typeof search !== 'string' || search.length > 100 || !accountGroups.has(status) ||
      typeof page !== 'string' || !/^[1-9]\d{0,6}$/.test(page)) {
    return res.status(400).json({ error: 'Invalid monitoring filters.' });
  }

  try {
    const { rows: [result] } = await pool.query(`
      WITH matching AS (
        SELECT * FROM (${profilesQuery(role)}) profiles
        WHERE ($2 = '' OR strpos(lower(concat_ws(' ', name, email, identifier, affiliation, subgroup, period_name)), lower($2)) > 0)
          AND ($3 = 'all' OR account_group = $3)
      ), paged AS (
        SELECT * FROM matching ORDER BY lower(name), id LIMIT $4 OFFSET $5
      )
      SELECT (SELECT count(*)::int FROM matching) AS total,
             COALESCE(jsonb_agg(to_jsonb(paged) ORDER BY lower(name), id), '[]'::jsonb) AS profiles
      FROM paged`, [role, search.trim(), status, PAGE_SIZE, (Number(page) - 1) * PAGE_SIZE]);
    if (role === 'student') {
      const requirementProgress = await getRequirementProgress(result.profiles.map(({ id }) => id));
      for (const profile of result.profiles) {
        const { displayStatus, approved, total } = requirementProgress.get(profile.id);
        profile.requirements = { status: displayStatus, approved, total };
      }
    }
    return res.json({ ...result, page: Number(page), pageSize: PAGE_SIZE });
  } catch (error) {
    console.error('Admin monitoring list failed:', error.code || error.name, error.message);
    return res.status(503).json({ error: 'Could not load monitoring records. Try again.' });
  }
}

const studentPlacements = `
  WITH membership AS (
    SELECT * FROM teacher_batch_students WHERE student_id = $1
  ), decisions AS (
    SELECT * FROM partner_student_assignments WHERE student_id = $1
  ), assignments AS (
    SELECT dr.id AS deployment_id, m.teacher_batch_id, m.deployment_started_on, m.deployment_ended_on, d.status AS decision
    FROM membership m
    LEFT JOIN deployment_requests dr ON dr.teacher_batch_id = m.teacher_batch_id AND dr.workflow_version = 2
    LEFT JOIN decisions d ON d.deployment_request_id = dr.id
    UNION ALL
    SELECT d.deployment_request_id, NULL, NULL, NULL, d.status
    FROM decisions d
    WHERE NOT EXISTS (
      SELECT 1 FROM membership m JOIN deployment_requests dr ON dr.teacher_batch_id = m.teacher_batch_id
      WHERE dr.id = d.deployment_request_id AND dr.workflow_version = 2
    )
  )
  SELECT COALESCE(tb.batch_label, dr.batch_label) AS label, a.deployment_id, a.teacher_batch_id AS batch_id,
         pi.name AS partner, ip.period_name, a.decision, dr.status AS deployment_status,
         COALESCE(a.deployment_started_on::text, dr.confirmed_schedule->>'start') AS start_date,
         dr.confirmed_schedule->>'end' AS scheduled_end, a.deployment_ended_on AS released_on,
         tb.archived_at IS NOT NULL AS archived,
         NULLIF(concat_ws(' ', sv.first_name, sv.last_name), '') AS supervisor,
         COALESCE(team.names, NULLIF(concat_ws(' ', t.first_name, t.last_name), '')) AS teachers
  FROM assignments a
  LEFT JOIN deployment_requests dr ON dr.id = a.deployment_id
  LEFT JOIN teacher_batches tb ON tb.id = a.teacher_batch_id
  LEFT JOIN partner_institutions pi ON pi.id = COALESCE(dr.partner_institution_id, tb.partner_institution_id)
  LEFT JOIN immersion_periods ip ON ip.id = COALESCE(dr.immersion_period_id, tb.immersion_period_id)
  LEFT JOIN supervisors sv ON sv.user_id = COALESCE(dr.supervisor_id, tb.supervisor_id)
  LEFT JOIN teachers t ON t.id = COALESCE(dr.teacher_id, tb.teacher_id)
  LEFT JOIN LATERAL (
    SELECT string_agg(concat_ws(' ', teacher.first_name, teacher.last_name), ', ' ORDER BY teacher.last_name, teacher.id) AS names
    FROM partner_deployment_teachers link JOIN teachers teacher ON teacher.id = link.teacher_id
    WHERE link.deployment_request_id = dr.id
  ) team ON true
  ORDER BY (a.deployment_ended_on IS NOT NULL OR tb.archived_at IS NOT NULL) ASC,
           COALESCE(dr.updated_at, tb.updated_at) DESC NULLS LAST, a.teacher_batch_id DESC`;

async function getStudentMonitoring(profile) {
  const [preImmersion] = await Promise.all([getPreImmersion(profile.id, { includeChecklist: true }), ensureFeedbackSchema()]);
  const [journey, placements, records] = await Promise.all([
    getStudentJourney(profile.id, preImmersion),
    pool.query(studentPlacements, [profile.profile_id]),
    pool.query(`SELECT
      (SELECT name FROM partner_institutions WHERE id = $2) AS preferred_partner,
      (SELECT count(*)::int FROM attendance_appeals WHERE student_id = $1 AND status = 'pending') AS attendance_appeals,
      (SELECT count(*)::int FROM grade_appeals WHERE student_id = $1 AND status = 'pending') AS grade_appeals,
      (SELECT count(*)::int FROM student_evaluations WHERE student_id = $1
        AND (overall_score IS NOT NULL OR overall_percentage IS NOT NULL)) AS evaluations,
      (SELECT count(*)::int FROM certificates WHERE student_id = $1 AND NULLIF(cloudinary_url, '') IS NOT NULL) AS certificates,
      (SELECT count(*)::int FROM work_immersion_feedback WHERE student_id = $1) AS feedback`,
    [profile.profile_id, profile.preferred_partner_institution_id]),
  ]);
  // The monitoring view needs status and hours. Attendance timestamps stay on the student record.
  const days = journey.days.map((day) => ({
    date: day.date,
    batchLabel: day.batchLabel,
    attendance: day.attendance.status,
    documentation: day.documentation.status,
    recordedHours: day.attendance.recordedHours,
  }));
  return { journey: { ...journey, days }, placements: placements.rows, records: records.rows[0] };
}

function staffDeployments(role) {
  const deploymentScope = role === 'teacher'
    ? `(dr.teacher_id = $1 OR EXISTS (SELECT 1 FROM partner_deployment_teachers t
         WHERE t.deployment_request_id = dr.id AND t.teacher_id = $1))`
    : 'dr.supervisor_id = $1';
  const batchScope = role === 'teacher' ? 'tb.teacher_id = $1' : 'tb.supervisor_id = $1';
  const reviewCounts = role === 'teacher'
    ? `(SELECT count(*)::int FROM student_daily_documentation d WHERE d.teacher_batch_id = sd.batch_id
         AND d.status = 'submitted') AS pending_documentation,
       (SELECT count(*)::int FROM student_daily_documentation d WHERE d.teacher_batch_id = sd.batch_id
         AND d.status IN ('graded', 'reviewed')) AS reviewed_documentation,
       (SELECT count(*)::int FROM attendance_appeals a WHERE a.teacher_batch_id = sd.batch_id
         AND a.status = 'pending') AS attendance_appeals`
    : `(SELECT count(DISTINCT e.student_id)::int FROM student_evaluations e
         WHERE e.batch_id = sd.batch_id AND e.evaluator_id = $1
           AND (e.overall_score IS NOT NULL OR e.overall_percentage IS NOT NULL)) AS evaluated_students,
       (SELECT count(*)::int FROM grade_appeals a JOIN student_evaluations e ON e.id = a.evaluation_id
         WHERE COALESCE(a.batch_id, e.batch_id) = sd.batch_id AND e.evaluator_id = $1 AND a.status = 'pending') AS grade_appeals,
       (SELECT count(*)::int FROM certificates c WHERE c.teacher_batch_id = sd.batch_id AND c.issued_by = $1
         AND NULLIF(c.cloudinary_url, '') IS NOT NULL) AS certificates,
       (SELECT count(*)::int FROM work_immersion_feedback f WHERE f.deployment_request_id = sd.deployment_id
         AND f.supervisor_id = $1) AS feedback`;
  const reportScope = role === 'teacher' ? '' : 'AND r.supervisor_id = $1';
  return `WITH scoped AS (
    SELECT dr.id AS deployment_id, dr.teacher_batch_id AS batch_id,
           dr.batch_label AS label, dr.partner_institution_id AS partner_id, dr.immersion_period_id AS period_id,
           CASE WHEN dr.status = 'approved' AND dr.teacher_batch_id IS NOT NULL
             THEN CASE WHEN dr.confirmed_schedule->>'end' < $2::text THEN 'completed'
                       WHEN dr.confirmed_schedule->>'start' <= $2::text THEN 'ongoing' ELSE 'upcoming' END
             ELSE dr.status END AS status,
           dr.confirmed_schedule->>'start' AS starts_on, dr.confirmed_schedule->>'end' AS ends_on,
           dr.schedule_amendment IS NOT NULL AS amendment_pending,
           CASE WHEN jsonb_typeof(dr.confirmed_schedule->'dates') = 'array'
                THEN jsonb_array_length(dr.confirmed_schedule->'dates') END AS scheduled_days, dr.updated_at
    FROM deployment_requests dr WHERE dr.workflow_version = 2 AND ${deploymentScope}
    UNION ALL
    SELECT NULL, tb.id, tb.batch_label, tb.partner_institution_id, tb.immersion_period_id,
           'batch', NULL, NULL, false, NULL, tb.updated_at
    FROM teacher_batches tb WHERE ${batchScope}
      AND NOT EXISTS (SELECT 1 FROM deployment_requests dr WHERE dr.teacher_batch_id = tb.id AND dr.workflow_version = 2)
  )
  SELECT sd.deployment_id, sd.batch_id, sd.label, sd.status, sd.starts_on, sd.ends_on, sd.amendment_pending, sd.scheduled_days,
         pi.name AS partner, ip.period_name, tb.archived_at IS NOT NULL AS archived,
         EXISTS (SELECT 1 FROM attendance_config ac WHERE ac.teacher_batch_id = sd.batch_id) AS attendance_configured,
         (SELECT count(*)::int FROM teacher_batch_students r WHERE r.teacher_batch_id = sd.batch_id) AS roster_students,
         (SELECT count(*)::int FROM teacher_batch_students r
           WHERE r.teacher_batch_id = sd.batch_id AND tb.archived_at IS NULL
             AND (r.deployment_started_on IS NULL OR r.deployment_started_on <= $2::date)
             AND (r.deployment_ended_on IS NULL OR r.deployment_ended_on > $2::date)) AS current_roster,
         (SELECT count(*)::int FROM partner_student_assignments a
           WHERE a.deployment_request_id = sd.deployment_id AND a.status = 'pending') AS pending_placements,
         (SELECT count(*)::int FROM student_attendance a WHERE a.teacher_batch_id = sd.batch_id) AS attendance_records,
         (SELECT count(*)::int FROM student_attendance a WHERE a.teacher_batch_id = sd.batch_id
           AND a.status = 'absent') AS recorded_absences,
         (SELECT count(*)::int FROM supervisor_reports r
           WHERE r.batch_source = 'teacher' AND r.batch_id = sd.batch_id AND r.status = 'open' ${reportScope}) AS open_reports,
         ${reviewCounts}
  FROM scoped sd
  LEFT JOIN teacher_batches tb ON tb.id = sd.batch_id
  LEFT JOIN partner_institutions pi ON pi.id = sd.partner_id
  LEFT JOIN immersion_periods ip ON ip.id = sd.period_id
  ORDER BY (tb.archived_at IS NOT NULL), sd.updated_at DESC NULLS LAST, sd.deployment_id DESC, sd.batch_id DESC`;
}

async function getStaffMonitoring(profile, role) {
  const actorId = role === 'teacher' ? profile.profile_id : profile.id;
  if (role === 'supervisor') await ensureFeedbackSchema();
  const { rows: deployments } = await pool.query(staffDeployments(role), [actorId, nowInManilaDateOnly()]);
  if (role === 'teacher') return { deployments };

  const { rows: partners } = await pool.query(`SELECT pi.name, pi.is_active
    FROM partner_institutions pi
    WHERE EXISTS (SELECT 1 FROM partner_institution_supervisor_history h
        WHERE h.institution_id = pi.id AND h.supervisor_user_id = $1 AND h.ended_at IS NULL)
       OR EXISTS (SELECT 1 FROM partner_deployment_supervisors d
        WHERE d.institution_id = pi.id AND d.supervisor_user_id = $1)
    ORDER BY lower(pi.name), pi.id`, [profile.id]);
  return { deployments, partners };
}

async function monitoringDetail(req, res) {
  const { role, userId } = req.params;
  if (!roles.has(role)) return res.status(404).json({ error: 'Monitoring role not found.' });
  if (!/^[1-9]\d{0,9}$/.test(userId) || Number(userId) > 2147483647) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  try {
    const { rows: [profile] } = await pool.query(`${profilesQuery(role)} AND u.id = $2`, [role, userId]);
    if (!profile) return res.status(404).json({ error: 'Monitoring record not found.' });
    if (!profile.profile_id) return res.json({ profile, details: null });

    const details = role === 'student' ? await getStudentMonitoring(profile) : await getStaffMonitoring(profile, role);
    return res.json({ profile, details });
  } catch (error) {
    console.error('Admin monitoring detail failed:', error.code || error.name, error.message);
    return res.status(503).json({ error: 'Could not load the monitoring record. Try again.' });
  }
}

module.exports = { listMonitoring, monitoringDetail };
