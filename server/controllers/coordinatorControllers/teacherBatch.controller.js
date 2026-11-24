const pool = require('../../db/');
const { nowInManilaDateOnly } = require('../../utils/manilaDate');

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
      `SELECT pi.id, pi.name, pi.industry, pi.description, pi.address,
              MIN(dr.confirmed_schedule->>'start') AS deployment_start,
              MAX(dr.confirmed_schedule->>'end') AS deployment_end,
              string_agg(DISTINCT staff.name, ', ' ORDER BY staff.name) AS supervisor_name,
              COUNT(DISTINCT tb.id) AS batch_count
       FROM teacher_batches tb
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
       JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
       LEFT JOIN supervisors sv ON sv.user_id = dr.supervisor_id
       CROSS JOIN LATERAL (SELECT NULLIF(concat_ws(' ', sv.first_name, sv.last_name), '') AS name) staff
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

const getTeacherInstitutionOverview = async (req, res) => {
  const institutionId = Number(req.params.institutionId);
  if (!Number.isInteger(institutionId) || institutionId < 1 || institutionId > 2147483647) {
    return res.status(400).json({ error: 'Invalid partner institution.' });
  }

  try {
    const { rows } = await pool.query(`
      WITH deployments AS (
        SELECT tb.id, dr.confirmed_schedule
        FROM deployment_requests dr
        JOIN teacher_batches tb ON tb.id = dr.teacher_batch_id AND tb.archived_at IS NULL
        JOIN teachers t ON t.user_id = $2
        WHERE dr.partner_institution_id = $1 AND dr.workflow_version = 2 AND dr.status = 'approved'
          AND (tb.teacher_id = t.id OR EXISTS (
            SELECT 1 FROM partner_deployment_teachers link
            WHERE link.deployment_request_id = dr.id AND link.teacher_id = t.id
          ))
      ), roster AS (
        SELECT d.id AS placement_id, member.student_id, member.deployment_started_on,
          d.confirmed_schedule->'dates' AS agreed_dates
        FROM deployments d
        JOIN teacher_batch_students member ON member.teacher_batch_id = d.id
        WHERE member.deployment_ended_on IS NULL
      ), attendance AS (
        SELECT COUNT(DISTINCT roster.student_id)::int AS present_count
        FROM roster
        JOIN student_attendance sa ON sa.student_id = roster.student_id AND sa.teacher_batch_id = roster.placement_id
        WHERE sa.date = ($3::text)::date AND roster.agreed_dates ? $3::text
          AND (roster.deployment_started_on IS NULL OR sa.date >= roster.deployment_started_on)
          AND (sa.status = 'present' OR (sa.status <> 'absent' AND sa.check_in_time IS NOT NULL))
      ), documentation AS (
        SELECT roster.student_id, COUNT(doc.id)::int AS total_docs,
          COUNT(doc.id) FILTER (WHERE doc.status = 'graded')::int AS graded_count,
          COUNT(doc.id) FILTER (WHERE doc.status IN ('pending', 'submitted'))::int AS pending_count
        FROM roster
        LEFT JOIN student_daily_documentation doc ON doc.student_id = roster.student_id
          AND doc.teacher_batch_id = roster.placement_id AND roster.agreed_dates ? doc.date::text
          AND (roster.deployment_started_on IS NULL OR doc.date >= roster.deployment_started_on)
        GROUP BY roster.student_id
      )
      SELECT (SELECT COUNT(*)::int FROM documentation) AS student_count, attendance.present_count,
        COALESCE((SELECT json_agg(documentation) FROM documentation), '[]'::json) AS documentation
      FROM attendance
      WHERE EXISTS (SELECT 1 FROM deployments)`, [institutionId, req.user.id, nowInManilaDateOnly()]);
    if (!rows.length) return res.status(403).json({ error: 'This partner institution is not assigned to you.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('getTeacherInstitutionOverview error:', err);
    res.status(500).json({ error: 'Could not load the partner institution overview.' });
  }
};

const getPartnerInstitutionStudents = async (req, res) => {
  try {
    const institutionId = Number(req.params.institutionId);
    if (!Number.isInteger(institutionId) || institutionId < 1 || institutionId > 2147483647) {
      return res.status(400).json({ error: 'Invalid partner institution.' });
    }

    let teacherId = null;
    let coordinatorId = null;
    if (req.user.role === 'teacher') {
      const teacherRow = await pool.query(
        "SELECT id FROM teachers WHERE user_id = $1",
        [req.user.id]
      );
      teacherId = teacherRow.rows[0]?.id;
      if (!teacherId) {
        return res.status(400).json({ error: 'Teacher profile not found.' });
      }
    }

    if (req.user.role === 'coordinator') {
      const coordinatorRow = await pool.query(
        "SELECT id FROM coordinators WHERE user_id = $1",
        [req.user.id]
      );
      coordinatorId = coordinatorRow.rows[0]?.id;
      if (!coordinatorId) {
        return res.status(400).json({ error: 'Coordinator profile not found.' });
      }
    }

    const deployments = `
        FROM teacher_batches tb
        JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id
          AND dr.workflow_version = 2 AND dr.status = 'approved'
        WHERE dr.partner_institution_id = $1 AND tb.archived_at IS NULL
          AND ($4::boolean OR tb.coordinator_id = $3 OR tb.teacher_id = $2 OR EXISTS (
            SELECT 1 FROM partner_deployment_teachers link
            WHERE link.deployment_request_id = dr.id AND link.teacher_id = $2
          ))`;
    const isAdmin = req.user.role === 'admin';
    const params = [institutionId, teacherId, coordinatorId, isAdmin];
    if (!isAdmin) {
      const ownership = await pool.query(`SELECT 1 ${deployments} LIMIT 1`, params);
      if (ownership.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const result = await pool.query(
      `WITH deployments AS (
          SELECT tb.id, tb.batch_label, tb.coordinator_id, dr.coordinator_batch_id,
            dr.partner_institution_id, dr.supervisor_id
          ${deployments}
        )
        SELECT
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
          s.home_address,
          s.section,
          s.school,
          s.grade_level,
          s.track_strand,
          s.track_strand AS strand,
          COALESCE(NULLIF(btrim(s.preferred_industry), ''), preference.industry) AS preferred_industry,
          s.preferred_company,
          preference.name AS preferred_partner_name,
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
          tbs.assigned_at,
          json_build_object(
            'batch_number', batch.batch_number,
            'batch_label', deployment.batch_label,
            'partner_institution_id', partner.id,
            'partner_institution_name', partner.name,
            'coordinator_name', NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
            'supervisor_name', NULLIF(btrim(concat_ws(' ', sv.first_name, sv.last_name)), '')
          ) AS placement
        FROM deployments deployment
        JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = deployment.id
        JOIN students s ON s.id = tbs.student_id
        JOIN users u ON u.id = s.user_id
        JOIN partner_institutions partner ON partner.id = deployment.partner_institution_id
        LEFT JOIN coordinators c ON c.id = deployment.coordinator_id
        LEFT JOIN supervisors sv ON sv.user_id = deployment.supervisor_id
        LEFT JOIN coordinator_deployment_batches batch ON batch.id = deployment.coordinator_batch_id
        LEFT JOIN partner_institutions preference ON preference.id = s.preferred_partner_institution_id
        WHERE tbs.deployment_ended_on IS NULL
        ORDER BY tbs.assigned_at DESC`,
      params
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

module.exports = { getMyTeacherBatches, getTeacherBatchStudents, getMyTeacherPartnerInstitutions, getTeacherInstitutionOverview, getPartnerInstitutionStudents };
