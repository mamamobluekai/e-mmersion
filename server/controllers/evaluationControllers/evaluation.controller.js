const pool = require('../../db');
const { createHash } = require('node:crypto');
const { createNotification } = require('../../services/notification.service');
const { getDeploymentAttendance, listDeploymentAttendance } = require('../../services/deploymentAttendance');
const { assertBatchAccess } = require('../../utils/batchAccess');

let schemaReady;

function ensureEvaluationTables() {
  schemaReady ??= initializeEvaluationTables().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function initializeEvaluationTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evaluation_criteria (
      id SERIAL PRIMARY KEY,
      category_name VARCHAR(255) NOT NULL,
      indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS student_evaluations (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      evaluator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      batch_id INTEGER,
      category_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      overall_score NUMERIC(4,2),
      overall_percentage NUMERIC(5,2),
      comments TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_student_evaluations_student ON student_evaluations(student_id);
    CREATE INDEX IF NOT EXISTS idx_student_evaluations_evaluator ON student_evaluations(evaluator_id);
    CREATE INDEX IF NOT EXISTS idx_student_evaluations_batch ON student_evaluations(batch_id);

    ALTER TABLE student_evaluations ADD COLUMN IF NOT EXISTS overall_percentage NUMERIC(5,2);
    ALTER TABLE evaluation_criteria ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    DROP INDEX IF EXISTS idx_evaluation_criteria_category_name;
  `);

  await pool.query(`
    INSERT INTO evaluation_criteria (id, category_name, indicators, sort_order)
    SELECT seed.id, seed.category_name, seed.indicators::jsonb, seed.sort_order FROM (VALUES
      (1, 'Teamwork', '["Works cooperatively with team members","Contributes to team goals","Shares information and resources","Respects team members'' ideas and opinions","Resolves conflicts constructively"]', 1),
      (2, 'Communication', '["Expresses ideas clearly","Listens actively to others","Follows instructions accurately","Asks for clarification when needed"]', 2),
      (3, 'Attendance and Punctuality', '["Arrives on time for work","Attends all scheduled activities","Notifies supervisor of absences promptly"]', 3),
      (4, 'Productivity/Resilience', '["Completes tasks within deadlines","Maintains quality of work under pressure","Adapts to changing priorities","Bounces back from setbacks","Manages time effectively","Handles multiple tasks efficiently"]', 4),
      (5, 'Initiative/Proactivity', '["Seeks out additional responsibilities","Identifies areas for improvement","Takes initiative without being asked","Offers innovative solutions","Demonstrates self-direction","Volunteers for challenging tasks"]', 5),
      (6, 'Judgemental/Decision Making', '["Makes sound decisions","Considers consequences before acting","Seeks guidance when appropriate"]', 6),
      (7, 'Dependability/Reliability', '["Completes assigned tasks consistently","Follows through on commitments","Can be trusted with confidential information","Takes responsibility for actions"]', 7),
      (8, 'Attitude', '["Demonstrates positive outlook","Shows enthusiasm for work","Accepts constructive feedback","Treats others with respect","Maintains professional demeanor"]', 8),
      (9, 'Professionalism', '["Maintains appropriate appearance","Uses professional language","Adheres to company policies","Demonstrates ethical behavior"]', 9)
    ) AS seed(id, category_name, indicators, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM evaluation_criteria)
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function readCriteria(db, { includeInactive = false } = {}) {
  const { rows } = await db.query(`SELECT id, category_name, indicators, sort_order
    FROM evaluation_criteria ${includeInactive ? '' : 'WHERE is_active'}
    ORDER BY sort_order, id`);
  return rows.map((row) => ({ ...row, indicators: Array.isArray(row.indicators) ? row.indicators : [] }));
}

function criteriaVersion(criteria) {
  return createHash('sha256').update(JSON.stringify(criteria)).digest('hex');
}

const validId = (value) => ['number', 'string'].includes(typeof value) &&
  Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;

async function getCriteria(req, res) {
  try {
    await ensureEvaluationTables();
    const criteria = await readCriteria(pool, { includeInactive: req.user.role === 'student' });
    res.json({ criteria, criteria_version: criteriaVersion(criteria) });
  } catch (err) {
    console.error('getCriteria error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function saveCriteria(req, res) {
  let client;
  let inTransaction = false;
  try {
    const { criteria } = req.body || {};
    if (!Array.isArray(criteria) || !criteria.length || criteria.some((item) =>
      typeof item?.category_name !== 'string' || !item.category_name.trim() || item.category_name.trim().length > 255 ||
      !Array.isArray(item.indicators) || !item.indicators.length ||
      item.indicators.some((indicator) => typeof indicator !== 'string' || !indicator.trim()))) {
      return res.status(400).json({ error: 'Enter a name and at least one indicator for every category.' });
    }
    const draft = criteria.map((item) => ({
      id: validId(item.id) ? Number(item.id) : null,
      category_name: item.category_name.trim(),
      indicators: item.indicators.map((indicator) => indicator.trim()),
    }));
    const ids = draft.flatMap(({ id }) => id ? [id] : []);
    if (new Set(ids).size !== ids.length ||
        new Set(draft.map(({ category_name }) => category_name.toLowerCase())).size !== draft.length) {
      return res.status(400).json({ error: 'Each category must have a unique name.' });
    }

    await ensureEvaluationTables();
    client = await pool.connect();
    await client.query('BEGIN');
    inTransaction = true;
    await client.query('LOCK TABLE evaluation_criteria IN SHARE ROW EXCLUSIVE MODE');
    const current = await readCriteria(client);
    if (req.body.criteriaVersion && req.body.criteriaVersion !== criteriaVersion(current)) {
      return res.status(409).json({ error: 'The grading criteria changed. Reload them before saving.' });
    }
    await client.query('UPDATE evaluation_criteria SET is_active = false WHERE is_active AND NOT (id = ANY($1::int[]))', [ids]);
    if (draft.some(({ id }) => id === null)) {
      await client.query(`SELECT setval(pg_get_serial_sequence('evaluation_criteria', 'id'),
        GREATEST(COALESCE(MAX(id), 1), nextval(pg_get_serial_sequence('evaluation_criteria', 'id'))))
        FROM evaluation_criteria`);
    }
    for (const [index, category] of draft.entries()) {
      const values = [category.category_name, JSON.stringify(category.indicators), index + 1];
      if (category.id) {
        const updated = await client.query(`UPDATE evaluation_criteria SET category_name = $1, indicators = $2::jsonb,
          sort_order = $3, is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $4`, [...values, category.id]);
        if (!updated.rowCount) return res.status(409).json({ error: 'A grading category changed. Reload before saving.' });
      } else {
        await client.query(`INSERT INTO evaluation_criteria (category_name, indicators, sort_order)
          VALUES ($1, $2::jsonb, $3)`, values);
      }
    }

    const saved = await readCriteria(client);
    await client.query('COMMIT');
    inTransaction = false;
    res.json({ message: 'Criteria saved.', criteria: saved, criteria_version: criteriaVersion(saved) });
  } catch (err) {
    console.error('saveCriteria error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    client?.release();
  }
}

function computeScores(criteria, categoryScores) {
  const ratingValues = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 'N/A': 0 };
  let totalWeighted = 0;
  let totalCounted = 0;

  const scores = criteria.map((cat) => {
    const catData = categoryScores[String(cat.id)] || {};
    const indicators = cat.indicators || [];
    const ratings = catData.indicators || [];
    let sum = 0;
    let naCount = 0;

    for (let i = 0; i < indicators.length; i++) {
      const r = ratings[i];
      if (r === 'N/A') naCount++;
      else sum += Number(ratingValues[r] || 0);
    }

    const counted = indicators.length - naCount;
    const categoryScore = counted > 0 ? sum / counted : 0;

    if (counted > 0) {
      totalWeighted += sum;
      totalCounted += counted;
    }

    return {
      category_id: cat.id,
      category_name: cat.category_name,
      indicator_labels: indicators,
      ratings,
      category_score: counted > 0 ? Math.round(categoryScore * 100) / 100 : 0,
      category_percentage: counted > 0 ? Math.round((categoryScore / 5) * 10000) / 100 : 0,
      counted,
    };
  });

  const overallScore = totalCounted > 0 ? Math.round((totalWeighted / totalCounted) * 100) / 100 : 0;
  const overallPercentage = totalCounted > 0 ? Math.round((overallScore / 5) * 10000) / 100 : 0;

  return { category_scores: scores, overall_score: overallScore, overall_percentage: overallPercentage };
}

async function submitEvaluation(req, res) {
  let client;
  let inTransaction = false;
  try {
    const { studentId, batchId, partnerInstitutionId, categoryScores, comments } = req.body || {};
    if (!validId(studentId) || (batchId != null && !validId(batchId)) ||
        (partnerInstitutionId != null && !validId(partnerInstitutionId)) ||
        !categoryScores || typeof categoryScores !== 'object' || Array.isArray(categoryScores) ||
        (comments != null && typeof comments !== 'string')) {
      return res.status(400).json({ error: 'Choose a student and provide valid evaluation ratings.' });
    }
    await ensureEvaluationTables();
    client = await pool.connect();
    await client.query('BEGIN');
    inTransaction = true;
    await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [studentId]);
    const placement = await getDeploymentAttendance(client, studentId, req.user.id, batchId ?? null, partnerInstitutionId ?? null);
    if (!placement) return res.status(403).json({ error: 'This student is not assigned to your deployment.' });
    if (!Number.isFinite(placement.required_attendance_days)) {
      return res.status(409).json({ error: 'An agreed attendance schedule is required before evaluation.' });
    }
    if (placement.attendance_days < placement.required_attendance_days) {
      return res.status(400).json({ error: `Complete ${placement.required_attendance_days} agreed workdays before evaluation. Recorded days: ${placement.attendance_days}.` });
    }

    const criteria = await readCriteria(client);
    if (req.body.criteriaVersion && req.body.criteriaVersion !== criteriaVersion(criteria)) {
      return res.status(409).json({ error: 'The grading criteria changed. Reload them before submitting.' });
    }
    const validRating = (rating) => rating === 'N/A' ||
      (['number', 'string'].includes(typeof rating) && /^[1-5]$/.test(String(rating)));
    if (!criteria.length || Object.keys(categoryScores).length !== criteria.length || criteria.some((category) => {
      const ratings = categoryScores[category.id]?.indicators;
      return !Array.isArray(ratings) || ratings.length !== category.indicators.length || !ratings.every(validRating);
    })) {
      return res.status(400).json({ error: 'Rate every indicator using 1–5 stars or N/A.' });
    }

    const { category_scores, overall_score, overall_percentage } = computeScores(criteria, categoryScores);

    const existing = await client.query(
      'SELECT id FROM student_evaluations WHERE student_id = $1 AND evaluator_id = $2 AND batch_id = $3 ORDER BY id DESC LIMIT 1',
      [studentId, req.user.id, placement.batch_id]
    );

    let result;
    if (existing.rows.length) {
      result = await client.query(
        `UPDATE student_evaluations
         SET batch_id = $1, category_scores = $2::jsonb, overall_score = $3, overall_percentage = $4, comments = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [placement.batch_id, JSON.stringify(category_scores), overall_score, overall_percentage, comments || null, existing.rows[0].id]
      );
    } else {
      result = await client.query(
        `INSERT INTO student_evaluations (student_id, evaluator_id, batch_id, category_scores, overall_score, overall_percentage, comments)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
         RETURNING *`,
        [studentId, req.user.id, placement.batch_id, JSON.stringify(category_scores), overall_score, overall_percentage, comments || null]
      );
    }

    await client.query('COMMIT');
    inTransaction = false;
    void createNotification({
      userId: placement.user_id,
      title: 'Evaluation updated',
      message: 'Your work immersion evaluation is now available to review.',
      type: 'evaluation',
      category: 'evaluation',
      priority: 'high',
      actionUrl: '/dashboard/student/evaluation',
      relatedUserId: req.user.id,
      entityType: 'student_evaluation',
      entityId: result.rows[0].id,
      eventKey: `evaluation:${result.rows[0].id}:${result.rows[0].updated_at}`,
    }).catch((err) => console.error('Evaluation notification failed:', err.message));

    res.status(existing.rows.length ? 200 : 201).json({ evaluation: result.rows[0] });
  } catch (err) {
    console.error('submitEvaluation error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    client?.release();
  }
}

async function getStudentEvaluation(req, res) {
  try {
    await ensureEvaluationTables();
    const { studentId } = req.params;
    const { batchId } = req.query;
    if (!validId(studentId) || (batchId != null && !validId(batchId))) {
      return res.status(400).json({ error: 'Invalid deployment or student.' });
    }
    if (batchId && req.user.role !== 'admin') {
      const gate = await assertBatchAccess(req.user, batchId);
      if (!gate.ok) return res.status(gate.denied.status).json({ error: gate.denied.error });
    }
    const result = await pool.query(
      `SELECT se.*, u.email AS evaluator_email,
              s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand
       FROM student_evaluations se
       JOIN users u ON u.id = se.evaluator_id
       LEFT JOIN supervisors sv ON sv.user_id = se.evaluator_id
       JOIN students s ON s.id = se.student_id
       WHERE se.student_id = $1 AND ($2::int IS NULL OR se.batch_id = $2)
         AND ($3::int IS NULL OR se.evaluator_id = $3)
       ORDER BY se.created_at DESC, se.id DESC
       LIMIT 1`,
      [studentId, batchId || null, req.user.role === 'supervisor' ? req.user.id : null]
    );
    if (!result.rows.length) {
      return res.json({ evaluation: null });
    }
    res.json({ evaluation: result.rows[0] });
  } catch (err) {
    console.error('getStudentEvaluation error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function listBatchEvaluations(req, res) {
  try {
    await ensureEvaluationTables();
    const { batchId } = req.params;
    if (req.user.role !== 'admin') {
      const gate = await assertBatchAccess(req.user, batchId);
      if (!gate.ok) return res.status(gate.denied.status).json({ error: gate.denied.error });
    }
    const result = await pool.query(
      `SELECT se.*, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand, u.email
       FROM student_evaluations se
       JOIN students s ON s.id = se.student_id
       JOIN users u ON u.id = s.user_id
       WHERE se.batch_id = $1
       ORDER BY s.last_name ASC, s.first_name ASC`,
      [batchId]
    );
    res.json({ evaluations: result.rows });
  } catch (err) {
    console.error('listBatchEvaluations error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function listMyStudents(req, res) {
  try {
    await ensureEvaluationTables();
    const supervisorUserId = req.user.id;
    const placements = await listDeploymentAttendance(pool, { supervisorId: supervisorUserId });
    const batchIds = [...new Set(placements.map(({ batch_id }) => batch_id))];
    const { rows } = await pool.query(`SELECT DISTINCT ON (batch_id, student_id)
      id, batch_id, student_id, overall_score, overall_percentage, created_at, updated_at
      FROM student_evaluations WHERE evaluator_id = $1 AND batch_id = ANY($2::int[])
      ORDER BY batch_id, student_id, id DESC`, [supervisorUserId, batchIds]);
    const evaluations = new Map(rows.map((row) => [`${row.batch_id}:${row.student_id}`, row]));
    const students = placements.map(({ confirmed_schedule, ...student }) => ({
      ...student, evaluation: evaluations.get(`${student.batch_id}:${student.student_id}`) || null,
    })).sort((a, b) => a.partner_institution_name.localeCompare(b.partner_institution_name) ||
      a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    res.json({ students });
  } catch (err) {
    console.error('listMyStudents error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function getMyEvaluation(req, res) {
  try {
    await ensureEvaluationTables();
    const studentUserId = req.user.id;

    const studentResult = await pool.query(
      'SELECT id FROM students WHERE user_id = $1 LIMIT 1',
      [studentUserId]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }
    const studentId = studentResult.rows[0].id;

    const result = await pool.query(
      `SELECT se.*, u.email AS evaluator_email,
              sv.first_name AS evaluator_first_name,
              sv.last_name AS evaluator_last_name,
              s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand,
              pi.id AS partner_institution_id, pi.name AS partner_institution_name
       FROM student_evaluations se
       JOIN users u ON u.id = se.evaluator_id
       LEFT JOIN supervisors sv ON sv.user_id = se.evaluator_id
       JOIN students s ON s.id = se.student_id
       LEFT JOIN deployment_requests dr ON dr.teacher_batch_id = se.batch_id
         AND dr.workflow_version = 2 AND dr.supervisor_id = se.evaluator_id
       LEFT JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
       WHERE se.student_id = $1
         AND (se.overall_score IS NOT NULL OR se.overall_percentage IS NOT NULL)
         AND (se.batch_id IS NULL OR EXISTS (
           SELECT 1 FROM teacher_batch_students tbs
           WHERE tbs.student_id = se.student_id AND tbs.teacher_batch_id = se.batch_id
         ))
       ORDER BY se.created_at DESC, se.id DESC
       LIMIT 1`,
      [studentId]
    );
    if (!result.rows.length) {
      return res.json({ evaluation: null });
    }
    res.json({ evaluation: result.rows[0] });
  } catch (err) {
    console.error('getMyEvaluation error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function getTeacherBatchEvaluations(req, res) {
  try {
    await ensureEvaluationTables();
    const teacherUserId = req.user.id;

    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1 LIMIT 1',
      [teacherUserId]
    );
    if (!teacherResult.rows.length) {
      return res.status(404).json({ error: 'Teacher profile not found.' });
    }
    const teacherId = teacherResult.rows[0].id;

    // Evaluation criteria (category names + their indicators) so the teacher
    // dashboard can show a per-criterion breakdown for each student.
    const criteria = await readCriteria(pool, { includeInactive: true });

    const batchesResult = await pool.query(
      `SELECT tb.id AS batch_id, tb.batch_label, tb.supervisor_id,
              pi.id AS partner_institution_id, pi.name AS partner_institution_name,
              sv.first_name AS supervisor_first_name, sv.last_name AS supervisor_last_name
       FROM teacher_batches tb
       JOIN supervisors sv ON sv.user_id = tb.supervisor_id
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
       JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
       WHERE tb.archived_at IS NULL AND (tb.teacher_id = $1 OR EXISTS (
         SELECT 1 FROM partner_deployment_teachers link WHERE link.deployment_request_id = dr.id AND link.teacher_id = $1
       ))
       ORDER BY pi.name, tb.id DESC`,
      [teacherId]
    );

    const grouped = [];
    for (const batch of batchesResult.rows) {
      const studentsResult = await pool.query(
        `SELECT s.id AS student_id, s.user_id, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand, u.email
         FROM teacher_batch_students tbs
         JOIN students s ON s.id = tbs.student_id
         JOIN users u ON u.id = s.user_id
         WHERE tbs.teacher_batch_id = $1 AND tbs.deployment_ended_on IS NULL
         ORDER BY s.last_name ASC, s.first_name ASC`,
        [batch.batch_id]
      );

      const students = await Promise.all(
        studentsResult.rows.map(async (s) => {
          const evResult = await pool.query(
            `SELECT se.id, se.overall_score, se.overall_percentage, se.created_at, se.comments,
                    se.category_scores, u.email AS evaluator_email
             FROM student_evaluations se
             JOIN users u ON u.id = se.evaluator_id
             WHERE se.student_id = $1 AND (se.batch_id = $2 OR se.batch_id IS NULL)
             ORDER BY (se.batch_id IS NOT NULL) DESC, se.created_at DESC, se.id DESC
             LIMIT 1`,
            [s.student_id, batch.batch_id]
          );
          return {
            ...s,
            evaluation: evResult.rows[0] || null,
          };
        })
      );

      grouped.push({
        batch_id: batch.batch_id,
        batch_label: batch.batch_label,
        partner_institution_id: batch.partner_institution_id,
        partner_institution_name: batch.partner_institution_name,
        supervisor_id: batch.supervisor_id,
        supervisor_name: `${batch.supervisor_first_name || ''} ${batch.supervisor_last_name || ''}`.trim() || 'Supervisor',
        students,
      });
    }

    res.json({ groups: grouped, criteria });
  } catch (err) {
    console.error('getTeacherBatchEvaluations error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

module.exports = {
  getCriteria,
  saveCriteria,
  submitEvaluation,
  getStudentEvaluation,
  getMyEvaluation,
  listBatchEvaluations,
  listMyStudents,
  getTeacherBatchEvaluations,
};
