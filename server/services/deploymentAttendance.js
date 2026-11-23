function requiredAttendanceDays(schedule) {
  const hours = Number(schedule?.required_hours);
  const dailyHours = Number(schedule?.daily_hours);
  return hours > 0 && dailyHours > 0 ? Math.ceil(hours / dailyHours) : schedule?.dates?.length || Infinity;
}

async function listDeploymentAttendance(db, { studentId = null, supervisorId, batchId = null, institutionId = null, deploymentRequestId = null }) {
  const { rows } = await db.query(`
    SELECT tb.id AS batch_id, tb.batch_label, dr.id AS deployment_request_id, dr.confirmed_schedule,
      pi.id AS partner_institution_id, pi.name AS partner_institution_name,
      s.id AS student_id, s.user_id, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand, u.email,
      COUNT(DISTINCT sa.date)::int AS attendance_days
    FROM teacher_batch_students tbs
    JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id AND tb.archived_at IS NULL
    JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
    JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
    JOIN students s ON s.id = tbs.student_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN student_attendance sa ON sa.student_id = tbs.student_id AND sa.teacher_batch_id = tb.id
      AND sa.check_in_time IS NOT NULL AND sa.check_out_time IS NOT NULL
      AND (dr.confirmed_schedule->'dates') ? sa.date::text
      AND (tbs.deployment_started_on IS NULL OR sa.date >= tbs.deployment_started_on)
    WHERE ($1::int IS NULL OR tbs.student_id = $1)
      AND ($2::int IS NULL OR (tb.supervisor_id = $2 AND dr.supervisor_id = $2))
      AND ($3::int IS NULL OR tb.id = $3) AND ($4::int IS NULL OR pi.id = $4)
      AND ($5::int IS NULL OR dr.id = $5)
      AND tbs.deployment_ended_on IS NULL
    GROUP BY tb.id, dr.id, pi.id, s.id, u.id, tbs.assigned_at
    ORDER BY tbs.assigned_at DESC, tb.id DESC`, [studentId, supervisorId, batchId, institutionId, deploymentRequestId]);
  return rows.map((row) => ({ ...row, required_attendance_days: requiredAttendanceDays(row.confirmed_schedule) }));
}

async function getDeploymentAttendance(db, studentId, supervisorId, batchId = null, institutionId = null) {
  const [placement] = await listDeploymentAttendance(db, { studentId, supervisorId, batchId, institutionId });
  return placement || null;
}

module.exports = { getDeploymentAttendance, listDeploymentAttendance };
