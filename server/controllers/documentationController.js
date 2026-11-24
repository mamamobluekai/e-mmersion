const pool = require('../db');
const { getStudentSchedules } = require('./teacherControllers/immersionSchedule.controller');
const { nowInManilaDateOnly, isValidManilaDate } = require('../utils/manilaDate');
const { computeGradeFromRatings, validateRatings } = require('../utils/criteriaGrading');
const { createNotification, getStudentUserId, notifyUsers } = require('../services/notification.service');

const accessibleDeployments = `
  SELECT tb.id, tb.batch_label, dr.partner_institution_id, dr.confirmed_schedule
  FROM teacher_batches tb
  JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
  WHERE tb.archived_at IS NULL AND (
    $2::text = 'admin'
    OR ($2 = 'supervisor' AND tb.supervisor_id = $1 AND dr.supervisor_id = $1)
    OR ($2 = 'coordinator' AND EXISTS (
      SELECT 1 FROM coordinators c WHERE c.id = tb.coordinator_id AND c.user_id = $1
    ))
    OR ($2 = 'teacher' AND EXISTS (
      SELECT 1 FROM teachers t WHERE t.user_id = $1 AND (t.id = tb.teacher_id OR EXISTS (
        SELECT 1 FROM partner_deployment_teachers link
        WHERE link.deployment_request_id = dr.id AND link.teacher_id = t.id
      ))
    ))
  )`;

const assignedWorkday = `
  (d.confirmed_schedule->'dates') ? sdd.date::text
  AND (tbs.deployment_started_on IS NULL OR sdd.date >= tbs.deployment_started_on)
  AND (tbs.deployment_ended_on IS NULL OR sdd.date < tbs.deployment_ended_on)`;

function isId(value) {
  return typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647;
}

