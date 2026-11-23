const pool = require('../../db/');
const { nowInManilaDateOnly } = require('../../utils/manilaDate');
const {
  getOrCreateStudent,
  getOrCreateSubmission,
} = require('../coordinatorControllers/regexes/requirementsHelpers');

const getMySubmissionStatus = async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const student = await getOrCreateStudent(client, req.user.id, {});
      const submission = await getOrCreateSubmission(client, student, req.user.id);
      res.json({ submission });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('getMySubmissionStatus error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

// Preserve the legacy response shape for clients that still use /progress.
const getProgress = async (req, res) => {
  const journey = res.locals.studentJourney;
  const [certificate] = journey.certificate.issued
    ? (await pool.query(
        `SELECT c.id, c.certificate_number, c.full_name, c.completion_date, c.cloudinary_url, c.created_at
         FROM certificates c JOIN students s ON s.id = c.student_id
         WHERE s.user_id = $1 AND NULLIF(c.cloudinary_url, '') IS NOT NULL
         ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
        [req.user.id]
      )).rows
    : [];
  res.json({
    requirements: {
      approved: journey.requirements.complete,
      status: journey.requirements.status,
      required: journey.requirements.total,
      uploaded: journey.requirements.approved,
    },
    documentation: {
      graded: journey.documentation.completed === journey.documentation.total,
      total: journey.documentation.total,
      submitted: journey.days.filter((day) => ['Submitted', 'Completed'].includes(day.documentation.status)).length,
      verified: journey.documentation.completed,
    },
    attendance: {
      complete: journey.attendance.completed === journey.attendance.total,
      days: journey.attendance.completed,
      scheduled: journey.attendance.total,
      required: journey.attendance.total,
    },
    completed: true,
    certificate: certificate ? { issued: true, ...certificate } : { issued: false },
  });
};

// GET /api/student/placement/me
// Returns the student's work immersion batch details: the batch label, the
// assigned teacher, supervisor, coordinator, and the fellow students who share
// the finalized agreement. The placement response is scoped to this student.
const getMyPlacementInfo = async (req, res) => {
  try {
    const studentRow = await pool.query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );
    if (!studentRow.rows.length) {
      return res.json({ placement: null, placements: [], assignment: null });
    }
    const studentId = studentRow.rows[0].id;

    const batchResult = await pool.query(
      `SELECT tb.id AS batch_id,
              tb.batch_label,
              approval.decided_at AS approval_date,
              tbs.deployment_started_on,
              dr.id AS deployment_id,
              dr.confirmed_schedule->>'start' AS start_date,
              dr.confirmed_schedule->>'end' AS end_date,
              dr.confirmed_schedule->'dates' AS attendance_dates,
              dr.confirmed_schedule->'windows' AS attendance_windows,
              COALESCE(NULLIF(dr.confirmed_schedule->>'notes', ''), dr.proposal->>'notes') AS instructions,
              COALESCE(team.members, '[]'::jsonb) AS teachers,
              sv.first_name AS supervisor_first_name,
              sv.last_name AS supervisor_last_name,
              COALESCE(pi.name, sv.company_name) AS company_name,
              COALESCE(to_jsonb(dr)->'proposal'->>'worksite', pi.address, sv.company_address) AS company_address,
              su.email AS supervisor_email,
              c.first_name AS coordinator_first_name,
              c.last_name AS coordinator_last_name,
              cu.email AS coordinator_email
       FROM teacher_batch_students tbs
       JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
       JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
       LEFT JOIN partner_student_assignments approval ON approval.deployment_request_id = dr.id
         AND approval.student_id = tbs.student_id AND approval.status = 'accepted'
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name,
           'department', t.department, 'email', tu.email) ORDER BY t.id) AS members
         FROM partner_deployment_teachers link JOIN teachers t ON t.id = link.teacher_id
         JOIN users tu ON tu.id = t.user_id WHERE link.deployment_request_id = dr.id
       ) team ON true
       LEFT JOIN supervisors sv ON sv.user_id = tb.supervisor_id
       LEFT JOIN users su ON su.id = tb.supervisor_id
       LEFT JOIN coordinators c ON c.id = tb.coordinator_id
       LEFT JOIN users cu ON cu.id = c.user_id
       WHERE tbs.student_id = $1 AND tb.archived_at IS NULL AND tbs.deployment_ended_on IS NULL
       ORDER BY CASE WHEN (now() AT TIME ZONE 'Asia/Manila')::date BETWEEN
         (dr.confirmed_schedule->>'start')::date AND (dr.confirmed_schedule->>'end')::date THEN 0
         WHEN (dr.confirmed_schedule->>'start')::date > (now() AT TIME ZONE 'Asia/Manila')::date THEN 1 ELSE 2 END,
         tbs.assigned_at DESC NULLS LAST, dr.id DESC`,
      [studentId]
    );

    const { rows: [assignment] } = await pool.query(`SELECT a.status, a.submitted_at, a.decided_at,
      a.rejection_reason, pi.name AS partner_name
      FROM partner_student_assignments a JOIN deployment_requests dr ON dr.id = a.deployment_request_id
      JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
      WHERE a.student_id = $1 AND (a.status IN ('pending', 'rejected') OR (a.status = 'accepted' AND dr.teacher_batch_id IS NULL))
      ORDER BY a.submitted_at DESC LIMIT 1`, [studentId]);

    const today = nowInManilaDateOnly();
    const placements = batchResult.rows.map((batch) => ({
        batch_id: batch.batch_id,
        batch_label: batch.batch_label,
        deployment_id: batch.deployment_id,
        approval_date: batch.approval_date,
        company_name: batch.company_name,
        company_address: batch.company_address,
        start_date: batch.start_date,
        end_date: batch.end_date,
        status: today < batch.start_date ? 'Approved' : today > batch.end_date ? 'Completed' : 'Ongoing',
        attendance_dates: batch.attendance_dates?.filter((date) => !batch.deployment_started_on || date >= batch.deployment_started_on) || [],
        attendance_windows: batch.attendance_windows,
        instructions: batch.instructions,
        teachers: batch.teachers,
        supervisor: batch.supervisor_first_name || batch.supervisor_last_name
          ? {
              first_name: batch.supervisor_first_name,
              last_name: batch.supervisor_last_name,
              email: batch.supervisor_email,
            }
          : null,
        coordinator: batch.coordinator_first_name || batch.coordinator_last_name
          ? {
              first_name: batch.coordinator_first_name,
              last_name: batch.coordinator_last_name,
              email: batch.coordinator_email,
            }
          : null,
    }));
    res.json({ placement: placements[0] || null, placements, assignment: assignment || null });
  } catch (err) {
    console.error('getMyPlacementInfo error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

module.exports = {
  getMySubmissionStatus,
  getProgress,
  getMyPlacementInfo,
};
