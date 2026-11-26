const { readFile } = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db');
const { normalizeEmail } = require('../utils/normalizeEmail');
const { DEFAULT_STUDENT_SCHOOL } = require('../controllers/coordinatorControllers/helpers/constant');

let schemaReady;

function ensureIntakeSchema() {
  schemaReady ??= (async () => {
    const { rows: [state] } = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'uploaded_by_teacher_id') AS ready`);
    if (!state.ready) {
      await pool.query(await readFile(path.join(__dirname, '../db/migrations/056_teacher_student_intake.sql'), 'utf8'));
    }
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

// SQL fragments receive only fixed aliases and placeholders from the callers.
function teacherReviewScope(student, teacher) {
  return `(${student}.intake_teacher_id = ${teacher} OR EXISTS (
    SELECT 1 FROM teacher_batch_students roster
    JOIN teacher_batches batch ON batch.id = roster.teacher_batch_id
    JOIN teachers lead ON lead.id = batch.teacher_id
    WHERE roster.student_id = ${student}.id AND roster.deployment_ended_on IS NULL AND batch.archived_at IS NULL
      AND (lead.user_id = ${teacher} OR EXISTS (
        SELECT 1 FROM deployment_requests request
        JOIN partner_deployment_teachers team ON team.deployment_request_id = request.id
        JOIN teachers member ON member.id = team.teacher_id
        WHERE request.teacher_batch_id = batch.id AND request.workflow_version = 2 AND member.user_id = ${teacher}
      ))
  ))`;
}

function scopeTeacherMutation(target, bulk = false) {
  return async (req, res, next) => {
    if (req.user.role !== 'teacher') return next();
    const values = bulk ? req.body?.[target === 'submission' ? 'submission_ids' : 'student_ids']
      : [target === 'submission' ? req.params.submissionId || req.params.id : req.params.id || req.params.studentId];
    if (!Array.isArray(values) || !values.length || !values.every((id) =>
      /^[1-9]\d{0,9}$/.test(String(id)) && Number(id) <= 2147483647)) {
      return res.status(400).json({ error: 'Choose valid records.' });
    }
    const ids = [...new Set(values.map(Number))];
    await ensureIntakeSchema();
    const result = target === 'submission'
      ? await pool.query(`SELECT sub.id FROM student_requirement_submissions sub JOIN students s ON s.id = sub.student_id
          WHERE sub.id = ANY($1::int[]) AND s.archived_at IS NULL AND ${teacherReviewScope('s', '$2')}`, [ids, req.user.id])
      : await pool.query('SELECT user_id FROM students WHERE user_id = ANY($1::int[]) AND intake_teacher_id = $2', [ids, req.user.id]);
    if (result.rowCount !== ids.length) return res.status(404).json({ error: 'One or more records are outside your student list.' });
    return next();
  };
}

async function claimStudentIntake(req, res) {
  const studentNumber = typeof req.body?.studentNumber === 'string' ? req.body.studentNumber.trim() : '';
  const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
  if (!studentNumber || studentNumber.length > 50 || !email || email.length > 255) {
    return res.status(400).json({ error: 'Enter the student number and registered email.' });
  }
  await ensureIntakeSchema();
  const result = await pool.query(`UPDATE students s SET intake_teacher_id = $3
    FROM users u, teachers t
    WHERE u.id = s.user_id AND u.role = 'student' AND lower(u.email) = $2 AND s.student_number = $1
      AND t.user_id = $3 AND s.archived_at IS NULL AND s.intake_teacher_id IS NULL AND s.uploaded_by_teacher_id IS NULL
      AND lower(COALESCE(NULLIF(trim(t.school), ''), $4)) = lower(COALESCE(NULLIF(trim(s.school), ''), $4))
      AND NOT EXISTS (
        SELECT 1 FROM teacher_batch_students roster JOIN teacher_batches batch ON batch.id = roster.teacher_batch_id
        WHERE roster.student_id = s.id AND roster.deployment_ended_on IS NULL AND batch.archived_at IS NULL
      )`, [studentNumber, email, req.user.id, DEFAULT_STUDENT_SCHOOL]);
  if (!result.rowCount) {
    return res.status(404).json({ error: 'No unassigned student in your school matched both details.' });
  }
  return res.json({ message: 'Student added to your intake list.' });
}

module.exports = { ensureIntakeSchema, teacherReviewScope, scopeTeacherMutation, claimStudentIntake };