async function getStudentDailyDocs(req, res) {
  try {
    const { studentId, batchId, date, institutionId } = req.query;
    if ([studentId, batchId, institutionId].some((id) => id !== undefined && !isId(id)) ||
        (date !== undefined && !isValidManilaDate(date))) {
      return res.status(400).json({ error: 'Invalid documentation filter.' });
    }
    const fields = `sdd.*, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand,
      u.email AS student_email, f.original_name, f.cloudinary_url, f.mime_type, f.file_size`;
    const files = 'LEFT JOIN files f ON f.id = sdd.file_id';
    if (req.user.role === 'student') {
      const { rows: [student] } = await pool.query('SELECT id FROM students WHERE user_id = $1 LIMIT 1', [req.user.id]);
      if (!student) return res.status(404).json({ error: 'Student profile not found.' });
      const { rows: docs } = await pool.query(`
        SELECT ${fields} FROM student_daily_documentation sdd
        JOIN students s ON s.id = sdd.student_id JOIN users u ON u.id = s.user_id
        ${files}
        WHERE sdd.student_id = $1 AND ($2::int IS NULL OR sdd.teacher_batch_id = $2)
          AND ($3::date IS NULL OR sdd.date = $3)
        ORDER BY sdd.date DESC, sdd.day_number ASC`, [student.id, batchId ?? null, date ?? null]);
      return res.json({ docs });
    }
    const { rows: docs } = await pool.query(`
      WITH deployments AS (${accessibleDeployments})
      SELECT ${fields}, d.batch_label FROM student_daily_documentation sdd
      JOIN deployments d ON d.id = sdd.teacher_batch_id
      JOIN teacher_batch_students tbs ON tbs.student_id = sdd.student_id AND tbs.teacher_batch_id = d.id
      JOIN students s ON s.id = sdd.student_id JOIN users u ON u.id = s.user_id
      ${files}
      WHERE ${assignedWorkday}
        AND ($3::int IS NULL OR sdd.student_id = $3)
        AND ($4::int IS NULL OR d.id = $4)
        AND ($5::date IS NULL OR sdd.date = $5)
        AND ($6::int IS NULL OR d.partner_institution_id = $6)
      ORDER BY sdd.date DESC, sdd.day_number ASC, sdd.id DESC`,
    [req.user.id, req.user.role, studentId ?? null, batchId ?? null, date ?? null, institutionId ?? null]);
    res.json({ docs });
  } catch (err) {
    console.error('getStudentDailyDocs error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function submitDailyDoc(req, res) {
  try {
    const studentUserId = req.user.id;
    const studentResult = await pool.query('SELECT id FROM students WHERE user_id = $1 LIMIT 1', [studentUserId]);
    if (!studentResult.rows.length) return res.status(404).json({ error: 'Student profile not found.' });
    const studentId = studentResult.rows[0].id;

    const { date, reasoning, fileId, batchId } = req.body || {};
    if (!date) return res.status(400).json({ error: 'Date is required.' });
    if (!isValidManilaDate(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    // Evidence is mandatory: a daily documentation entry without an attached
    // file is not acceptable work-immersion evidence.
    if (!fileId) {
      return res.status(400).json({ error: 'An evidence file is required. Please attach a photo or document.' });
    }

    const today = nowInManilaDateOnly();
    if (date > today) {
      return res.status(400).json({ error: 'Cannot upload documentation for a future date.' });
    }

    const schedules = await getStudentSchedules(studentId);
    const schedule = schedules.find((item) =>
      (!batchId || Number(batchId) === item.teacher_batch_id) &&
      item.attendance_dates.split(',').includes(date)
    );
    if (!schedule) return res.status(400).json({ error: 'Choose a day on your assigned immersion schedule.' });
    const finalBatchId = schedule.teacher_batch_id;
    const dayNumber = schedule.attendance_dates.split(',').indexOf(date) + (schedule.first_day_number || 1);
    if (!Number.isSafeInteger(Number(fileId))) {
      return res.status(400).json({ error: 'Attach an evidence file from your account.' });
    }
    const file = await pool.query('SELECT id FROM files WHERE id = $1 AND student_id = $2', [Number(fileId), studentId]);
    if (!file.rows.length) return res.status(400).json({ error: 'Attach an evidence file from your account.' });

    // No attendance gate: students may upload documentation regardless of
    // whether they completed Time In / Time Out for the day.

    // Block re-submission once a teacher has reviewed or graded the doc.
    // Only one submission/edit is allowed per day until the teacher
    // finalizes the review.
    const existing = await pool.query(
      `SELECT status, date FROM student_daily_documentation
       WHERE student_id = $1 AND teacher_batch_id = $2 AND date = $3`,
      [studentId, finalBatchId, date]
    );
    if (existing.rows.length > 0 && ['reviewed', 'graded'].includes(existing.rows[0].status)) {
      const blockedDate =
        existing.rows[0].date instanceof Date
          ? existing.rows[0].date.toISOString().slice(0, 10)
          : String(existing.rows[0].date);
      return res.status(409).json({
        error: `Documentation for ${blockedDate} has already been reviewed and cannot be edited.`,
      });
    }

    const result = await pool.query(
      `INSERT INTO student_daily_documentation (student_id, teacher_batch_id, date, day_number, file_id, reasoning, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted', CURRENT_TIMESTAMP)
       ON CONFLICT (student_id, teacher_batch_id, date) DO UPDATE SET
         day_number = EXCLUDED.day_number,
         file_id = EXCLUDED.file_id,
         reasoning = EXCLUDED.reasoning,
         status = 'submitted',
         updated_at = CURRENT_TIMESTAMP
       WHERE student_daily_documentation.status NOT IN ('reviewed', 'graded')
       RETURNING *`,
      [studentId, finalBatchId, date, dayNumber, fileId || null, reasoning || '']
    );
    if (!result.rows.length) {
      return res.status(409).json({ error: 'This documentation has already been reviewed.' });
    }
    const { rows: [reviewers] } = await pool.query(`
      SELECT CASE WHEN tb.supervisor_id = dr.supervisor_id THEN tb.supervisor_id END AS supervisor_id, ARRAY(
        SELECT t.user_id FROM teachers t WHERE t.id = tb.teacher_id OR EXISTS (
          SELECT 1 FROM partner_deployment_teachers link
          WHERE link.deployment_request_id = dr.id AND link.teacher_id = t.id
        )
      ) AS teacher_ids
      FROM teacher_batches tb
      JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
      WHERE tb.id = $1`, [finalBatchId]);
    const notice = {
      title: 'Daily documentation submitted',
      message: 'A student submitted daily documentation for review.',
      type: 'documentation',
      category: 'documentation',
      relatedUserId: req.user.id,
      entityType: 'daily_documentation',
      entityId: result.rows[0].id,
      eventKey: `documentation-submitted:${result.rows[0].id}:${result.rows[0].updated_at}`,
    };
    void Promise.all([
      notifyUsers(reviewers?.teacher_ids, { ...notice, actionUrl: '/dashboard/teacher/student-documentation' }),
      notifyUsers([reviewers?.supervisor_id], { ...notice, actionUrl: '/dashboard/supervisor/student-documentation' }),
    ]).catch((err) => console.error('Documentation submission notification failed:', err.message));
    res.status(201).json({ doc: result.rows[0] });
  } catch (err) {
    console.error('submitDailyDoc error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function gradeDailyDoc(req, res) {
  try {
    const { docId } = req.params;
    const { teacherFeedback, criteriaRatings } = req.body || {};
    if (!isId(docId) || (teacherFeedback !== undefined && typeof teacherFeedback !== 'string')) {
      return res.status(400).json({ error: 'Invalid documentation grade.' });
    }

    const criteriaResult = await pool.query(
      'SELECT id, criterion_name, points, description, sort_order FROM documentation_criteria ORDER BY sort_order ASC, id ASC'
    );
    const criteria = criteriaResult.rows;

    const invalid = validateRatings(criteriaRatings, criteria);
    if (invalid) return res.status(400).json({ error: invalid });

    const grade = computeGradeFromRatings(criteria, criteriaRatings);

    const result = await pool.query(
      `WITH deployments AS (${accessibleDeployments})
       UPDATE student_daily_documentation sdd
       SET teacher_score = $4, teacher_feedback = $5, criteria_ratings = $6,
           final_stars = $7, final_label = $8,
           status = 'graded', graded_by = $1, graded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       FROM deployments d JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = d.id
       WHERE sdd.id = $3 AND sdd.teacher_batch_id = d.id AND sdd.student_id = tbs.student_id
         AND sdd.status IN ('submitted', 'reviewed', 'graded') AND ${assignedWorkday}
       RETURNING sdd.*`,
      [
        req.user.id,
        req.user.role,
        docId,
        grade.total,
        teacherFeedback || '',
        JSON.stringify(criteriaRatings),
        grade.stars,
        grade.label,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Documentation not found.' });

    const studentUserId = await getStudentUserId(result.rows[0].student_id);
    void createNotification({
      userId: studentUserId,
      title: 'Daily documentation graded',
      message: `Your daily documentation received ${grade.stars} star${grade.stars === 1 ? '' : 's'} (${grade.label}).`,
      type: 'documentation',
      category: 'documentation',
      actionUrl: '/dashboard/student/daily-documentation',
      relatedUserId: req.user.id,
      entityType: 'daily_documentation',
      entityId: result.rows[0].id,
      eventKey: `documentation-graded:${result.rows[0].id}:${result.rows[0].updated_at}`,
    }).catch((err) => console.error('Documentation grading notification failed:', err.message));

    res.json({ doc: result.rows[0], grade });
  } catch (err) {
    console.error('gradeDailyDoc error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function getDocumentationCriteria(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, criterion_name, points, description, sort_order
       FROM documentation_criteria
       ORDER BY sort_order ASC, id ASC`
    );
    res.json({ criteria: result.rows });
  } catch (err) {
    console.error('getDocumentationCriteria error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function saveDocumentationCriteria(req, res) {
  try {
    const { criteria } = req.body || {};
    if (!Array.isArray(criteria) || criteria.length === 0) {
      return res.status(400).json({ error: 'Invalid criteria payload.' });
    }
    const valid = criteria.every((criterion) =>
      typeof criterion?.criterion_name === 'string' && criterion.criterion_name.trim().length > 0 &&
      criterion.criterion_name.trim().length <= 255 &&
      (typeof criterion.points === 'number' || (typeof criterion.points === 'string' && criterion.points.trim() !== '')) &&
      Number.isInteger(Number(criterion.points)) &&
      Number(criterion.points) >= 0 && Number(criterion.points) <= 100 &&
      (criterion.description == null || typeof criterion.description === 'string') &&
      (criterion.id == null || isId(String(criterion.id))));
    const existingIds = criteria.filter((criterion) => criterion?.id != null).map((criterion) => Number(criterion.id));
    if (!valid || !criteria.some((criterion) => Number(criterion.points) > 0) ||
        new Set(existingIds).size !== existingIds.length) {
      return res.status(400).json({ error: 'Give each criterion a name and 0–100 points, with at least one positive weight.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE documentation_criteria IN SHARE ROW EXCLUSIVE MODE');
      await client.query(`
        SELECT setval(pg_get_serial_sequence('documentation_criteria', 'id'),
          GREATEST(MAX(id), (SELECT last_value FROM documentation_criteria_id_seq)))
        FROM documentation_criteria`);
      const saved = [];
      const fields = 'id, criterion_name, points, description, sort_order';
      for (const [index, c] of criteria.entries()) {
        const values = [c.criterion_name.trim(), Number(c.points), c.description || '', index + 1];
        const sql = c.id == null
          ? `INSERT INTO documentation_criteria (criterion_name, points, description, sort_order)
             VALUES ($1, $2, $3, $4) RETURNING ${fields}`
          : `UPDATE documentation_criteria SET criterion_name = $1, points = $2, description = $3,
               sort_order = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING ${fields}`;
        const { rows: [criterion] } = await client.query(sql, c.id == null ? values : [...values, c.id]);
        if (!criterion) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'The grading criteria changed. Reload them before saving.' });
        }
        saved.push(criterion);
      }
      await client.query('DELETE FROM documentation_criteria WHERE id <> ALL($1::int[])', [saved.map(({ id }) => id)]);
      await client.query('COMMIT');
      res.json({ criteria: saved });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('saveDocumentationCriteria error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function getDailyDocSummary(req, res) {
  try {
    const { batchId, institutionId } = req.params;
    if (!isId(batchId ?? institutionId)) return res.status(400).json({ error: 'Invalid documentation scope.' });
    const { rows: [summary] } = await pool.query(`
      WITH deployments AS (
        ${accessibleDeployments}
        AND ($3::int IS NULL OR tb.id = $3) AND ($4::int IS NULL OR dr.partner_institution_id = $4)
      ), roster AS (
        SELECT s.id AS student_id, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand, u.email,
          COUNT(sdd.id)::int AS total_docs,
          (COUNT(sdd.id) FILTER (WHERE sdd.status = 'graded'))::int AS graded_count,
          (COUNT(sdd.id) FILTER (WHERE sdd.status IN ('pending', 'submitted', 'reviewed')))::int AS pending_count,
          COALESCE(SUM(sdd.teacher_score), 0) AS total_score
        FROM deployments d
        JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = d.id AND tbs.deployment_ended_on IS NULL
        JOIN students s ON s.id = tbs.student_id JOIN users u ON u.id = s.user_id
        LEFT JOIN student_daily_documentation sdd ON sdd.student_id = s.id AND sdd.teacher_batch_id = d.id
          AND ${assignedWorkday}
        GROUP BY s.id, u.email
      )
      SELECT EXISTS (SELECT 1 FROM deployments) AS assigned,
        COALESCE((SELECT json_agg(roster ORDER BY last_name, first_name, student_id) FROM roster), '[]') AS students`,
    [req.user.id, req.user.role, batchId ?? null, institutionId ?? null]);
    if (!summary.assigned) return res.status(403).json({ error: 'You have no assigned deployment in this selection.' });
    res.json({ students: summary.students });
  } catch (err) {
    console.error('getDailyDocSummary error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

module.exports = {
  getStudentDailyDocs,
  submitDailyDoc,
  gradeDailyDoc,
  getDocumentationCriteria,
  saveDocumentationCriteria,
  getDailyDocSummary,
};
