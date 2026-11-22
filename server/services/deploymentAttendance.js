function requiredAttendanceDays(schedule) {
  return Math.ceil(Number(schedule.required_hours) / Number(schedule.daily_hours));
}

async function getDeploymentAttendance(db, studentId, supervisorId, batchId = null) {
  const { rows: [placement] } = await db.query(`
    SELECT tb.id AS batch_id, dr.confirmed_schedule,
      COUNT(DISTINCT sa.date)::int AS attendance_days
    FROM teacher_batch_students tbs
    JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id AND tb.archived_at IS NULL
    JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
    LEFT JOIN student_attendance sa ON sa.student_id = tbs.student_id AND sa.teacher_batch_id = tb.id
      AND sa.check_in_time IS NOT NULL AND sa.check_out_time IS NOT NULL
      AND (dr.confirmed_schedule->'dates') ? sa.date::text
      AND (tbs.deployment_started_on IS NULL OR sa.date >= tbs.deployment_started_on)
    WHERE tbs.student_id = $1 AND ($2::int IS NULL OR tb.supervisor_id = $2)
      AND ($3::int IS NULL OR tb.id = $3) AND tbs.deployment_ended_on IS NULL
    GROUP BY tb.id, dr.id, tbs.assigned_at
    ORDER BY tbs.assigned_at DESC, tb.id DESC LIMIT 1`, [studentId, supervisorId, batchId]);
  return placement ? { ...placement, required_attendance_days: requiredAttendanceDays(placement.confirmed_schedule) } : null;
}

module.exports = { getDeploymentAttendance, requiredAttendanceDays };
