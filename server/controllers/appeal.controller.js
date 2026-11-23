const pool = require('../db');
const { createNotification } = require('../services/notification.service');

const evaluationDeployment = `
  JOIN deployment_requests dr ON dr.teacher_batch_id = se.batch_id
    AND dr.workflow_version = 2 AND dr.supervisor_id = se.evaluator_id
  JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
  JOIN teacher_batch_students placement ON placement.teacher_batch_id = dr.teacher_batch_id
    AND placement.student_id = se.student_id`;

const categoryName = `COALESCE(
  se.category_scores->(ga.category_id::text)->>'category_name',
  jsonb_path_query_first(se.category_scores, '$[*] ? (@.category_id == $id)',
    jsonb_build_object('id', ga.category_id))->>'category_name',
  ec.category_name
)`;

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

async function submitAppeal(req, res) {
  const { evaluationId: rawEvaluationId, categoryId: rawCategoryId, reason: rawReason } = req.body || {};
  const evaluationId = positiveId(rawEvaluationId);
  const categoryId = rawCategoryId == null ? null : positiveId(rawCategoryId);
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (!evaluationId || (rawCategoryId != null && !categoryId) || !reason || reason.length > 5000) {
    return res.status(400).json({ error: 'Select a valid evaluation and enter a reason of up to 5,000 characters.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [evaluation] } = await client.query(
      `SELECT se.student_id, se.batch_id, se.category_scores, dr.supervisor_id, s.first_name, s.last_name
       FROM student_evaluations se
       ${evaluationDeployment}
       JOIN students s ON s.id = se.student_id
       WHERE se.id = $1 AND s.user_id = $2
       FOR UPDATE OF se`, [evaluationId, req.user.id]
    );
    if (!evaluation) {
      return res.status(404).json({ error: 'Partner institution evaluation not found.' });
    }
    const scores = evaluation.category_scores;
    const hasCategory = Array.isArray(scores)
      ? scores.some((score) => Number(score?.category_id) === categoryId)
      : Object.hasOwn(scores || {}, categoryId);
    if (categoryId && !hasCategory) {
      return res.status(400).json({ error: 'This category is not part of the evaluation.' });
    }

    const { rows: [appeal] } = await client.query(
      `INSERT INTO grade_appeals (student_id, evaluation_id, batch_id, category_id, reason)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM grade_appeals WHERE evaluation_id = $2 AND category_id IS NOT DISTINCT FROM $4
       )
       RETURNING *`,
      [evaluation.student_id, evaluationId, evaluation.batch_id, categoryId, reason]
    );
    if (!appeal) return res.status(409).json({ error: 'An appeal already exists for this evaluation and category.' });
    await client.query('COMMIT');

    void createNotification({
      userId: evaluation.supervisor_id,
      title: 'New Grade Appeal',
      message: `${evaluation.first_name} ${evaluation.last_name} has submitted a grade appeal.`,
      type: 'appeal',
      category: 'evaluation',
      priority: 'high',
      actionUrl: '/dashboard/supervisor/grade-appeals',
      relatedUserId: req.user.id,
      entityType: 'grade_appeal',
      entityId: appeal.id,
      eventKey: `appeal:${appeal.id}`,
    }).catch((err) => console.error('Appeal notification failed:', err.message));

    res.status(201).json({ appeal });
  } catch (err) {
    console.error('submitAppeal error:', err);
    res.status(500).json({ error: 'Could not submit the appeal.' });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

async function getMyAppeals(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ga.*, se.overall_score, se.overall_percentage, ${categoryName} AS category_name
       FROM grade_appeals ga
       JOIN student_evaluations se ON se.id = ga.evaluation_id AND se.student_id = ga.student_id
       JOIN students s ON s.id = ga.student_id
       LEFT JOIN evaluation_criteria ec ON ec.id = ga.category_id
       WHERE s.user_id = $1
       ORDER BY ga.created_at DESC, ga.id DESC`, [req.user.id]
    );
    res.json({ appeals: rows });
  } catch (err) {
    console.error('getMyAppeals error:', err);
    res.status(500).json({ error: 'Could not load your appeals.' });
  }
}

async function getSupervisorAppeals(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ga.*, se.overall_score, se.overall_percentage, ${categoryName} AS category_name,
         s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand, u.email AS student_email,
         dr.id AS deployment_request_id, pi.id AS partner_institution_id, pi.name AS partner_institution_name
       FROM grade_appeals ga
       JOIN student_evaluations se ON se.id = ga.evaluation_id AND se.student_id = ga.student_id
       ${evaluationDeployment}
       JOIN students s ON s.id = ga.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN evaluation_criteria ec ON ec.id = ga.category_id
       WHERE dr.supervisor_id = $1
       ORDER BY ga.created_at DESC, ga.id DESC`, [req.user.id]
    );
    res.json({ appeals: rows });
  } catch (err) {
    console.error('getSupervisorAppeals error:', err);
    res.status(500).json({ error: 'Could not load partner institution appeals.' });
  }
}

async function respondToAppeal(req, res) {
  const appealId = positiveId(req.params.appealId);
  const { status, response: rawResponse } = req.body || {};
  const response = typeof rawResponse === 'string' ? rawResponse.trim() : '';
  if (!appealId || !['approved', 'rejected'].includes(status) || !response || response.length > 5000) {
    return res.status(400).json({ error: 'Choose a decision and enter a response of up to 5,000 characters.' });
  }

  try {
    const { rows: [reviewed] } = await pool.query(
      `WITH authorized AS (
         SELECT ga.id, s.user_id FROM grade_appeals ga
         JOIN student_evaluations se ON se.id = ga.evaluation_id AND se.student_id = ga.student_id
         ${evaluationDeployment}
         JOIN students s ON s.id = ga.student_id
         WHERE ga.id = $1 AND dr.supervisor_id = $2
       ), updated AS (
         UPDATE grade_appeals ga
         SET status = $3, supervisor_response = $4, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP
         FROM authorized
         WHERE ga.id = authorized.id AND ga.status = 'pending'
         RETURNING ga.*
       )
       SELECT authorized.user_id, updated.* FROM authorized LEFT JOIN updated ON updated.id = authorized.id`,
      [appealId, req.user.id, status, response]
    );
    if (!reviewed) return res.status(404).json({ error: 'Partner institution appeal not found.' });
    if (!reviewed.id) return res.status(409).json({ error: 'This appeal has already been reviewed.' });
    const { user_id: userId, ...appeal } = reviewed;

    void createNotification({
      userId,
      title: 'Grade Appeal Response',
      message: `Your grade appeal has been ${status}. ${response}`,
      type: 'appeal_response',
      category: 'evaluation',
      priority: 'high',
      actionUrl: '/dashboard/student/post-immersion/evaluation',
      relatedUserId: req.user.id,
      entityType: 'grade_appeal',
      entityId: appealId,
      eventKey: `appeal_response:${appealId}`,
    }).catch((err) => console.error('Appeal response notification failed:', err.message));

    res.json({ appeal });
  } catch (err) {
    console.error('respondToAppeal error:', err);
    res.status(500).json({ error: 'Could not respond to the appeal.' });
  }
}

module.exports = { submitAppeal, getMyAppeals, getSupervisorAppeals, respondToAppeal };
