const { readFile } = require('node:fs/promises');
const path = require('node:path');
const pool = require('../../db');

let schemaReady;
function ensureSchema() {
  schemaReady ??= (async () => {
    const { rows: [schema] } = await pool.query(`SELECT
      to_regclass('public.work_immersion_feedback') IS NOT NULL AND
      to_regclass('public.work_immersion_feedback_criteria') IS NOT NULL AS ready`);
    if (!schema.ready) {
      await pool.query(await readFile(path.join(__dirname, '../../db/migrations/049_work_immersion_feedback.sql'), 'utf8'));
    }
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

const targets = ['institution', 'supervisor'];
const validId = (value) => Number.isInteger(value) && value > 0 && value <= 2147483647;

function failure(status, message) {
  throw Object.assign(new Error(message), { status });
}

function endpoint(operation) {
  return async (req, res) => {
    try {
      await ensureSchema();
      res.json(await operation(req, res));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      console.error('Work immersion feedback:', error);
      return res.status(500).json({ error: 'Could not process work immersion feedback.' });
    }
  };
}

async function readCriteria(db, { lock = false } = {}) {
  const { rows: [criteria] } = await db.query(`SELECT version, institution, supervisor
    FROM public.work_immersion_feedback_criteria WHERE id = true ${lock ? 'FOR SHARE' : ''}`);
  return criteria;
}

const getCriteria = endpoint(async () => ({ criteria: await readCriteria(pool) }));

const saveCriteria = endpoint(async (req) => {
  const { version, criteria } = req.body || {};
  if (!validId(version)) failure(400, 'Refresh the page before saving the criteria.');

  const draft = targets.map((target) => {
    const items = criteria?.[target];
    if (!Array.isArray(items) || items.length < 1 || items.length > 20 ||
      items.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 140)) {
      failure(400, 'Enter 1 to 20 criteria of up to 140 characters for each section.');
    }
    const trimmed = items.map((item) => item.trim());
    if (new Set(trimmed.map((item) => item.toLowerCase())).size !== trimmed.length) {
      failure(400, 'Criteria in the same section must be unique.');
    }
    return JSON.stringify(trimmed);
  });

  const { rows: [saved] } = await pool.query(`UPDATE public.work_immersion_feedback_criteria
    SET institution = $1::jsonb, supervisor = $2::jsonb, version = version + 1, updated_at = now()
    WHERE id = true AND version = $3 RETURNING version, institution, supervisor`, [...draft, version]);
  if (!saved) failure(409, 'The criteria changed. Reload the page before saving again.');
  return { criteria: saved };
});

async function readPlacements(db, userId, completedBatchIds, deploymentId = null) {
  const { rows } = await db.query(`SELECT s.id AS student_id, dr.id AS deployment_id, dr.partner_institution_id,
    dr.supervisor_id, pi.name AS institution_name, concat_ws(' ', sv.first_name, sv.last_name) AS supervisor_name,
    tb.batch_label, f.submitted_at, f.institution_ratings, f.supervisor_ratings
    FROM public.students s
    JOIN public.teacher_batch_students tbs ON tbs.student_id = s.id
    JOIN public.teacher_batches tb ON tb.id = tbs.teacher_batch_id
    JOIN public.deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2
      AND dr.status IN ('approved', 'completed')
    JOIN public.partner_institutions pi ON pi.id = dr.partner_institution_id
    JOIN public.supervisors sv ON sv.user_id = dr.supervisor_id
    LEFT JOIN public.work_immersion_feedback f ON f.student_id = s.id AND f.deployment_request_id = dr.id
    WHERE s.user_id = $1 AND ($3::int IS NULL OR dr.id = $3)
      AND (tb.id = ANY($2::int[]) OR f.submitted_at IS NOT NULL)
    ORDER BY tbs.assigned_at DESC, dr.id DESC ${deploymentId ? 'FOR SHARE OF dr, tbs' : ''}`,
  [userId, completedBatchIds, deploymentId]);
  return rows;
}

function completedBatches(journey) {
  return [...new Set(journey.days.filter((day) => day.attendance.status === 'Completed').map((day) => day.teacher_batch_id))];
}

const getMyFeedbackForm = endpoint(async (req, res) => {
  const [criteria, placements] = await Promise.all([
    readCriteria(pool),
    readPlacements(pool, req.user.id, completedBatches(res.locals.studentJourney)),
  ]);
  return {
    criteria,
    placements: placements.map(({ deployment_id, institution_name, supervisor_name, batch_label,
      submitted_at, institution_ratings, supervisor_ratings }) => ({
      deployment_id, institution_name, supervisor_name, batch_label, submitted_at, institution_ratings, supervisor_ratings,
    })),
  };
});

const submitMyFeedback = endpoint(async (req, res) => {
  const { deploymentId, version, ratings } = req.body || {};
  if (!validId(deploymentId) || !validId(version)) failure(400, 'Choose a valid placement and rating form.');

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const [placement] = await readPlacements(db, req.user.id, completedBatches(res.locals.studentJourney), deploymentId);
    if (!placement) failure(403, 'Feedback is available only for a placement you attended.');
    if (placement.submitted_at) failure(409, 'You already submitted feedback for this placement.');

    const criteria = await readCriteria(db, { lock: true });
    if (version !== criteria.version) failure(409, 'The criteria changed. Reload the form before submitting.');
    const values = targets.map((target) => {
      const scores = ratings?.[target];
      if (!Array.isArray(scores) || scores.length !== criteria[target].length ||
        scores.some((stars) => !Number.isInteger(stars) || stars < 1 || stars > 5)) {
        failure(400, 'Choose 1 to 5 stars for every criterion.');
      }
      return {
        ratings: JSON.stringify(criteria[target].map((criterion, index) => ({ criterion, stars: scores[index] }))),
        score: scores.reduce((sum, stars) => sum + stars, 0) / scores.length,
      };
    });

    const { rows: [saved] } = await db.query(`INSERT INTO public.work_immersion_feedback
      (student_id, deployment_request_id, partner_institution_id, supervisor_id, criteria_version,
       institution_ratings, supervisor_ratings, institution_score, supervisor_score)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
      ON CONFLICT (student_id, deployment_request_id) DO NOTHING
      RETURNING submitted_at, institution_ratings, supervisor_ratings`,
    [placement.student_id, deploymentId, placement.partner_institution_id, placement.supervisor_id, version,
      values[0].ratings, values[1].ratings, values[0].score, values[1].score]);
    if (!saved) failure(409, 'You already submitted feedback for this placement.');
    await db.query('COMMIT');
    return { feedback: saved };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
});

const getInstitutionRatings = endpoint(async () => {
  const { rows } = await pool.query(`WITH scores AS (
    SELECT partner_institution_id AS institution_id, round(avg(institution_score), 2)::float AS average,
      count(*)::int AS responses
    FROM public.work_immersion_feedback GROUP BY partner_institution_id
  ) SELECT institution_id, average, responses,
    dense_rank() OVER (ORDER BY average DESC)::int AS highest_rank,
    dense_rank() OVER (ORDER BY average)::int AS lowest_rank
  FROM scores ORDER BY average DESC, responses DESC, institution_id`);
  return { ratings: rows };
});

const getMySupervisorRatings = endpoint(async (req) => {
  const { rows: [summary] } = await pool.query(`WITH feedback AS (
    SELECT partner_institution_id, supervisor_score, supervisor_ratings
    FROM public.work_immersion_feedback WHERE supervisor_id = $1
  ), institutions AS (
    SELECT pi.id, pi.name, round(avg(f.supervisor_score), 2)::float AS average, count(*)::int AS responses
    FROM feedback f JOIN public.partner_institutions pi ON pi.id = f.partner_institution_id GROUP BY pi.id
  ), criteria AS (
    SELECT item->>'criterion' AS criterion, round(avg((item->>'stars')::integer), 2)::float AS average,
      count(*)::int AS responses
    FROM feedback CROSS JOIN LATERAL jsonb_array_elements(supervisor_ratings) AS ratings(item)
    GROUP BY item->>'criterion'
  ) SELECT round(avg(supervisor_score), 2)::float AS average, count(*)::int AS responses,
    coalesce((SELECT jsonb_agg(i ORDER BY i.name, i.id) FROM institutions i), '[]'::jsonb) AS institutions,
    coalesce((SELECT jsonb_agg(c ORDER BY c.criterion) FROM criteria c), '[]'::jsonb) AS criteria
  FROM feedback`, [req.user.id]);
  return summary;
});

module.exports = { ensureFeedbackSchema: ensureSchema, getCriteria, saveCriteria, getMyFeedbackForm, submitMyFeedback, getInstitutionRatings, getMySupervisorRatings };
