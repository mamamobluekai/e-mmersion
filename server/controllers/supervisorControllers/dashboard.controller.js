const pool = require('../../db');

const getSupervisorDashboard = async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const batchesResult = await pool.query(
      `WITH supervisor_batches AS (
        SELECT tb.id AS request_id, tb.batch_label, NULL AS strand,
               c.first_name AS coordinator_first_name,
               c.last_name AS coordinator_last_name,
               'teacher' AS source
        FROM teacher_batches tb
        JOIN coordinators c ON c.id = tb.coordinator_id
        JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
        WHERE tb.supervisor_id = $1 AND tb.archived_at IS NULL
      ), assigned AS (
        SELECT sb.request_id, sb.source, tbs.student_id
        FROM supervisor_batches sb
        JOIN teacher_batch_students tbs
          ON tbs.teacher_batch_id = sb.request_id AND tbs.deployment_ended_on IS NULL
      )
      SELECT sb.*,
             COUNT(DISTINCT a.student_id)::int AS student_count
      FROM supervisor_batches sb
      LEFT JOIN assigned a ON a.request_id = sb.request_id AND a.source = sb.source
      GROUP BY sb.request_id, sb.batch_label, sb.strand,
               sb.coordinator_first_name, sb.coordinator_last_name, sb.source
      ORDER BY sb.request_id DESC`,
      [supervisorId]
    );

    const [scheduleResult, assignedResult] = await Promise.all([
      pool.query(
        `SELECT tb.id AS request_id, 'teacher' AS source, dr.confirmed_schedule->'dates' AS dates
         FROM teacher_batches tb
         JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
         WHERE tb.supervisor_id = $1 AND tb.archived_at IS NULL`,
        [supervisorId]
      ),
      pool.query(
        `WITH assigned AS (
          SELECT tb.id AS request_id, 'teacher' AS source, tbs.student_id
          FROM teacher_batches tb
          JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = tb.id
          JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
          WHERE tb.supervisor_id = $1 AND tb.archived_at IS NULL AND tbs.deployment_ended_on IS NULL
        )
        SELECT * FROM assigned ORDER BY source, request_id, student_id`,
        [supervisorId]
      ),
    ]);

    const scheduleByBatch = new Map(scheduleResult.rows.map(({ request_id, dates }) => [request_id, dates || []]));
    const scheduledDates = [...new Set([...scheduleByBatch.values()].flat())].sort();
    const assignedRows = assignedResult.rows;
    let attendanceRows = [];

    if (assignedRows.length && scheduledDates.length) {
      const studentIds = [...new Set(assignedRows.map((row) => row.student_id))];
      const attendanceResult = await pool.query(
        `SELECT teacher_batch_id, student_id, date, status, check_in_time, check_out_time,
                appeal_time_in_id, appeal_time_out_id
         FROM student_attendance
         WHERE student_id = ANY($1::int[])
           AND date = ANY($2::date[]) AND teacher_batch_id = ANY($3::int[])`,
        [studentIds, scheduledDates, [...scheduleByBatch.keys()]]
      );
      const attendanceByStudentDate = new Map(attendanceResult.rows.map((row) => [
        `${row.teacher_batch_id}:${row.student_id}:${row.date}`,
        row,
      ]));

      attendanceRows = assignedRows.flatMap((assigned) => {
        const dates = scheduleByBatch.get(assigned.request_id) || [];
        return dates.map((date) => ({
          request_id: assigned.request_id,
          source: assigned.source,
          student_id: assigned.student_id,
          date,
          ...(attendanceByStudentDate.get(`${assigned.request_id}:${assigned.student_id}:${date}`) || { status: 'absent' }),
        }));
      });
    }

    const assignedStudentIds = `(
      SELECT DISTINCT tbs.student_id
      FROM teacher_batches tb
      JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = tb.id
      JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
      WHERE tb.supervisor_id = $1 AND tb.archived_at IS NULL AND tbs.deployment_ended_on IS NULL
    )`;

    const [evaluationResult, certificationResult, requestsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS evaluated,
                COALESCE(AVG(se.overall_percentage), 0)::numeric(5,2) AS average_score
         FROM student_evaluations se
         WHERE se.evaluator_id = $1
           AND se.student_id IN ${assignedStudentIds}`,
        [supervisorId]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_students,
           COUNT(*) FILTER (WHERE srs.status = 'Approved')::int AS approved_requirements,
           COUNT(*) FILTER (WHERE COALESCE(doc.total, 0) > 0 AND doc.total = doc.verified)::int AS verified_documents,
           COUNT(*) FILTER (WHERE COALESCE(att.days, 0) >= 10)::int AS complete_attendance,
           COUNT(*) FILTER (
             WHERE srs.status = 'Approved'
               AND COALESCE(doc.total, 0) > 0
               AND doc.total = doc.verified
               AND COALESCE(att.days, 0) >= 10
           )::int AS eligible
         FROM students s
         JOIN student_requirement_submissions srs ON srs.student_id = s.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status = 'Verified')::int AS verified
           FROM student_documents sd WHERE sd.student_id = s.id
         ) doc ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT date)::int AS days
           FROM student_attendance sa
           WHERE sa.student_id = s.id
             AND sa.check_in_time IS NOT NULL
             AND sa.check_out_time IS NOT NULL
         ) att ON true
         WHERE s.id IN ${assignedStudentIds}`,
        [supervisorId]
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM deployment_requests
         WHERE supervisor_id = $1 AND workflow_version = 2 AND original_proposal IS NOT NULL
         GROUP BY status`,
        [supervisorId]
      ),
    ]);

    const evaluated = evaluationResult.rows[0]?.evaluated || 0;
    const totalStudents = batchesResult.rows.reduce((sum, batch) => sum + Number(batch.student_count || 0), 0);
    const requestCounts = Object.fromEntries(requestsResult.rows.map((row) => [String(row.status).toLowerCase(), row.count]));
    const certificateStats = certificationResult.rows[0] || {};

    res.json({
      batches: batchesResult.rows,
      attendanceRecords: attendanceRows,
      attendanceScheduleDates: scheduledDates,
      overview: {
        batches: batchesResult.rows.length,
        students: totalStudents,
      },
      evaluations: {
        totalStudents,
        evaluated,
        pending: Math.max(totalStudents - evaluated, 0),
        averageScore: Number(evaluationResult.rows[0]?.average_score || 0),
      },
      certifications: {
        eligible: certificateStats.eligible || 0,
        approvedRequirements: certificateStats.approved_requirements || 0,
        verifiedDocuments: certificateStats.verified_documents || 0,
        completeAttendance: certificateStats.complete_attendance || 0,
      },
      deploymentRequests: {
        pending: requestCounts.pending || 0,
        approved: requestCounts.approved || 0,
        rejected: requestCounts.rejected || 0,
        fulfilled: requestCounts.fulfilled || 0,
      },
    });
  } catch (err) {
    console.error('getSupervisorDashboard error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

module.exports = { getSupervisorDashboard };
