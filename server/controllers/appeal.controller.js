const pool = require('../db');
const { createNotification, getStudentUserId } = require('../services/notification.service');

async function ensureAppealTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grade_appeals (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      evaluation_id INTEGER NOT NULL REFERENCES student_evaluations(id) ON DELETE CASCADE,
      batch_id INTEGER,
      category_id INTEGER REFERENCES evaluation_criteria(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      supervisor_response TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_grade_appeals_student ON grade_appeals(student_id);
    CREATE INDEX IF NOT EXISTS idx_grade_appeals_evaluation ON grade_appeals(evaluation_id);
    CREATE INDEX IF NOT EXISTS idx_grade_appeals_status ON grade_appeals(status);
    CREATE INDEX IF NOT EXISTS idx_grade_appeals_batch ON grade_appeals(batch_id);

    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ language 'plpgsql';

    DROP TRIGGER IF EXISTS update_grade_appeals_updated_at ON grade_appeals;
    CREATE TRIGGER update_grade_appeals_updated_at
      BEFORE UPDATE ON grade_appeals
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `);
}

async function submitAppeal(req, res) {
  const client = await pool.connect();
  try {
    await ensureAppealTables();
    const { evaluationId, categoryId, reason } = req.body || {};
    if (!evaluationId || !reason) {
      return res.status(400).json({ error: 'evaluationId and reason are required.' });
    }

    // Get student ID from user
    const studentResult = await client.query(
      'SELECT id FROM students WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }
    const studentId = studentResult.rows[0].id;

    // Verify evaluation exists and belongs to student
    const evalResult = await client.query(
      `SELECT se.*, s.user_id AS student_user_id, s.first_name, s.last_name
       FROM student_evaluations se
       JOIN students s ON s.id = se.student_id
       WHERE se.id = $1 AND se.student_id = $2`,
      [evaluationId, studentId]
    );
    if (!evalResult.rows.length) {
      return res.status(404).json({ error: 'Evaluation not found.' });
    }
    const evaluation = evalResult.rows[0];

    // Check if appeal already exists for this evaluation/category
    const existingResult = await client.query(
      `SELECT id FROM grade_appeals WHERE evaluation_id = $1 AND student_id = $2 AND (category_id = $3 OR (category_id IS NULL AND $3 IS NULL))`,
      [evaluationId, studentId, categoryId || null]
    );
    if (existingResult.rows.length) {
      return res.status(409).json({ error: 'An appeal already exists for this evaluation/category.' });
    }

    const result = await client.query(
      `INSERT INTO grade_appeals (student_id, evaluation_id, batch_id, category_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [studentId, evaluationId, evaluation.batch_id || null, categoryId || null, reason]
    );

    // Notify supervisor(s) of the appeal
    if (evaluation.batch_id) {
      const supervisorResult = await client.query(
        `SELECT dr.supervisor_id, u.id AS user_id
         FROM deployment_requests dr
         JOIN users u ON u.id = dr.supervisor_id
         WHERE dr.id = $1
         UNION ALL
         SELECT tb.supervisor_id, u.id AS user_id
         FROM teacher_batches tb
         JOIN users u ON u.id = tb.supervisor_id
         WHERE tb.id = $1`,
        [evaluation.batch_id]
      );
      for (const sup of supervisorResult.rows) {
        await createNotification({
          userId: sup.user_id,
          title: 'New Grade Appeal',
          message: `${evaluation.first_name} ${evaluation.last_name} has submitted a grade appeal.`,
          type: 'appeal',
          category: 'evaluation',
          priority: 'high',
          actionUrl: '/dashboard/supervisor/grade-appeals',
          relatedUserId: req.user.id,
          entityType: 'grade_appeal',
          entityId: result.rows[0].id,
          eventKey: `appeal:${result.rows[0].id}:${result.rows[0].created_at}`,
        }).catch((err) => console.error('Appeal notification failed:', err.message));
      }
    }

    res.status(201).json({ appeal: result.rows[0] });
  } catch (err) {
    console.error('submitAppeal error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
}

async function getMyAppeals(req, res) {
  try {
    await ensureAppealTables();
    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }
    const studentId = studentResult.rows[0].id;

    const result = await pool.query(
      `SELECT ga.*, se.overall_score, se.overall_percentage, ec.category_name
       FROM grade_appeals ga
       JOIN student_evaluations se ON se.id = ga.evaluation_id
       LEFT JOIN evaluation_criteria ec ON ec.id = ga.category_id
       WHERE ga.student_id = $1
       ORDER BY ga.created_at DESC`,
      [studentId]
    );
    res.json({ appeals: result.rows });
  } catch (err) {
    console.error('getMyAppeals error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function getSupervisorAppeals(req, res) {
  try {
    await ensureAppealTables();
    const supervisorUserId = req.user.id;

    const result = await pool.query(
      `SELECT ga.*, se.overall_score, se.overall_percentage, se.comments AS evaluation_comments,
              ec.category_name, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand,
              u.email AS student_email, tb.batch_label
       FROM grade_appeals ga
       JOIN student_evaluations se ON se.id = ga.evaluation_id
       JOIN students s ON s.id = ga.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN evaluation_criteria ec ON ec.id = ga.category_id
       LEFT JOIN teacher_batches tb ON tb.id = se.batch_id AND tb.supervisor_id = $1 AND EXISTS (
         SELECT 1 FROM teacher_batch_students tbs WHERE tbs.teacher_batch_id = tb.id AND tbs.student_id = ga.student_id
       )
       WHERE se.evaluator_id = $1 OR tb.id IS NOT NULL
       ORDER BY ga.created_at DESC`, [supervisorUserId]);
    res.json({ appeals: result.rows });
  } catch (err) {
    console.error('getSupervisorAppeals error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function respondToAppeal(req, res) {
  const client = await pool.connect();
  try {
    await ensureAppealTables();
    const { appealId } = req.params;
    const { status, response } = req.body || {};

    if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Valid status (approved/rejected/pending) is required.' });
    }

    // Verify supervisor owns this batch
    const appealResult = await client.query(
      `SELECT ga.*, se.batch_id
       FROM grade_appeals ga
       JOIN student_evaluations se ON se.id = ga.evaluation_id
       WHERE ga.id = $1`,
      [appealId]
    );
    if (!appealResult.rows.length) {
      return res.status(404).json({ error: 'Appeal not found.' });
    }
    const appeal = appealResult.rows[0];

    const hasAccess = await client.query(
      `SELECT 1 FROM grade_appeals ga JOIN student_evaluations se ON se.id = ga.evaluation_id
       WHERE ga.id = $1 AND (se.evaluator_id = $2 OR EXISTS (
         SELECT 1 FROM teacher_batches tb
         JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = tb.id AND tbs.student_id = ga.student_id
         WHERE tb.id = se.batch_id AND tb.supervisor_id = $2
       ))`, [appealId, req.user.id]);
    if (!hasAccess.rows.length) {
      return res.status(403).json({ error: 'Not authorized to review this appeal.' });
    }

    const result = await client.query(
      `UPDATE grade_appeals
       SET status = $1, supervisor_response = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, response || null, req.user.id, appealId]
    );

    // Notify student of the response
    const studentUserResult = await client.query(
      'SELECT user_id FROM students WHERE id = $1',
      [appeal.student_id]
    );
    if (studentUserResult.rows.length) {
      await createNotification({
        userId: studentUserResult.rows[0].user_id,
        title: 'Grade Appeal Response',
        message: `Your grade appeal has been ${status}. ${response ? 'Supervisor response: ' + response : ''}`,
        type: 'appeal_response',
        category: 'evaluation',
        priority: 'high',
        actionUrl: '/dashboard/student/grade-appeal',
        relatedUserId: req.user.id,
        entityType: 'grade_appeal',
        entityId: appealId,
        eventKey: `appeal_response:${appealId}:${new Date().toISOString()}`,
      }).catch((err) => console.error('Appeal response notification failed:', err.message));
    }

    res.json({ appeal: result.rows[0] });
  } catch (err) {
    console.error('respondToAppeal error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
}

module.exports = {
  submitAppeal,
  getMyAppeals,
  getSupervisorAppeals,
  respondToAppeal,
};