const pool = require('../../db/');

const getMyTeacherBatches = async (req, res) => {
  try {
    const teacherUserId = req.user.id;

    const teacherRow = await pool.query(
      "SELECT id FROM teachers WHERE user_id = $1",
      [teacherUserId]
    );
    const teacherId = teacherRow.rows[0]?.id;
    if (!teacherId) {
      return res.status(400).json({ error: 'Teacher profile not found.' });
    }

    const result = await pool.query(
      `SELECT tb.id, tb.teacher_id, tb.batch_label, tb.max_students, tb.supervisor_id, tb.created_at, tb.updated_at,
              dr.id AS deployment_request_id, dr.confirmed_schedule->>'start' AS deployment_start,
              dr.confirmed_schedule->>'end' AS deployment_end, dr.confirmed_schedule->>'notes' AS instructions,
              sv.first_name AS supervisor_first_name, sv.last_name AS supervisor_last_name,
              pi.id AS partner_institution_id, pi.name AS partner_institution_name
       FROM teacher_batches tb
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
       LEFT JOIN supervisors sv ON sv.user_id = tb.supervisor_id
       LEFT JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
       WHERE tb.archived_at IS NULL AND (tb.teacher_id = $1 OR EXISTS (
         SELECT 1 FROM partner_deployment_teachers link WHERE link.deployment_request_id = dr.id AND link.teacher_id = $1
       ))
       ORDER BY tb.created_at DESC`,
      [teacherId]
    );

    const rows = result.rows.map((r) => ({
      ...r,
      supervisor: r.supervisor_id
        ? { first_name: r.supervisor_first_name, last_name: r.supervisor_last_name }
        : null,
    }));

    res.json({ batches: rows });
  } catch (err) {
    console.error('getMyTeacherBatches error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const getMyTeacherPartnerInstitutions = async (req, res) => {
  try {
    const teacherUserId = req.user.id;

    const teacherRow = await pool.query(
      "SELECT id FROM teachers WHERE user_id = $1",
      [teacherUserId]
    );
    const teacherId = teacherRow.rows[0]?.id;
    if (!teacherId) {
      return res.status(400).json({ error: 'Teacher profile not found.' });
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (pi.id)
              pi.id, pi.name, pi.industry, pi.description, pi.address,
              MIN(dr.confirmed_schedule->>'start') AS deployment_start,
              MAX(dr.confirmed_schedule->>'end') AS deployment_end,
              COUNT(DISTINCT tb.id) AS batch_count
       FROM teacher_batches tb
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
       JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
       WHERE tb.archived_at IS NULL AND (tb.teacher_id = $1 OR EXISTS (
         SELECT 1 FROM partner_deployment_teachers link WHERE link.deployment_request_id = dr.id AND link.teacher_id = $1
       ))
       GROUP BY pi.id
       ORDER BY pi.id`,
      [teacherId]
    );

    res.json({ institutions: result.rows });
  } catch (err) {
    console.error('getMyTeacherPartnerInstitutions error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const getPartnerInstitutionStudents = async (req, res) => {
  try {
    const { institutionId } = req.params;

    if (req.user.role === 'teacher') {
      const teacherRow = await pool.query(
        "SELECT id FROM teachers WHERE user_id = $1",
        [req.user.id]
      );
      const teacherId = teacherRow.rows[0]?.id;
      if (!teacherId) {
        return res.status(400).json({ error: 'Teacher profile not found.' });
      }
      const ownership = await pool.query(
        `SELECT 1 FROM teacher_batches tb
         JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
         WHERE tb.archived_at IS NULL AND dr.partner_institution_id = $1 AND (tb.teacher_id = $2 OR EXISTS (
           SELECT 1 FROM partner_deployment_teachers link WHERE link.deployment_request_id = dr.id AND link.teacher_id = $2
         ))`,
        [institutionId, teacherId]
      );
      if (ownership.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    if (req.user.role === 'coordinator') {
      const coordinatorRow = await pool.query(
        "SELECT id FROM coordinators WHERE user_id = $1",
        [req.user.id]
      );
      const coordinatorId = coordinatorRow.rows[0]?.id;
      if (!coordinatorId) {
        return res.status(400).json({ error: 'Coordinator profile not found.' });
      }
      const ownership = await pool.query(
        `SELECT 1 FROM teacher_batches tb
         JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
         WHERE tb.coordinator_id = $1 AND dr.partner_institution_id = $2`,
        [coordinatorId, institutionId]
      );
      if (ownership.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const result = await pool.query(
      `SELECT
          s.user_id AS user_id,
          s.id AS student_id,
          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,
          s.suffix,
          s.gender,
          s.birthdate,
          s.age,
          s.contact_number,
          s.section,
          s.school,
          s.grade_level,
          s.track_strand,
          s.track_strand AS strand,
          s.preferred_industry,
          s.preferred_company,
          s.career_goal,
          s.industry_reason,
          s.guardian_name,
          s.guardian_relationship,
          s.guardian_contact,
          s.guardian_email,
          s.guardian_address,
          s.emergency_contact,
          s.emergency_contact_number,
          s.academic_notes,
          s.photo_url,
          u.email,
          u.phone,
          u.status,
          u.status AS account_status,
          tbs.assigned_at
        FROM teacher_batch_students tbs
        JOIN students s ON s.id = tbs.student_id
        JOIN users u ON u.id = s.user_id
        JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id
        JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
        WHERE dr.partner_institution_id = $1 AND tbs.deployment_ended_on IS NULL
        ORDER BY tbs.assigned_at DESC`,
      [institutionId]
    );

    res.json({ students: result.rows });
  } catch (err) {
    console.error('getPartnerInstitutionStudents error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const getTeacherBatchStudents = async (req, res) => {
  try {
    const { batchId } = req.params;

    if (req.user.role === 'teacher') {
      const teacherRow = await pool.query(
        "SELECT id FROM teachers WHERE user_id = $1",
        [req.user.id]
      );
      const teacherId = teacherRow.rows[0]?.id;
      if (!teacherId) {
        return res.status(400).json({ error: 'Teacher profile not found.' });
      }
      const ownership = await pool.query(
        `SELECT tb.id FROM teacher_batches tb
         JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
         WHERE tb.id = $1 AND tb.archived_at IS NULL AND (tb.teacher_id = $2 OR EXISTS (
           SELECT 1 FROM partner_deployment_teachers link WHERE link.deployment_request_id = dr.id AND link.teacher_id = $2
         ))`,
        [batchId, teacherId]
      );
      if (ownership.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    if (req.user.role === 'coordinator') {
      const coordinatorRow = await pool.query(
        "SELECT id FROM coordinators WHERE user_id = $1",
        [req.user.id]
      );
      const coordinatorId = coordinatorRow.rows[0]?.id;
      if (!coordinatorId) {
        return res.status(400).json({ error: 'Coordinator profile not found.' });
      }
      const ownership = await pool.query(
        "SELECT id FROM teacher_batches WHERE id = $1 AND coordinator_id = $2",
        [batchId, coordinatorId]
      );
      if (ownership.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const result = await pool.query(
      `SELECT
         s.user_id AS user_id,
         s.id AS student_id,
         s.student_number,
         s.first_name,
         s.middle_name,
         s.last_name,
         s.suffix,
         s.gender,
         s.birthdate,
         s.age,
         s.contact_number,
         s.section,
         s.school,
         s.grade_level,
         s.track_strand,
         s.track_strand AS strand,
         s.preferred_industry,
         s.preferred_company,
         s.career_goal,
         s.industry_reason,
         s.guardian_name,
         s.guardian_relationship,
         s.guardian_contact,
         s.guardian_email,
         s.guardian_address,
         s.emergency_contact,
         s.emergency_contact_number,
         s.academic_notes,
         s.photo_url,
         u.email,
         u.phone,
         u.status,
         u.status AS account_status,
         tbs.assigned_at
       FROM teacher_batch_students tbs
       JOIN students s ON s.id = tbs.student_id
       JOIN users u ON u.id = s.user_id
       WHERE tbs.teacher_batch_id = $1 AND tbs.deployment_ended_on IS NULL
       ORDER BY tbs.assigned_at DESC`,
      [batchId]
    );

    res.json({ students: result.rows });
  } catch (err) {
    console.error('getTeacherBatchStudents error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

module.exports = { getMyTeacherBatches, getTeacherBatchStudents, getMyTeacherPartnerInstitutions, getPartnerInstitutionStudents };
