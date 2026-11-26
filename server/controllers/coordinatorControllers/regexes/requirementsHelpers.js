const { DEFAULT_GRADE_LEVEL, DEFAULT_STUDENT_SCHOOL } = require('../helpers/constant');
const { normalize } = require('./validation');
const { canStudentUploadRequirementFile } = require('../requirementsSubmissionPolicy');
const pool = require('../../../db');
const { ensureDocumentTypesSchema } = require('./documentTypeSchema');
const {
  formFieldsFor,
  guardianEmergencyComplete,
  isFormRequirement,
  missingFormFieldLabels,
  personalInformationComplete,
} = require('./formRequirements');

/**
 * The "Needs Revision" checklist column. This project applies migrations by
 * hand, so the column is created on first use (idempotent DDL, memoised) rather
 * than assumed - otherwise every review would 500 on a database that has not
 * run 033_submission_revision_documents.sql yet.
 */
let revisionColumnPromise = null;
async function ensureRevisionDocumentColumn() {
  if (revisionColumnPromise) return revisionColumnPromise;
  revisionColumnPromise = (async () => {
    await pool.query(
      'ALTER TABLE student_requirement_submissions ADD COLUMN IF NOT EXISTS revision_document_ids JSONB'
    );
  })().catch((err) => {
    revisionColumnPromise = null;
    throw err;
  });
  return revisionColumnPromise;
}

