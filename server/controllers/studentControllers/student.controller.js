const pool = require('../../db/');
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
// the same batch. Powers the Placement Status page so a student can see who is
// on their team right after the coordinator assigns them to a batch.
const getMyPlacementInfo = async (req, res) => {
  try {
    const studentRow = await pool.query(
      'SELECT id, first_name, last_name FROM students WHERE user_id = $1',
      [req.user.id]
    );
    if (!studentRow.rows.length) {
      return res.json({ placement: null });
    }
    const studentId = studentRow.rows[0].id;

    const batchResult = await pool.query(
      `SELECT tb.id AS batch_id,
              tb.batch_label,
              tb.max_students,
              tb.created_at,
              t.first_name AS teacher_first_name,
              t.last_name AS teacher_last_name,
              t.employee_id AS teacher_employee_id,
              t.department AS teacher_department,
              tu.email AS teacher_email,
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
       LEFT JOIN partner_institutions pi ON pi.id = (to_jsonb(tb)->>'partner_institution_id')::int
       LEFT JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND to_jsonb(dr)->>'workflow_version' = '2'
       LEFT JOIN teachers t ON t.id = tb.teacher_id
       LEFT JOIN users tu ON tu.id = t.user_id
       LEFT JOIN supervisors sv ON sv.user_id = tb.supervisor_id
       LEFT JOIN users su ON su.id = tb.supervisor_id
       LEFT JOIN coordinators c ON c.id = tb.coordinator_id
       LEFT JOIN users cu ON cu.id = c.user_id
       WHERE tbs.student_id = $1 AND (to_jsonb(tbs)->>'deployment_ended_on' IS NULL OR
         (now() AT TIME ZONE 'Asia/Manila')::date < (to_jsonb(tbs)->>'deployment_ended_on')::date)
         AND (to_jsonb(tb)->>'partner_institution_id' IS NULL OR tb.archived_at IS NULL)
       ORDER BY tbs.assigned_at DESC NULLS LAST, tb.created_at DESC
       LIMIT 1`,
      [studentId]
    );

    if (!batchResult.rows.length) {
      return res.json({ placement: null });
    }

    const batch = batchResult.rows[0];

    const classmatesResult = await pool.query(
      `SELECT s.id AS student_id,
              s.first_name,
              s.last_name,
              s.student_number,
              s.grade_level,
              s.track_strand,
              u.email
       FROM teacher_batch_students tbs
       JOIN students s ON s.id = tbs.student_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE tbs.teacher_batch_id = $1 AND to_jsonb(tbs)->>'deployment_ended_on' IS NULL
       ORDER BY s.last_name ASC, s.first_name ASC`,
      [batch.batch_id]
    );

    const classmates = classmatesResult.rows.map((row) => ({
      ...row,
      is_me: Number(row.student_id) === Number(studentId),
    }));

    res.json({
      placement: {
        batch_id: batch.batch_id,
        batch_label: batch.batch_label,
        company_name: batch.company_name,
        company_address: batch.company_address,
        max_students: batch.max_students,
        created_at: batch.created_at,
        teacher: batch.teacher_first_name || batch.teacher_last_name
          ? {
              first_name: batch.teacher_first_name,
              last_name: batch.teacher_last_name,
              employee_id: batch.teacher_employee_id,
              department: batch.teacher_department,
              email: batch.teacher_email,
            }
          : null,
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
        classmates,
      },
    });
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
