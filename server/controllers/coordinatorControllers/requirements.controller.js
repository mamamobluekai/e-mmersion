const pool = require('../../db/');
const cloudinary = require('../../db/cloudinary');
const { normalize, validateStudentPayload } = require('./regexes/validation');
const {
  getOrCreateStudent,
  getOrCreateSubmission,
  calculateProgress,
  recalculateAllProgress,
  serializeRequirements,
  ensureRevisionDocumentColumn,
  ensureDefaultGradeLevel,
  getActiveDocumentTypes,
  buildRequirementStatuses,
  missingRequirementCodes,
  describeOutstanding,
} = require('./regexes/requirementsHelpers');
const { ensureDocumentTypesSchema } = require('./regexes/documentTypeSchema');
const streamifier = require('streamifier');

const upsertRequirements = async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validateStudentPayload(req.body, req.method === 'PUT');
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please review highlighted fields.', errors });

    await client.query('BEGIN');
    const userId = req.user.role === 'student' ? req.user.id : req.body.user_id;
    const student = await getOrCreateStudent(client, userId, req.body);
    await getOrCreateSubmission(client, student, userId);

    const fields = [
      'student_number','first_name','middle_name','last_name','suffix','gender','birthdate','age',
      'contact_number','email','home_address','grade_level','section','track_strand','school',
      'preferred_industry','preferred_company','career_goal','industry_reason','guardian_name',
      'guardian_relationship','guardian_contact','guardian_email','guardian_address',
      'emergency_contact','emergency_contact_number','academic_notes',
    ];
    const updates = fields.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
    if (updates.length) {
      const setSql = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
      await client.query(
        `UPDATE students SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = $${updates.length + 1}`,
        [...updates.map((field) => normalize(req.body[field]) || null), student.id]
      );
    }

    // Grade Level is fixed at Grade 12, so it is filled in here rather than
    // asked for in the form.
    await ensureDefaultGradeLevel(client, student.id);

    const data = await serializeRequirements(client, student.id);
    await client.query('COMMIT');
    res.json({ message: 'Requirements saved automatically.', ...data });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('upsertRequirements error:', err);
    res.status(500).json({ error: err.message || 'Server error.' });
  } finally {
    client.release();
  }
};