let formRequirementVerificationTablePromise = null;
async function ensureFormRequirementVerificationTable() {
  if (formRequirementVerificationTablePromise) return formRequirementVerificationTablePromise;
  formRequirementVerificationTablePromise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS student_form_requirement_verifications (
         submission_id INTEGER NOT NULL REFERENCES student_requirement_submissions(id) ON DELETE CASCADE,
         document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
         verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
         verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (submission_id, document_type_id)
       )`
    );
  })().catch((err) => {
    formRequirementVerificationTablePromise = null;
    throw err;
  });
  return formRequirementVerificationTablePromise;
}

let requirementReviewSchemaPromise = null;
async function ensureRequirementReviewSchema() {
  if (requirementReviewSchemaPromise) return requirementReviewSchemaPromise;
  requirementReviewSchemaPromise = (async () => {
    await ensureRevisionDocumentColumn();
    await ensureFormRequirementVerificationTable();
    await pool.query(
      `CREATE TABLE IF NOT EXISTS student_requirement_statuses (
         submission_id INTEGER NOT NULL REFERENCES student_requirement_submissions(id) ON DELETE CASCADE,
         document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
         status VARCHAR(50) NOT NULL,
         feedback TEXT,
         updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (submission_id, document_type_id)
       );
       CREATE TABLE IF NOT EXISTS student_requirement_status_history (
         id BIGSERIAL PRIMARY KEY,
         submission_id INTEGER NOT NULL REFERENCES student_requirement_submissions(id) ON DELETE CASCADE,
         document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
         document_id INTEGER REFERENCES student_documents(id) ON DELETE SET NULL,
         status VARCHAR(50) NOT NULL,
         action VARCHAR(50) NOT NULL,
         feedback TEXT,
         original_name TEXT,
         cloudinary_url TEXT,
         details JSONB,
         actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    );
    await pool.query(
      `INSERT INTO student_requirement_statuses
         (submission_id, document_type_id, status, updated_by, updated_at)
       SELECT submission_id, document_type_id,
              CASE LOWER(COALESCE(status, ''))
                WHEN 'verified' THEN 'APPROVED'
                WHEN 'approved' THEN 'APPROVED'
                WHEN 'rejected' THEN 'NEEDS REVISION'
                WHEN 'needs revision' THEN 'NEEDS REVISION'
                WHEN 'resubmitted - awaiting review' THEN 'RESUBMITTED - AWAITING REVIEW'
                ELSE 'PENDING'
              END,
              verified_by, COALESCE(verified_date, uploaded_date, CURRENT_TIMESTAMP)
         FROM (
           SELECT DISTINCT ON (submission_id, document_type_id) *
             FROM student_documents
            ORDER BY submission_id, document_type_id, uploaded_date DESC, id DESC
         ) latest_documents
       ON CONFLICT (submission_id, document_type_id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO student_requirement_status_history
         (submission_id, document_type_id, document_id, status, action,
          original_name, cloudinary_url, actor_id, created_at)
       SELECT submission_id, document_type_id, id,
              CASE LOWER(COALESCE(status, ''))
                WHEN 'verified' THEN 'APPROVED'
                WHEN 'approved' THEN 'APPROVED'
                WHEN 'rejected' THEN 'NEEDS REVISION'
                WHEN 'needs revision' THEN 'NEEDS REVISION'
                WHEN 'resubmitted - awaiting review' THEN 'RESUBMITTED - AWAITING REVIEW'
                ELSE 'PENDING'
              END,
              'MIGRATED', original_name, cloudinary_url, verified_by,
              COALESCE(verified_date, uploaded_date, CURRENT_TIMESTAMP)
         FROM (
           SELECT DISTINCT ON (submission_id, document_type_id) *
             FROM student_documents
            ORDER BY submission_id, document_type_id, uploaded_date DESC, id DESC
         ) latest_documents
        WHERE NOT EXISTS (
          SELECT 1
            FROM student_requirement_status_history history
           WHERE history.document_id = latest_documents.id
             AND history.action = 'MIGRATED'
        )`
    );
    await pool.query(
      `INSERT INTO student_requirement_statuses
         (submission_id, document_type_id, status, updated_by, updated_at)
       SELECT submission.id, document_type.id, 'NEEDS REVISION',
              submission.reviewed_by, submission.updated_at
         FROM student_requirement_submissions submission
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(submission.revision_document_ids) = 'array'
               THEN submission.revision_document_ids
             ELSE '[]'::jsonb
           END
         ) AS legacy(document_type_id)
         JOIN document_types document_type
           ON document_type.id::text = legacy.document_type_id
       ON CONFLICT (submission_id, document_type_id)
       DO UPDATE SET status = 'NEEDS REVISION',
                     updated_by = EXCLUDED.updated_by,
                     updated_at = EXCLUDED.updated_at`
    );
    await pool.query(
      `INSERT INTO student_requirement_status_history
         (submission_id, document_type_id, status, action, actor_id, created_at)
       SELECT submission.id, document_type.id, 'NEEDS REVISION', 'MIGRATED',
              submission.reviewed_by, submission.updated_at
         FROM student_requirement_submissions submission
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(submission.revision_document_ids) = 'array'
               THEN submission.revision_document_ids
             ELSE '[]'::jsonb
           END
         ) AS legacy(document_type_id)
         JOIN document_types document_type
           ON document_type.id::text = legacy.document_type_id
        WHERE NOT EXISTS (
          SELECT 1
            FROM student_requirement_status_history history
           WHERE history.submission_id = submission.id
             AND history.document_type_id = document_type.id
             AND history.status = 'NEEDS REVISION'
             AND history.action = 'MIGRATED'
        )`
    );
    await pool.query(
      `UPDATE student_requirement_submissions
          SET revision_document_ids = NULL
        WHERE revision_document_ids IS NOT NULL`
    );
    await pool.query(
      `INSERT INTO student_requirement_statuses
         (submission_id, document_type_id, status, updated_by, updated_at)
       SELECT submission_id, document_type_id, 'APPROVED', verified_by, verified_at
         FROM student_form_requirement_verifications
       ON CONFLICT (submission_id, document_type_id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO student_requirement_status_history
         (submission_id, document_type_id, status, action, actor_id, created_at)
       SELECT verification.submission_id, verification.document_type_id,
              'APPROVED', 'MIGRATED', verification.verified_by, verification.verified_at
         FROM student_form_requirement_verifications verification
        WHERE NOT EXISTS (
          SELECT 1
            FROM student_requirement_status_history history
           WHERE history.submission_id = verification.submission_id
             AND history.document_type_id = verification.document_type_id
             AND history.action = 'MIGRATED'
        )`
    );
  })().catch((err) => {
    requirementReviewSchemaPromise = null;
    throw err;
  });
  return requirementReviewSchemaPromise;
}

/**
 * Load the active requirement definitions.
 * These live in the `document_types` table so coordinators can add, edit, or
 * remove requirements without a code change.
 */
const getActiveDocumentTypes = async (client) => {
  await ensureDocumentTypesSchema();
  const result = await client.query(
    `SELECT id, code, name, section, input_type, sort_order
     FROM document_types
     WHERE COALESCE(is_active, TRUE)
     ORDER BY sort_order, id`
  );
  return result.rows;
};

/**
 * One entry per active requirement, resolved to whether the student has
 * satisfied it. File requirements are satisfied by an upload tied to the
 * submission (`uploadedTypeIds`); form requirements are satisfied by the
 * matching profile fields being filled in.
 */
const buildRequirementStatuses = (activeTypes, student, uploadedTypeIds = []) => {
  // Callers pass either a Set or a plain array of ids.
  const uploaded =
    uploadedTypeIds instanceof Set ? uploadedTypeIds : new Set(uploadedTypeIds || []);

  return activeTypes.map((type) => {
    const form = isFormRequirement(type);
    const missingFields = form ? missingFormFieldLabels(student || {}, type.code) : [];
    return {
      id: type.id,
      code: type.code,
      name: type.name,
      section: type.section,
      input_type: form ? 'form' : 'file',
      completed: form ? missingFields.length === 0 : uploaded.has(type.id),
      missing_fields: missingFields,
      // Only form requirements carry fields; the page uses these to recheck the
      // list as the student types.
      fields: form ? formFieldsFor(type.code) : [],
    };
  });
};

/**
 * The ids of the requirements a student still has to satisfy: unfilled form
 * sections and files that were never uploaded.
 */
const missingRequirementCodes = (statuses) =>
  statuses.filter((status) => !status.completed).map((status) => status.code);

/**
 * Shown when a student submits too early. Names the requirements still
 * outstanding so the message says what to do rather than just "incomplete".
 */
const describeOutstanding = (statuses) => {
  const names = (statuses || []).filter((status) => !status.completed).map((status) => status.name);
  if (names.length === 0) return 'Complete every required section before submitting.';
  return `Complete every required section before submitting. Still missing: ${names.join(', ')}.`;
};

const getOrCreateStudent = async (client, userId, body = {}) => {
  const userResult = await client.query(
    `SELECT u.id, u.email, u.phone
     FROM users u
     WHERE u.id = $1 AND u.role = 'student'`,
    [userId]
  );

  if (userResult.rows.length === 0) throw new Error('Student account not found.');
  const user = userResult.rows[0];

  const existing = await client.query('SELECT * FROM students WHERE user_id = $1', [userId]);
  if (existing.rows.length) {
    const student = existing.rows[0];
    if (student.school?.trim() && student.email?.trim()) return student;
    const updated = await client.query(
      `UPDATE students
          SET school = CASE WHEN NULLIF(BTRIM(school), '') IS NULL THEN $2 ELSE school END,
              email = CASE WHEN NULLIF(BTRIM(email), '') IS NULL THEN $3 ELSE email END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [student.id, DEFAULT_STUDENT_SCHOOL, user.email]
    );
    return updated.rows[0];
  }

  const studentNumber = normalize(body.student_number) || `S-${userId}`;

  const created = await client.query(
    `INSERT INTO students (user_id, student_number, first_name, last_name, email, contact_number, grade_level, school)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      studentNumber,
      normalize(body.first_name) || 'Student',
      normalize(body.last_name) || 'User',
      user.email,
      user.phone || normalize(body.contact_number) || '',
      DEFAULT_GRADE_LEVEL,
      DEFAULT_STUDENT_SCHOOL,
    ]
  );

  return created.rows[0];
};

/**
 * Grade Level is fixed at "Grade 12" and no longer asked for on the
 * Requirements page, so a row saved without one is backfilled rather than left
 * blank for the coordinator and admin views to show as empty. Rows written by
 * the older import paths hold a bare "12" and are normalised to the same label.
 */
const ensureDefaultGradeLevel = async (client, studentId) => {
  await client.query(
    `UPDATE students
        SET grade_level = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND (grade_level IS NULL OR BTRIM(grade_level) = '' OR grade_level = '12')`,
    [studentId, DEFAULT_GRADE_LEVEL]
  );
};