const submitRequirements = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureRevisionDocumentColumn();
    await client.query('BEGIN');
    const student = await getOrCreateStudent(client, req.user.id, req.body);
    const submission = await getOrCreateSubmission(client, student, req.user.id);
    const data = await serializeRequirements(client, student.id);

    if (data.progress < 100) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: describeOutstanding(data.requirementStatuses),
        missingDocuments: data.missingDocuments,
      });
    }

    await client.query(
      `UPDATE student_requirement_submissions
       SET status = 'Pending', submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           revision_document_ids = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [submission.id]
    );
    await client.query(
      `INSERT INTO submission_logs (submission_id, actor_id, action, remarks) VALUES ($1,$2,'Submitted','Requirements submitted successfully.')`,
      [submission.id, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Requirements submitted successfully.', status: 'Pending' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('submitRequirements error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const getRequirements = async (req, res) => {
  const client = await pool.connect();
  try {
    const studentIdParam = req.params.studentId;
    let student;
    if (studentIdParam === 'me' || req.user.role === 'student') {
      student = await getOrCreateStudent(client, req.user.id, {});
    } else {
      const result = await client.query(
        `SELECT * FROM students WHERE id::text = $1 OR student_number = $1 OR user_id::text = $1 LIMIT 1`,
        [studentIdParam]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Student requirements not found.' });
      student = result.rows[0];
    }
    await getOrCreateSubmission(client, student, student.user_id);
    res.json(await serializeRequirements(client, student.id));
  } catch (err) {
    console.error('getRequirements error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

function uploadToCloudinary(buffer, resourceType) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: 'student_documents' },
      (err, result) => err ? reject(err) : resolve(result)
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

const uploadDocument = async (req, res) => {
  const client = await pool.connect();
  try {
    const { document_code } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Please choose a file to upload.' });
    if (!document_code) return res.status(400).json({ error: 'Document type is required.' });

    await client.query('BEGIN');
    const student = await getOrCreateStudent(client, req.user.id, {});
    const submission = await getOrCreateSubmission(client, student, req.user.id);
    const type = await client.query('SELECT * FROM document_types WHERE code = $1', [document_code]);
    if (!type.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid document type.' });
    }

    await client.query(
      `DELETE FROM student_documents WHERE student_id = $1 AND document_type_id = $2`,
      [student.id, type.rows[0].id]
    );

    const resourceType = req.file.mimetype.startsWith('image/') ? 'image' : 'raw';
    const result = await uploadToCloudinary(req.file.buffer, resourceType);

    const inserted = await client.query(
      `INSERT INTO student_documents
       (submission_id, student_id, document_type_id, document_name, file_path, original_name, mime_type, file_size, cloudinary_public_id, cloudinary_url, resource_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Uploaded')
       RETURNING *`,
      [
        submission.id,
        student.id,
        type.rows[0].id,
        type.rows[0].name,
        result.secure_url,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        result.public_id,
        result.secure_url,
        resourceType,
      ]
    );
    await client.query(
      `INSERT INTO submission_logs (submission_id, actor_id, action, remarks) VALUES ($1,$2,'Uploaded document',$3)`,
      [submission.id, req.user.id, type.rows[0].name]
    );
    const progress = await calculateProgress(client, student.id);
    await client.query('COMMIT');
    res.status(201).json({ message: 'File uploaded successfully.', document: inserted.rows[0], ...progress });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('uploadDocument error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const deleteDocument = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM student_documents sd
       USING students s
       WHERE sd.id = $1 AND sd.student_id = s.id
         AND ($2::text <> 'student' OR s.user_id = $3)
       RETURNING sd.student_id`,
      [req.params.id, req.user.role, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Document not found.' });
    res.json({ message: 'Document deleted.' });
  } catch (err) {
    console.error('deleteDocument error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

/**
 * Which requirements each submission still lacks, resolved in one place so every
 * caller agrees: a file requirement needs an upload tied to the submission, a
 * form requirement (Personal Information, Guardian & Emergency) needs its
 * profile fields filled in. Returns the requirement statuses per submission.
 */
async function loadSubmissionRequirementState(client, submissions) {
  const activeTypes = await getActiveDocumentTypes(client);
  const bySubmission = new Map();

  const ids = submissions.map((row) => row.id).filter(Number.isInteger);
  const uploadedByType = new Map();
  if (ids.length > 0) {
    const uploads = await client.query(
      `SELECT DISTINCT submission_id, document_type_id
         FROM student_documents
        WHERE submission_id = ANY($1::int[])`,
      [ids]
    );

    uploads.rows.forEach((row) => {
      if (!uploadedByType.has(row.submission_id)) uploadedByType.set(row.submission_id, new Set());
      uploadedByType.get(row.submission_id).add(row.document_type_id);
    });
  }

  submissions.forEach((row) => {
    const statuses = buildRequirementStatuses(
      activeTypes,
      row.student || {},
      uploadedByType.get(row.id) || new Set()
    );
    const missing = missingRequirementCodes(statuses);
    const completed = statuses.length - missing.length;
    bySubmission.set(row.id, {
      statuses,
      missing_codes: missing,
      // The list column reads "uploaded/required"; a filled-in form counts as
      // delivered, so the figure reflects satisfied requirements rather than
      // file transfers alone.
      uploaded_documents: completed,
      completed_documents: completed,
      required_documents: statuses.length,
      missing_documents: missing.length,
    });
  });

  return bySubmission;
}

const listSubmissions = async (req, res) => {
  try {
    await ensureDocumentTypesSchema();
    const { status = null, search = null, strand = null } = req.query;
    const result = await pool.query(
      `SELECT s.*, st.student_number, st.first_name, st.last_name, st.email, st.grade_level, st.track_strand,
              -- Full student row, so form requirements (Personal Information,
              -- Guardian & Emergency) can be resolved against the profile.
              to_jsonb(st) AS student
         FROM student_requirement_submissions s
         JOIN students st ON st.id = s.student_id
         WHERE ($1::text IS NULL OR s.status = $1)
           AND ($2::text IS NULL OR LOWER(st.student_number || ' ' || st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.email,'') || ' ' || COALESCE(st.track_strand,'')) LIKE LOWER('%' || $2 || '%'))
           AND ($3::text IS NULL OR st.track_strand = $3)
         ORDER BY s.updated_at DESC`,
      [status === 'all' ? null : status, search || null, strand || null]
    );

    // Completeness is resolved here rather than in SQL because form
    // requirements are satisfied by columns on the student row instead of by an
    // uploaded file.
    const bySubmission = await loadSubmissionRequirementState(pool, result.rows);

    const submissions = result.rows.map((row) => {
      const { student, ...rest } = row;
      return { ...rest, ...(bySubmission.get(row.id) || {}) };
    });

    res.json({ submissions });
  } catch (err) {
    console.error('listSubmissions error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

/**
 * A submission may only be approved once every active requirement has been
 * satisfied - approving earlier is what lets an incomplete student through to
 * deployment. Returns the names of the requirements still missing, so the
 * caller can say exactly what is outstanding; an empty array means the
 * submission is complete. `null` means the submission itself was not found.
 */
async function findMissingRequirements(client, submissionId) {
  await ensureDocumentTypesSchema();
  const submissionRow = await client.query(
    `SELECT s.id, to_jsonb(st) AS student
       FROM student_requirement_submissions s
       JOIN students st ON st.id = s.student_id
      WHERE s.id = $1`,
    [submissionId]
  );
  if (!submissionRow.rows.length) return null;

  const activeTypes = await getActiveDocumentTypes(client);
  const uploads = await client.query(
    'SELECT DISTINCT document_type_id FROM student_documents WHERE submission_id = $1',
    [submissionId]
  );
  const uploadedTypeIds = new Set(uploads.rows.map((row) => row.document_type_id));
  const statuses = buildRequirementStatuses(activeTypes, submissionRow.rows[0].student || {}, uploadedTypeIds);

  return statuses.filter((status) => !status.completed).map((status) => status.name);
}

/**
 * Validate the "Needs Revision" checklist the coordinator ticked: the ids must
 * be real document types. Returns the cleaned id array, or `null` when the
 * payload is unusable (the caller turns that into a 400).
 */
async function normalizeRevisionDocumentIds(rawIds) {
  if (rawIds === undefined || rawIds === null) return [];
  if (!Array.isArray(rawIds)) return null;

  const ids = Array.from(
    new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
  );
  if (ids.length === 0) return [];

  await ensureDocumentTypesSchema();
  const existing = await pool.query(
    'SELECT id FROM document_types WHERE id = ANY($1::int[])',
    [ids]
  );
  if (existing.rows.length !== ids.length) return null;
  return ids;
}

const reviewSubmission = async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, remarks, revision_document_ids } = req.body;
    const allowed = ['Pending', 'Needs Revision', 'Approved', 'Hold'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid review status.' });

    await ensureRevisionDocumentColumn();

    const currentRow = await client.query(
      'SELECT status FROM student_requirement_submissions WHERE id = $1',
      [req.params.id]
    );
    if (!currentRow.rows.length) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    // An approval is settled: the only move left is Hold, for when something
    // turns up after the fact (a file found to be malicious, say). Sending a
    // student back to Pending or Needs Revision would rewrite the approval
    // instead of recording that it was later put on hold.
    if (currentRow.rows[0].status === 'Approved' && !['Approved', 'Hold'].includes(status)) {
      return res.status(400).json({
        error: 'An approved submission can only stay approved or be put on hold.',
      });
    }

    // Hold is a pause on an approval, not a review outcome in its own right, so
    // it cannot be applied to a submission that was never approved.
    if (status === 'Hold' && currentRow.rows[0].status !== 'Approved') {
      return res.status(400).json({
        error: 'Only an approved submission can be put on hold.',
      });
    }

    // Approving certifies the student's requirements are complete, so it is
    // refused while anything is still missing.
    if (status === 'Approved') {
      const missing = await findMissingRequirements(client, req.params.id);
      if (missing === null) {
        return res.status(404).json({ error: 'Submission not found.' });
      }
      if (missing.length > 0) {
        return res.status(400).json({
          error: `This student cannot be approved yet. Still missing: ${missing.join(', ')}.`,
          missing,
        });
      }
    }

    // "Needs Revision" only means something if the coordinator says which
    // documents have to change, so the checklist is required for that status and
    // dropped for every other one.
    let revisionIds = [];
    if (status === 'Needs Revision') {
      const normalized = await normalizeRevisionDocumentIds(revision_document_ids);
      if (normalized === null) {
        return res.status(400).json({ error: 'One or more selected requirements do not exist.' });
      }
      if (normalized.length === 0) {
        return res.status(400).json({
          error: 'Select at least one document that the student has to revise.',
        });
      }
      revisionIds = normalized;
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE student_requirement_submissions
       SET status = $1, coordinator_feedback = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP,
           revision_document_ids = $5::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [
        status,
        remarks || null,
        req.user.id,
        req.params.id,
        revisionIds.length > 0 ? JSON.stringify(revisionIds) : null,
      ]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Submission not found.' });
    }
    await client.query(
      `INSERT INTO submission_logs (submission_id, actor_id, action, remarks) VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.user.id, status, remarks || null]
    );
    await client.query('COMMIT');
    res.json({ message: 'Submission updated.', submission: result.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('reviewSubmission error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const bulkReviewSubmissions = async (req, res) => {
  const { submission_ids, status, remarks } = req.body;
  const allowed = ['Pending', 'Needs Revision', 'Approved', 'Hold'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid review status.' });
  if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
    return res.status(400).json({ error: 'No submission IDs provided.' });
  }

  const client = await pool.connect();
  try {
    // Same rule as a single review: an approved submission may only be moved to
    // Hold, never back to Pending or Needs Revision.
    if (!['Approved', 'Hold'].includes(status)) {
      const approvedRows = await client.query(
        `SELECT id FROM student_requirement_submissions
          WHERE id = ANY($1) AND status = 'Approved'`,
        [submission_ids]
      );
      if (approvedRows.rows.length > 0) {
        return res.status(400).json({
          error: `${approvedRows.rows.length} selected submission(s) are already approved and can only be put on hold.`,
        });
      }
    }

    // Hold only pauses an approval, so a bulk hold needs every selected
    // submission to be approved already.
    if (status === 'Hold') {
      const approvedRows = await client.query(
        `SELECT id FROM student_requirement_submissions
          WHERE id = ANY($1) AND status = 'Approved'`,
        [submission_ids]
      );
      if (approvedRows.rows.length !== submission_ids.length) {
        return res.status(400).json({
          error: 'Only approved submissions can be put on hold.',
        });
      }
    }

    // Bulk approval gets the same completeness rule as a single approval: the
    // whole batch is refused and the blockers are named, so nothing incomplete
    // slips through while the coordinator works down a long list.
    if (status === 'Approved') {
      const blockers = [];
      for (const id of submission_ids) {
        const missing = await findMissingRequirements(client, id);
        if (missing === null) continue;
        if (missing.length > 0) {
          const row = await client.query(
            `SELECT st.first_name, st.last_name, st.student_number
               FROM student_requirement_submissions srs
               JOIN students st ON st.id = srs.student_id
              WHERE srs.id = $1`,
            [id]
          );
          const student = row.rows[0];
          const name = student
            ? [student.first_name, student.last_name].filter(Boolean).join(' ') ||
              student.student_number
            : `Submission ${id}`;
          blockers.push(`${name} (${missing.length} missing)`);
        }
      }
      if (blockers.length > 0) {
        return res.status(400).json({
          error: `These students cannot be approved because their requirements are not complete yet: ${blockers.join(', ')}.`,
          blockers,
        });
      }
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE student_requirement_submissions
       SET status = $1, coordinator_feedback = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($4) RETURNING id`,
      [status, remarks || null, req.user.id, submission_ids],
    );
    if (result.rows.length) {
      // One log row per reviewed submission, tied to the submission the update
      // actually touched (not merely every id the caller sent).
      await client.query(
        `INSERT INTO submission_logs (submission_id, actor_id, action, remarks)
         SELECT id, $2, $3, $4 FROM student_requirement_submissions WHERE id = ANY($1)`,
        [result.rows.map((r) => r.id), req.user.id, status, remarks || null],
      );
    }
    await client.query('COMMIT');
    res.json({
      message: `${result.rows.length} submission(s) marked ${status.toLowerCase()}.`,
      updated: result.rows.length,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('bulkReviewSubmissions error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const verifyDocument = async (req, res) => {
  try {
    const { status, remarks } = req.body;
    if (!['Verified', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid document status.' });
    const result = await pool.query(
      `UPDATE student_documents
       SET status = $1, remarks = $2, verified_by = $3, verified_date = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [status, remarks || null, req.user.id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Document not found.' });
    res.json({ message: 'Document reviewed.', document: result.rows[0] });
  } catch (err) {
    console.error('verifyDocument error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};


/* ---------------- Document Types (Editable Requirements) ---------------- */

const listDocumentTypes = async (req, res) => {
  try {
    await ensureDocumentTypesSchema();
    const { all } = req.query;
    const isCoordOrAdmin = ['coordinator', 'admin'].includes(req.user?.role);
    const showAll = isCoordOrAdmin && (all === 'true' || all === '1');
    // `input_type` tells the client whether a requirement is satisfied by an
    // upload ('file') or by filling in the student's own information ('form').
    const query = showAll
      ? `SELECT id, code, name, section, is_active, sort_order, description, input_type
         FROM document_types
         ORDER BY sort_order, id`
      : `SELECT id, code, name, section, is_active, sort_order, description, input_type
         FROM document_types
         WHERE is_active = TRUE
         ORDER BY sort_order, id`;
    const result = await pool.query(query);
    res.json({ documentTypes: result.rows });
  } catch (err) {
    console.error('listDocumentTypes error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const createDocumentType = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDocumentTypesSchema();
    const { name, section = 'academic', description = '' } = req.body || {};
    const cleanName = (name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Requirement name is required.' });

    const allowedSections = ['personal', 'guardian', 'medical', 'academic'];
    const cleanSection = allowedSections.includes(section) ? section : 'academic';

    let baseCode = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'requirement';

    let code = baseCode;
    let counter = 1;
    while (true) {
      const existing = await client.query('SELECT id FROM document_types WHERE code = $1', [code]);
      if (!existing.rows.length) break;
      counter += 1;
      code = `${baseCode}_${counter}`;
    }

    const orderRes = await client.query('SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM document_types');
    const nextOrder = orderRes.rows[0].next_order;

    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO document_types (code, name, section, is_active, sort_order, description)
       VALUES ($1, $2, $3, TRUE, $4, $5)
       RETURNING id, code, name, section, is_active, sort_order, description, input_type`,
      [code, cleanName, cleanSection, nextOrder, description || null]
    );

    await recalculateAllProgress(client);
    await client.query('COMMIT');

    res.status(201).json({ message: 'Requirement created.', documentType: inserted.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('createDocumentType error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const updateDocumentType = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDocumentTypesSchema();
    const { id } = req.params;
    const { name, section, description, sort_order, is_active } = req.body || {};

    const cleanName = typeof name === 'string' ? name.trim() : null;
    if (cleanName === '') return res.status(400).json({ error: 'Requirement name cannot be empty.' });

    const allowedSections = ['personal', 'guardian', 'medical', 'academic'];
    const cleanSection = section && allowedSections.includes(section) ? section : null;

    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM document_types WHERE id = $1', [id]);
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Requirement not found.' });
    }

    const updated = await client.query(
      `UPDATE document_types
       SET name = COALESCE($1, name),
           section = COALESCE($2, section),
           description = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE description END,
           sort_order = COALESCE($4, sort_order),
           is_active = COALESCE($5, is_active)
       WHERE id = $6
       RETURNING id, code, name, section, is_active, sort_order, description, input_type`,
      [
        cleanName,
        cleanSection,
        description !== undefined ? description : null,
        typeof sort_order === 'number' ? sort_order : null,
        typeof is_active === 'boolean' ? is_active : null,
        id,
      ]
    );

    await recalculateAllProgress(client);
    await client.query('COMMIT');

    res.json({ message: 'Requirement updated.', documentType: updated.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('updateDocumentType error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const deleteDocumentType = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDocumentTypesSchema();
    const { id } = req.params;

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE document_types
       SET is_active = FALSE
       WHERE id = $1
       RETURNING id, code, name, section, is_active, sort_order, input_type`,
      [id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Requirement not found.' });
    }

    await recalculateAllProgress(client);
    await client.query('COMMIT');

    res.json({ message: 'Requirement removed.', documentType: result.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('deleteDocumentType error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

// Restore a removed requirement (set is_active back to TRUE).
const restoreDocumentType = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDocumentTypesSchema();
    const { id } = req.params;

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE document_types
       SET is_active = TRUE
       WHERE id = $1
       RETURNING id, code, name, section, is_active, sort_order, input_type`,
      [id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Requirement not found.' });
    }

    await recalculateAllProgress(client);
    await client.query('COMMIT');

    res.json({ message: 'Requirement restored.', documentType: result.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('restoreDocumentType error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

// Permanently delete a removed requirement from the database.
const permanentDeleteDocumentType = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDocumentTypesSchema();
    const { id } = req.params;

    await client.query('BEGIN');
    const result = await client.query(
      `DELETE FROM document_types WHERE id = $1
       RETURNING id, code, name, section`,
      [id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Requirement not found.' });
    }

    await recalculateAllProgress(client);
    await client.query('COMMIT');

    res.json({ message: 'Requirement permanently deleted.', documentType: result.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('permanentDeleteDocumentType error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

module.exports = {
  upsertRequirements,
  submitRequirements,
  getRequirements,
  uploadDocument,
  deleteDocument,
  listSubmissions,
  reviewSubmission,
  bulkReviewSubmissions,
  verifyDocument,
  listDocumentTypes,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  restoreDocumentType,
  permanentDeleteDocumentType,
};