const getOrCreateSubmission = async (client, student, userId) => {
  const existing = await client.query(
    `SELECT * FROM student_requirement_submissions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [student.id]
  );
  if (existing.rows.length) return existing.rows[0];

  const created = await client.query(
    `INSERT INTO student_requirement_submissions (student_id, user_id, status, progress)
     VALUES ($1, $2, 'Pending', 0)
     RETURNING *`,
    [student.id, userId]
  );
  return created.rows[0];
};

const calculateProgress = async (client, studentId, { persist = true } = {}) => {
  const studentResult = await client.query('SELECT * FROM students WHERE id = $1', [studentId]);
  const student = studentResult.rows[0] || {};
  const docs = await client.query(
    `SELECT dt.id
       FROM student_documents sd
       JOIN document_types dt ON dt.id = sd.document_type_id
      WHERE sd.student_id = $1 AND COALESCE(dt.is_active, TRUE)`,
    [studentId]
  );
  const uploadedTypeIds = new Set(docs.rows.map((row) => row.id));

  // Active requirements drive completeness, so adding/removing a requirement
  // immediately re-evaluates every student's progress. Form requirements are
  // complete when their fields are filled in, file requirements when the
  // upload exists.
  const activeTypes = await getActiveDocumentTypes(client);
  const statuses = buildRequirementStatuses(activeTypes, student, uploadedTypeIds);
  const sectionComplete = (section) =>
    statuses.filter((status) => status.section === section).every((status) => status.completed);

  // The two form sections stand on their own data: the section is only done
  // when the fields are filled AND whatever else the coordinator attached to
  // that section (file requirements) is uploaded.
  const personalComplete = personalInformationComplete(student) && sectionComplete('personal');

  const guardianComplete = guardianEmergencyComplete(student) && sectionComplete('guardian');

  const medicalComplete = sectionComplete('medical');
  const academicComplete = sectionComplete('academic');

  const sections = { personalComplete, guardianComplete, medicalComplete, academicComplete };
  const progress = Object.values(sections).filter(Boolean).length * 25;
  if (persist) {
    await client.query(
      `UPDATE student_requirement_submissions SET progress = $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2`,
      [progress, studentId]
    );
  }

  const missingCodes = missingRequirementCodes(statuses);
  const completedCount = statuses.length - missingCodes.length;

  return {
    progress,
    sections,
    missingDocuments: missingCodes,
    requirementStatuses: statuses,
    requirementSummary: {
      total: statuses.length,
      completed: completedCount,
      missing: missingCodes.length,
    },
  };
};

/**
 * Recalculate progress for every student. Called after a coordinator changes
 * the requirement definitions so all dashboards stay consistent.
 */
const recalculateAllProgress = async (client) => {
  const students = await client.query('SELECT id FROM students');
  for (const row of students.rows) {
    await calculateProgress(client, row.id);
  }
  return students.rows.length;
};

const serializeRequirements = async (client, studentId, { readOnly = false } = {}) => {
  await ensureRequirementReviewSchema();
  const student = await client.query('SELECT * FROM students WHERE id = $1', [studentId]);
  const submission = await client.query(
    `SELECT s.*,
            COALESCE(t.first_name || ' ' || t.last_name,
                     sv.first_name || ' ' || sv.last_name,
                     c.first_name || ' ' || c.last_name,
                     a.first_name || ' ' || a.last_name,
                     st.first_name || ' ' || st.last_name) AS reviewed_by_name
     FROM student_requirement_submissions s
     LEFT JOIN teachers t ON t.user_id = s.reviewed_by
     LEFT JOIN supervisors sv ON sv.user_id = s.reviewed_by
     LEFT JOIN coordinators c ON c.user_id = s.reviewed_by
     LEFT JOIN admins a ON a.user_id = s.reviewed_by
     LEFT JOIN students st ON st.user_id = s.reviewed_by
     WHERE s.student_id = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    [studentId]
  );
  const documents = await client.query(
    `SELECT sd.*, dt.code, dt.section, dt.name AS requirement_name
     FROM student_documents sd
     LEFT JOIN document_types dt ON dt.id = sd.document_type_id
     WHERE sd.student_id = $1
     ORDER BY sd.uploaded_date DESC`,
    [studentId]
  );
  const logs = await client.query(
    `SELECT sl.*,
            COALESCE(t.first_name || ' ' || t.last_name,
                     sv.first_name || ' ' || sv.last_name,
                     c.first_name || ' ' || c.last_name,
                     a.first_name || ' ' || a.last_name,
                     st.first_name || ' ' || st.last_name) AS actor_name
     FROM submission_logs sl
     LEFT JOIN teachers t ON t.user_id = sl.actor_id
     LEFT JOIN supervisors sv ON sv.user_id = sl.actor_id
     LEFT JOIN coordinators c ON c.user_id = sl.actor_id
     LEFT JOIN admins a ON a.user_id = sl.actor_id
     LEFT JOIN students st ON st.user_id = sl.actor_id
     WHERE sl.submission_id = $1
     ORDER BY sl.created_at DESC LIMIT 20`,
    [submission.rows[0]?.id || 0]
  );
  const progress = await calculateProgress(client, studentId, { persist: !readOnly });
  const formVerificationResult = await client.query(
    `SELECT document_type_id, verified_at
       FROM student_form_requirement_verifications
      WHERE submission_id = $1`,
    [submission.rows[0]?.id || 0]
  );
  const formVerifications = new Map(
    formVerificationResult.rows.map((row) => [Number(row.document_type_id), row])
  );
  const requirementStatuses = progress.requirementStatuses.map((status) => {
    if (status.input_type !== 'form') return status;
    const verification = formVerifications.get(Number(status.id));
    return {
      ...status,
      verified: !!verification,
      verified_at: verification?.verified_at || null,
    };
  });
  const reviewStates = await client.query(
    `SELECT document_type_id, status, feedback, updated_at
       FROM student_requirement_statuses
      WHERE submission_id = $1`,
    [submission.rows[0]?.id || 0]
  );
  const reviewHistories = await client.query(
    `SELECT document_type_id, status, action, feedback, original_name,
            cloudinary_url, details, actor_id, created_at
       FROM student_requirement_status_history
      WHERE submission_id = $1
      ORDER BY created_at DESC, id DESC`,
    [submission.rows[0]?.id || 0]
  );
  const reviewStateByTypeId = new Map(
    reviewStates.rows.map((row) => [Number(row.document_type_id), row])
  );
  const reviewHistoryByTypeId = new Map();
  reviewHistories.rows.forEach((row) => {
    const typeId = Number(row.document_type_id);
    if (!reviewHistoryByTypeId.has(typeId)) reviewHistoryByTypeId.set(typeId, []);
    reviewHistoryByTypeId.get(typeId).push(row);
  });
  const requirementStatusesWithReview = requirementStatuses.map((status) => {
    const reviewState = reviewStateByTypeId.get(Number(status.id));
    const requirementStatus = reviewState?.status || (status.completed ? 'PENDING' : null);
    return {
      ...status,
      requirement_status: requirementStatus,
      can_upload: status.input_type === 'file' && canStudentUploadRequirementFile(
        submission.rows[0]?.status,
        requirementStatus,
        status.completed
      ),
      requirement_feedback: reviewState?.feedback || null,
      requirement_updated_at: reviewState?.updated_at || null,
      review_history: reviewHistoryByTypeId.get(Number(status.id)) || [],
    };
  });

  // The coordinator's "Needs Revision" checklist, resolved to names so the
  // student page can list what to change without a second request. Legacy rows
  // have no list, hence the empty array.
  const submissionRow = submission.rows[0] || null;
  let revisionDocuments = [];
  const revisionIds = Array.isArray(submissionRow?.revision_document_ids)
    ? submissionRow.revision_document_ids.map(Number).filter(Number.isFinite)
    : [];
  if (revisionIds.length > 0) {
    const revisionDocs = await client.query(
      `SELECT id, name, section, code FROM document_types
        WHERE id = ANY($1::int[])
        ORDER BY sort_order, name`,
      [revisionIds]
    );
    revisionDocuments = revisionDocs.rows;
  }

  return {
    student: student.rows[0] || null,
    submission: submissionRow,
    documents: documents.rows,
    logs: logs.rows,
    revisionDocuments,
    ...progress,
    requirementStatuses: requirementStatusesWithReview,
  };
};

module.exports = {
  getOrCreateStudent,
  getOrCreateSubmission,
  ensureDefaultGradeLevel,
  getActiveDocumentTypes,
  buildRequirementStatuses,
  missingRequirementCodes,
  describeOutstanding,
  calculateProgress,
  recalculateAllProgress,
  serializeRequirements,
  ensureRevisionDocumentColumn,
  ensureFormRequirementVerificationTable,
  ensureRequirementReviewSchema,
};
