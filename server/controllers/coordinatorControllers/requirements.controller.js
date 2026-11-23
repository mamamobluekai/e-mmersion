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
  ensureFormRequirementVerificationTable,
  ensureRequirementReviewSchema,
  ensureDefaultGradeLevel,
  getActiveDocumentTypes,
  buildRequirementStatuses,
  missingRequirementCodes,
  describeOutstanding,
} = require('./regexes/requirementsHelpers');
const { ensureDocumentTypesSchema } = require('./regexes/documentTypeSchema');
const { formFieldsFor } = require('./regexes/formRequirements');
const { isStudentRequirementImage } = require('./requirementsFilePolicy');
const mailer = require('../../utils/mailer');
const {
  editableRequirementsPayload,
  isMissingRequirementFile,
  canStudentUploadRequirementFile,
  studentSubmissionBlockMessage,
  reviewStatusTransitionError,
} = require('./requirementsSubmissionPolicy');
const streamifier = require('streamifier');

const lockSubmissionStatus = async (client, submissionId) => {
  const result = await client.query(
    'SELECT status FROM student_requirement_submissions WHERE id = $1 FOR UPDATE',
    [submissionId]
  );
  if (!result.rows.length) {
    throw new Error('Student requirement submission was not found after creation.');
  }
  return result.rows[0].status;
};

const getStudentSubmissionBlockMessage = async (client, role, submissionId) => {
  if (role !== 'student') return null;
  return studentSubmissionBlockMessage(await lockSubmissionStatus(client, submissionId));
};

const recordRequirementStatus = async (client, {
  submissionId,
  documentTypeId,
  documentId = null,
  status,
  action,
  feedback = null,
  originalName = null,
  cloudinaryUrl = null,
  details = null,
  actorId = null,
}) => {
  await client.query(
    `INSERT INTO student_requirement_statuses
       (submission_id, document_type_id, status, feedback, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (submission_id, document_type_id)
     DO UPDATE SET status = EXCLUDED.status,
                   feedback = EXCLUDED.feedback,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = CURRENT_TIMESTAMP`,
    [submissionId, documentTypeId, status, feedback, actorId]
  );
  await client.query(
    `INSERT INTO student_requirement_status_history
       (submission_id, document_type_id, document_id, status, action, feedback,
        original_name, cloudinary_url, details, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      submissionId,
      documentTypeId,
      documentId,
      status,
      action,
      feedback,
      originalName,
      cloudinaryUrl,
      details ? JSON.stringify(details) : null,
      actorId,
    ]
  );
};

const refreshSubmissionReviewStatus = async (client, submissionId) => {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM student_requirement_statuses
      WHERE submission_id = $1 AND status = 'NEEDS REVISION'`,
    [submissionId]
  );
  const status = result.rows[0].count > 0 ? 'Needs Revision' : 'Pending';
  await client.query(
    `UPDATE student_requirement_submissions
        SET status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status NOT IN ('Approved', 'Hold')`,
    [submissionId, status]
  );
};

const sendStudentRequirementsEmail = async ({
  student,
  subject,
  title,
  message,
  feedback = '',
}) => {
  const to = String(student?.notification_email || student?.email || '').trim();
  const studentLabel = student?.student_number || student?.id || 'unknown student';
  if (!to) {
    const reason = 'Student email address is unavailable.';
    console.error(`Requirements review email not sent for ${studentLabel}: ${reason}`);
    return { sent: false, reason };
  }

  const name = [student?.first_name, student?.last_name].filter(Boolean).join(' ') || 'Student';
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const requirementsUrl = `${clientUrl}/dashboard/student/requirements`;
  const cleanFeedback = String(feedback || '').trim();
  const escapedName = mailer.escapeHtml(name);
  const escapedTitle = mailer.escapeHtml(title);
  const escapedMessage = mailer.escapeHtml(message);
  const escapedFeedback = mailer.escapeHtml(cleanFeedback);
  const escapedUrl = mailer.escapeHtml(requirementsUrl);
  const feedbackHtml = cleanFeedback
    ? `<p style="white-space:pre-wrap;"><strong>Coordinator feedback:</strong> ${escapedFeedback}</p>`
    : '';
  const feedbackText = cleanFeedback ? `\n\nCoordinator feedback:\n${cleanFeedback}` : '';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#26313f;line-height:1.6;">
      <h2 style="color:#8b1e2d;">${escapedTitle}</h2>
      <p>Hello ${escapedName},</p>
      <p>${escapedMessage}</p>
      ${feedbackHtml}
      <p><a href="${escapedUrl}" style="color:#8b1e2d;font-weight:bold;">Open your requirements</a></p>
      <p style="color:#667085;font-size:12px;">Marinduque National High School - Work Immersion Office</p>
    </div>
  `;
  const text = `Hello ${name},\n\n${message}${feedbackText}\n\nOpen your requirements: ${requirementsUrl}\n\nMarinduque National High School - Work Immersion Office`;

  try {
    const result = await mailer.sendMail({ to, subject, html, text });
    if (!result.sent) {
      console.error(`Requirements review email to ${to} failed: ${result.reason}`);
    }
    return result;
  } catch (err) {
    const reason = err.message || 'Unexpected email provider error.';
    console.error(`Requirements review email to ${to} failed: ${reason}`);
    return { sent: false, reason };
  }
};

const sendRequirementDecisionEmail = (student, requirementName, status, feedback) => {
  const name = requirementName || 'Your requirement';
  const needsRevision = status === 'NEEDS REVISION';
  return sendStudentRequirementsEmail({
    student,
    subject: needsRevision
      ? 'Action Required: Requirement Needs Revision'
      : 'Requirement Approved',
    title: needsRevision ? 'Requirement Needs Revision' : 'Requirement Approved',
    message: needsRevision
      ? `Your requirement "${name}" was reviewed and needs revision. Please sign in to review the coordinator feedback and submit a corrected version.`
      : `Your requirement "${name}" has been approved by your coordinator.`,
    feedback,
  });
};

const sendSubmissionApprovalEmail = (student, feedback) =>
  sendStudentRequirementsEmail({
    student,
    subject: 'Congratulations! Your Work Immersion Requirements Are Approved',
    title: 'Congratulations! Your Requirements Are Approved',
    message: 'Your complete Work Immersion requirements submission has been approved by your coordinator.',
    feedback,
  });

const summarizeEmailNotification = (result) => ({
  sent: result.sent,
  message: result.sent
    ? 'Student notification email sent.'
    : 'Review was saved, but the student notification email could not be sent. Check the server mail logs.',
});

async function availablePartnerPreference(client, value) {
  if (value == null || normalize(value) === '') return true;
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const id = String(value).trim();
  if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) return false;
  return (await client.query('SELECT 1 FROM partner_institutions WHERE id = $1 AND is_active FOR SHARE', [id])).rowCount > 0;
}

const upsertRequirements = async (req, res) => {
  const client = await pool.connect();
  try {
    const payload = editableRequirementsPayload(req.user.role, req.body || {});
    const errors = validateStudentPayload(payload, req.method === 'PUT');
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please review highlighted fields.', errors });

    await client.query('BEGIN');
    const userId = req.user.role === 'student' ? req.user.id : payload.user_id;
    const student = await getOrCreateStudent(client, userId, payload);
    const submission = await getOrCreateSubmission(client, student, userId);
    const blockMessage = await getStudentSubmissionBlockMessage(client, req.user.role, submission.id);
    if (blockMessage) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: blockMessage });
    }
    await ensureRequirementReviewSchema();

    const fields = [
      'student_number','first_name','middle_name','last_name','suffix','gender','birthdate','age',
      'has_special_needs',
      'contact_number','email','home_address','grade_level','section','track_strand','school',
      'preferred_industry','preferred_company','career_goal','industry_reason','guardian_name',
      'preferred_partner_institution_id',
      'guardian_relationship','guardian_contact','guardian_email','guardian_address',
      'emergency_contact','emergency_contact_number','academic_notes',
    ];
    const updates = fields.filter((field) => (
      Object.prototype.hasOwnProperty.call(payload, field) &&
      String(normalize(payload[field]) || '') !== String(normalize(student[field]) || '')
    ));
    if (updates.includes('preferred_partner_institution_id') &&
      !await availablePartnerPreference(client, payload.preferred_partner_institution_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose an available preferred partner institution.' });
    }
    let changedFormCodes = [];
    if (req.user.role === 'student' && submission.submitted_at && updates.length) {
      const formCodes = ['personal_information', 'guardian_emergency'];
      const formTypes = await client.query(
        `SELECT dt.id, dt.code, states.status
           FROM document_types dt
           LEFT JOIN student_requirement_statuses states
             ON states.document_type_id = dt.id AND states.submission_id = $1
          WHERE dt.code = ANY($2::text[])`,
        [submission.id, formCodes]
      );
      const legacyRevisionIds = Array.isArray(submission.revision_document_ids)
        ? submission.revision_document_ids.map(Number)
        : [];
      const editableFormCodes = new Set(
        formTypes.rows
          .filter((type) => (
            type.status === 'NEEDS REVISION' || legacyRevisionIds.includes(Number(type.id))
          ))
          .map((type) => type.code)
      );
      const belongsToForm = (code, field) => formFieldsFor(code).some((entry) => entry.key === field) ||
        (code === 'personal_information' && field === 'preferred_partner_institution_id');
      const blockedFields = updates.filter((field) => !formCodes.some((code) =>
        editableFormCodes.has(code) && belongsToForm(code, field)));
      if (blockedFields.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Only form requirements marked Needs Revision can be edited.',
          blockedFields,
        });
      }
      changedFormCodes = formCodes.filter((code) => (
        editableFormCodes.has(code) && updates.some((field) => belongsToForm(code, field))
      ));
    }

    if (updates.length) {
      const setSql = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
      await client.query(
        `UPDATE students SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = $${updates.length + 1}`,
        [...updates.map((field) => (
          typeof payload[field] === 'boolean' ? payload[field] : normalize(payload[field]) || null
        )), student.id]
      );

      if (changedFormCodes.length) {
        await ensureFormRequirementVerificationTable();
        await client.query(
          `DELETE FROM student_form_requirement_verifications
            WHERE submission_id = $1
              AND document_type_id IN (
                SELECT id FROM document_types WHERE code = ANY($2::text[])
              )`,
          [submission.id, changedFormCodes]
        );
        const formTypes = await client.query(
          `SELECT id, code FROM document_types WHERE code = ANY($1::text[])`,
          [changedFormCodes]
        );
        const updatedStudent = { ...student, ...Object.fromEntries(
          updates.map((field) => [
            field,
            typeof payload[field] === 'boolean' ? payload[field] : normalize(payload[field]) || null,
          ])
        ) };
        for (const type of formTypes.rows) {
          const details = Object.fromEntries(
            formFieldsFor(type.code).map(({ key }) => [key, updatedStudent[key] ?? null])
          );
          await recordRequirementStatus(client, {
            submissionId: submission.id,
            documentTypeId: type.id,
            status: 'RESUBMITTED - AWAITING REVIEW',
            action: 'RESUBMITTED',
            details,
            actorId: req.user.id,
          });
        }
        await refreshSubmissionReviewStatus(client, submission.id);
      }
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
    const payload = editableRequirementsPayload(req.user.role, req.body || {});
    const student = await getOrCreateStudent(client, req.user.id, payload);
    const submission = await getOrCreateSubmission(client, student, req.user.id);
    const blockMessage = await getStudentSubmissionBlockMessage(client, req.user.role, submission.id);
    if (blockMessage) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: blockMessage });
    }
    if (req.user.role === 'student' && submission.submitted_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'This submission is already filed. Resubmit only requirements marked Needs Revision.',
      });
    }
    await ensureRequirementReviewSchema();

    const data = await serializeRequirements(client, student.id);

    if (data.progress < 100) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: describeOutstanding(data.requirementStatuses),
        missingDocuments: data.missingDocuments,
      });
    }

    for (const requirement of data.requirementStatuses.filter(
      (status) => status.input_type === 'form' && status.completed
    )) {
      const state = await client.query(
        `SELECT status FROM student_requirement_statuses
          WHERE submission_id = $1 AND document_type_id = $2`,
        [submission.id, requirement.id]
      );
      if (state.rows.length === 0) {
        const details = Object.fromEntries(
          (requirement.fields || []).map(({ key }) => [key, data.student?.[key] ?? null])
        );
        await recordRequirementStatus(client, {
          submissionId: submission.id,
          documentTypeId: requirement.id,
          status: 'PENDING',
          action: 'SUBMITTED',
          details,
          actorId: req.user.id,
        });
      }
    }

    await client.query(
      `UPDATE student_requirement_submissions
       SET status = 'Pending', submitted_at = CURRENT_TIMESTAMP,
           revision_document_ids = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [submission.id]
    );
    await client.query(
      `INSERT INTO submission_logs (submission_id, actor_id, action, remarks) VALUES ($1,$2,'Submitted','Requirements submitted successfully.')`,
      [submission.id, req.user.id]
    );
    const updatedData = await serializeRequirements(client, student.id);
    await client.query('COMMIT');
    res.json({
      message: 'Requirements submitted successfully.',
      status: 'Pending',
      ...updatedData,
    });
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
    const data = await serializeRequirements(client, student.id);
    if (req.user.role === 'student') {
      const { rows } = await client.query(`SELECT id, name, is_active FROM partner_institutions
        WHERE is_active OR id = $1 ORDER BY name, id`, [student.preferred_partner_institution_id ?? null]);
      data.partnerInstitutions = rows;
    }
    res.json(data);
  } catch (err) {
    console.error('getRequirements error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const updatePartnerPreference = async (req, res) => {
  if (!Object.hasOwn(req.body || {}, 'preferred_partner_institution_id')) {
    return res.status(400).json({ error: 'Provide a partner preference.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const student = await getOrCreateStudent(client, req.user.id, {});
    const value = normalize(req.body.preferred_partner_institution_id);
    const unchanged = value === student.preferred_partner_institution_id ||
      (typeof value === 'string' && value === String(student.preferred_partner_institution_id ?? ''));
    if (!unchanged && !await availablePartnerPreference(client, value)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose an available preferred partner institution.' });
    }
    const { rows: [updated] } = await client.query(`UPDATE students SET preferred_partner_institution_id = $2, updated_at = now()
      WHERE id = $1 RETURNING preferred_partner_institution_id`, [student.id, value === '' ? null : value]);
    await client.query('COMMIT');
    return res.json(updated);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('updatePartnerPreference error:', error.message);
    return res.status(500).json({ error: 'Could not save your partner preference.' });
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
    if (req.user.role === 'student' && !isStudentRequirementImage(req.file)) {
      return res.status(400).json({ error: 'Only PNG and JPG image files can be uploaded.' });
    }

    await client.query('BEGIN');
    const student = await getOrCreateStudent(client, req.user.id, {});
    const submission = await getOrCreateSubmission(client, student, req.user.id);
    const isStudent = req.user.role === 'student';
    const submissionStatus = isStudent ? await lockSubmissionStatus(client, submission.id) : submission.status;
    await ensureDocumentTypesSchema();
    await ensureRequirementReviewSchema();

    const type = await client.query(
      `SELECT * FROM document_types
        WHERE code = $1 AND COALESCE(is_active, TRUE)`,
      [document_code]
    );
    if (!type.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid document type.' });
    }
    if (String(type.rows[0].input_type || 'file').toLowerCase() === 'form') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Form requirements cannot be uploaded as files.' });
    }

    const currentState = await client.query(
      `SELECT status
         FROM student_requirement_statuses
        WHERE submission_id = $1 AND document_type_id = $2
        FOR UPDATE`,
      [submission.id, type.rows[0].id]
    );
    const existingDocument = await client.query(
      `SELECT id
         FROM student_documents
        WHERE student_id = $1 AND document_type_id = $2
        ORDER BY uploaded_date DESC, id DESC
        LIMIT 1
        FOR UPDATE`,
      [student.id, type.rows[0].id]
    );
    const previousStatus = currentState.rows[0]?.status || null;
    const isResubmission = previousStatus === 'NEEDS REVISION';
    const hasDocument = existingDocument.rows.length > 0;
    const canUpload = isStudent
      ? canStudentUploadRequirementFile(submissionStatus, previousStatus, hasDocument)
      : isResubmission || (!previousStatus && !hasDocument && !submission.submitted_at);
    if (!canUpload) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: (isStudent && studentSubmissionBlockMessage(submissionStatus)) ||
          'Only a requirement marked Needs Revision can be replaced.',
      });
    }
    const reopened = isStudent && String(submissionStatus).trim().toLowerCase() === 'approved' &&
      isMissingRequirementFile(previousStatus, hasDocument);
    const requirementStatus = isResubmission
      ? 'RESUBMITTED - AWAITING REVIEW'
      : 'PENDING';

    const resourceType = req.file.mimetype.startsWith('image/') ? 'image' : 'raw';
    const result = await uploadToCloudinary(req.file.buffer, resourceType);

    await client.query(
      `DELETE FROM student_documents WHERE submission_id = $1 AND document_type_id = $2`,
      [submission.id, type.rows[0].id]
    );
    const inserted = await client.query(
      `INSERT INTO student_documents
       (submission_id, student_id, document_type_id, document_name, file_path, original_name, mime_type, file_size, cloudinary_public_id, cloudinary_url, resource_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        requirementStatus,
      ]
    );
    await recordRequirementStatus(client, {
      submissionId: submission.id,
      documentTypeId: type.rows[0].id,
      documentId: inserted.rows[0].id,
      status: requirementStatus,
      action: isResubmission ? 'RESUBMITTED' : 'UPLOADED',
      originalName: req.file.originalname,
      cloudinaryUrl: result.secure_url,
      actorId: req.user.id,
    });
    if (reopened) {
      await client.query(
        `UPDATE student_requirement_submissions
            SET status = 'Pending', submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
                reviewed_at = NULL, reviewed_by = NULL, coordinator_feedback = NULL
          WHERE id = $1`,
        [submission.id]
      );
    } else if (isResubmission) {
      await refreshSubmissionReviewStatus(client, submission.id);
    }
    await client.query(
      `INSERT INTO submission_logs (submission_id, actor_id, action, remarks) VALUES ($1,$2,'Uploaded document',$3)`,
      [submission.id, req.user.id, type.rows[0].name]
    );
    const data = await serializeRequirements(client, student.id);
    await client.query('COMMIT');
    res.status(201).json({
      message: reopened
        ? 'Missing requirement uploaded. Your coordinator can now review it.'
        : isResubmission
          ? 'Corrected requirement uploaded and resubmitted for review.'
          : 'File uploaded successfully.',
      document: inserted.rows[0],
      ...data,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('uploadDocument error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const deleteDocument = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const document = await client.query(
      `SELECT sd.id, sd.submission_id, sd.document_type_id, sd.original_name,
              sd.cloudinary_url, s.id AS student_id
         FROM student_documents sd
         JOIN students s ON s.id = sd.student_id
        WHERE sd.id = $1
          AND ($2::text <> 'student' OR s.user_id = $3)`,
      [req.params.id, req.user.role, req.user.id]
    );
    if (!document.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document not found.' });
    }

    let submissionId = document.rows[0].submission_id;
    if (!submissionId && req.user.role === 'student') {
      const submission = await getOrCreateSubmission(
        client,
        { id: document.rows[0].student_id },
        req.user.id
      );
      submissionId = submission.id;
    }

    const blockMessage = await getStudentSubmissionBlockMessage(
      client,
      req.user.role,
      submissionId
    );
    if (blockMessage) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: blockMessage });
    }
    await ensureRequirementReviewSchema();
    const requirementState = await client.query(
      `SELECT status
         FROM student_requirement_statuses
        WHERE submission_id = $1 AND document_type_id = $2
        FOR UPDATE`,
      [submissionId, document.rows[0].document_type_id]
    );
    if (
      req.user.role === 'student' &&
      requirementState.rows[0]?.status !== 'NEEDS REVISION'
    ) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Only a requirement marked Needs Revision can be removed.',
      });
    }

    const lockedDocument = await client.query(
      `SELECT sd.id
         FROM student_documents sd
         JOIN students s ON s.id = sd.student_id
        WHERE sd.id = $1
          AND ($2::text <> 'student' OR s.user_id = $3)
        FOR UPDATE OF sd`,
      [req.params.id, req.user.role, req.user.id]
    );
    if (!lockedDocument.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document not found.' });
    }

    if (requirementState.rows[0]) {
      await client.query(
        `INSERT INTO student_requirement_status_history
           (submission_id, document_type_id, document_id, status, action,
            original_name, cloudinary_url, actor_id)
         VALUES ($1, $2, $3, $4, 'FILE_REMOVED', $5, $6, $7)`,
        [
          submissionId,
          document.rows[0].document_type_id,
          document.rows[0].id,
          requirementState.rows[0].status,
          document.rows[0].original_name,
          document.rows[0].cloudinary_url,
          req.user.id,
        ]
      );
    }
    await client.query('DELETE FROM student_documents WHERE id = $1', [req.params.id]);
    const result = await serializeRequirements(client, document.rows[0].student_id);
    await client.query('COMMIT');
    res.json({ message: 'Document deleted.', ...result });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('deleteDocument error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
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

async function findUnapprovedRequirements(client, submissionId) {
  await ensureRequirementReviewSchema();
  const submission = await client.query(
    'SELECT id FROM student_requirement_submissions WHERE id = $1',
    [submissionId]
  );
  if (!submission.rows.length) return null;
  const activeTypes = await getActiveDocumentTypes(client);
  const result = await client.query(
    `SELECT document_type_id
       FROM student_requirement_statuses
      WHERE submission_id = $1 AND status = 'APPROVED'`,
    [submissionId]
  );
  const approvedIds = new Set(result.rows.map((row) => Number(row.document_type_id)));

  return activeTypes
    .filter((requirement) => !approvedIds.has(Number(requirement.id)))
    .map((requirement) => requirement.name);
}

const reviewSubmission = async (req, res) => {
  const client = await pool.connect();
  let clientReleased = false;
  try {
    const { status, remarks } = req.body;
    const allowed = ['Pending', 'Approved', 'Hold'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid review status.' });

    await ensureRevisionDocumentColumn();

    const currentRow = await client.query(
      `SELECT srs.status, srs.student_id, st.first_name, st.last_name,
              st.student_number,
              COALESCE(NULLIF(BTRIM(u.email), ''), NULLIF(BTRIM(st.email), '')) AS notification_email
         FROM student_requirement_submissions srs
         LEFT JOIN students st ON st.id = srs.student_id
         LEFT JOIN users u ON u.id = st.user_id
        WHERE srs.id = $1`,
      [req.params.id]
    );
    if (!currentRow.rows.length) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    const transitionError = reviewStatusTransitionError(currentRow.rows[0].status, status);
    if (transitionError) {
      return res.status(400).json({ error: transitionError });
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

      const unapproved = await findUnapprovedRequirements(client, req.params.id);
      if (unapproved === null) {
        return res.status(404).json({ error: 'Submission not found.' });
      }
      if (unapproved.length > 0) {
        return res.status(400).json({
          error: `This student cannot be approved until all requirements are individually approved: ${unapproved.join(', ')}.`,
          unapproved,
        });
      }
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE student_requirement_submissions
       SET status = $1, coordinator_feedback = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP,
           revision_document_ids = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [status, remarks || null, req.user.id, req.params.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Submission not found.' });
    }
    const action = String(currentRow.rows[0].status || '').toLowerCase() === 'hold' && status === 'Pending'
      ? 'Unheld'
      : status;
    await client.query(
      `INSERT INTO submission_logs (submission_id, actor_id, action, remarks) VALUES ($1,$2,$3,$4)`,
      [
        req.params.id,
        req.user.id,
        action,
        remarks || (action === 'Unheld' ? 'Submission unheld; student may update and resubmit requirements.' : null),
      ]
    );
    await client.query('COMMIT');
    client.release();
    clientReleased = true;
    const emailNotification =
      status === 'Approved' && currentRow.rows[0].status !== 'Approved'
        ? await sendSubmissionApprovalEmail(currentRow.rows[0], remarks)
        : null;
    res.json({
      message: 'Submission updated.',
      submission: result.rows[0],
      ...(emailNotification
        ? { emailNotification: summarizeEmailNotification(emailNotification) }
        : {}),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('reviewSubmission error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (!clientReleased) client.release();
  }
};

const bulkReviewSubmissions = async (req, res) => {
  const { submission_ids, status, remarks } = req.body;
  const allowed = ['Pending', 'Approved', 'Hold'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid review status.' });
  if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
    return res.status(400).json({ error: 'No submission IDs provided.' });
  }

  const client = await pool.connect();
  let clientReleased = false;
  try {
    // Approved submissions can only stay approved or be put on hold.
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

    const heldRows = await client.query(
      `SELECT id FROM student_requirement_submissions
        WHERE id = ANY($1) AND status = 'Hold'`,
      [submission_ids]
    );
    if (heldRows.rows.length > 0 && status !== 'Pending') {
      return res.status(400).json({
        error: 'Held submissions must be unheld to Pending before they can be reviewed again.',
      });
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
        const unapproved = await findUnapprovedRequirements(client, id);
        if (unapproved === null) continue;
        if (missing.length > 0 || unapproved.length > 0) {
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
          const reasons = [];
          if (missing.length) reasons.push(`${missing.length} missing`);
          if (unapproved.length) reasons.push(`${unapproved.length} not approved`);
          blockers.push(`${name} (${reasons.join(', ')})`);
        }
      }
      if (blockers.length > 0) {
        return res.status(400).json({
          error: `These students cannot be approved until every requirement is submitted and individually approved: ${blockers.join(', ')}.`,
          blockers,
        });
      }
    }

    await client.query('BEGIN');
    const previousApprovalStates = status === 'Approved'
      ? await client.query(
        `SELECT id, status
           FROM student_requirement_submissions
          WHERE id = ANY($1)
          FOR UPDATE`,
        [submission_ids]
      )
      : { rows: [] };
    const previouslyApprovedIds = new Set(
      previousApprovalStates.rows
        .filter((row) => row.status === 'Approved')
        .map((row) => row.id)
    );
    const result = await client.query(
      `UPDATE student_requirement_submissions
       SET status = $1, coordinator_feedback = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($4) RETURNING id`,
      [status, remarks || null, req.user.id, submission_ids],
    );
    const updatedIds = result.rows.map((row) => row.id);
    let approvalRecipients = [];
    if (result.rows.length) {
      const heldIdSet = new Set(heldRows.rows.map((row) => row.id));
      const unheldIds = status === 'Pending'
        ? updatedIds.filter((id) => heldIdSet.has(id))
        : [];
      const reviewedIds = updatedIds.filter((id) => !heldIdSet.has(id));

      if (reviewedIds.length) {
        await client.query(
          `INSERT INTO submission_logs (submission_id, actor_id, action, remarks)
           SELECT id, $2, $3, $4 FROM student_requirement_submissions WHERE id = ANY($1)`,
          [reviewedIds, req.user.id, status, remarks || null],
        );
      }
      if (unheldIds.length) {
        await client.query(
          `INSERT INTO submission_logs (submission_id, actor_id, action, remarks)
           SELECT id, $2, 'Unheld', $3 FROM student_requirement_submissions WHERE id = ANY($1)`,
          [
            unheldIds,
            req.user.id,
            remarks || 'Submission unheld; student may update and resubmit requirements.',
          ],
        );
      }

      const newlyApprovedIds = status === 'Approved'
        ? updatedIds.filter((id) => !previouslyApprovedIds.has(id))
        : [];
      if (newlyApprovedIds.length) {
        const recipients = await client.query(
          `SELECT st.first_name, st.last_name, st.student_number,
                  COALESCE(NULLIF(BTRIM(u.email), ''), NULLIF(BTRIM(st.email), '')) AS notification_email
             FROM student_requirement_submissions srs
             LEFT JOIN students st ON st.id = srs.student_id
             LEFT JOIN users u ON u.id = st.user_id
            WHERE srs.id = ANY($1)`,
          [newlyApprovedIds]
        );
        approvalRecipients = recipients.rows;
      }
    }
    await client.query('COMMIT');
    client.release();
    clientReleased = true;

    let emailNotification = null;
    if (approvalRecipients.length) {
      let sentCount = 0;
      for (const student of approvalRecipients) {
        const result = await sendSubmissionApprovalEmail(student, remarks);
        if (result.sent) sentCount += 1;
      }
      const failedCount = approvalRecipients.length - sentCount;
      emailNotification = {
        sent: failedCount === 0,
        sentCount,
        failedCount,
        message: failedCount
          ? `${failedCount} student notification email(s) could not be sent. Check the server mail logs.`
          : `Approval email sent to ${sentCount} student(s).`,
      };
    }

    res.json({
      message: `${result.rows.length} submission(s) updated.`,
      updated: result.rows.length,
      ...(emailNotification ? { emailNotification } : {}),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('bulkReviewSubmissions error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (!clientReleased) client.release();
  }
};

const reviewRequirement = async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  const documentTypeId = Number(req.params.documentTypeId);
  const { status, feedback } = req.body;
  if (!Number.isInteger(submissionId) || submissionId <= 0 ||
      !Number.isInteger(documentTypeId) || documentTypeId <= 0) {
    return res.status(400).json({ error: 'Invalid submission or requirement ID.' });
  }
  if (!['APPROVED', 'NEEDS REVISION'].includes(status)) {
    return res.status(400).json({ error: 'Choose Approve or Needs Revision.' });
  }

  const client = await pool.connect();
  let clientReleased = false;
  try {
    await ensureDocumentTypesSchema();
    await ensureRequirementReviewSchema();
    await client.query('BEGIN');
    const submission = await client.query(
      `SELECT id, student_id, status AS submission_status, submitted_at
         FROM student_requirement_submissions
        WHERE id = $1
        FOR UPDATE`,
      [submissionId]
    );
    if (!submission.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Submission not found.' });
    }
    if (['Approved', 'Hold'].includes(submission.rows[0].submission_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This submission is locked for requirement review.' });
    }
    if (!submission.rows[0].submitted_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The student has not submitted these requirements for review.' });
    }

    const typeResult = await client.query(
      `SELECT id, code, name, section, input_type, sort_order,
              COALESCE(is_active, TRUE) AS is_active
         FROM document_types
        WHERE id = $1`,
      [documentTypeId]
    );
    if (!typeResult.rows.length || !typeResult.rows[0].is_active) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Requirement not found.' });
    }
    const previousState = await client.query(
      `SELECT status
         FROM student_requirement_statuses
        WHERE submission_id = $1 AND document_type_id = $2
        FOR UPDATE`,
      [submissionId, documentTypeId]
    );
    const previousStatus = previousState.rows[0]?.status || null;
    if (
      previousStatus &&
      !['PENDING', 'RESUBMITTED - AWAITING REVIEW'].includes(previousStatus)
    ) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Only pending or resubmitted requirements can be reviewed.',
      });
    }

    const studentResult = await client.query(
      `SELECT st.*,
              COALESCE(NULLIF(BTRIM(u.email), ''), NULLIF(BTRIM(st.email), '')) AS notification_email
         FROM students st
         LEFT JOIN users u ON u.id = st.user_id
        WHERE st.id = $1`,
      [submission.rows[0].student_id]
    );
    if (!studentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }
    const requirement = buildRequirementStatuses(
      [typeResult.rows[0]],
      studentResult.rows[0],
      new Set()
    )[0];
    let document = null;
    if (requirement.input_type === 'form') {
      if (!requirement.completed) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Complete the form before reviewing it. Missing: ${requirement.missing_fields.join(', ')}.`,
        });
      }
    } else {
      const documentResult = await client.query(
        `SELECT id, original_name, cloudinary_url, status
           FROM student_documents
          WHERE submission_id = $1 AND document_type_id = $2
          ORDER BY uploaded_date DESC, id DESC
          LIMIT 1
          FOR UPDATE`,
        [submissionId, documentTypeId]
      );
      if (!documentResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Upload this requirement before reviewing it.' });
      }
      document = documentResult.rows[0];
    }
    const details = requirement.input_type === 'form'
      ? Object.fromEntries(
        (requirement.fields || []).map(({ key }) => [key, studentResult.rows[0][key] ?? null])
      )
      : null;

    await recordRequirementStatus(client, {
      submissionId,
      documentTypeId,
      documentId: document?.id || null,
      status,
      action: status,
      feedback: String(feedback || '').trim() || null,
      originalName: document?.original_name || null,
      cloudinaryUrl: document?.cloudinary_url || null,
      details,
      actorId: req.user.id,
    });
    if (document) {
      await client.query(
        `UPDATE student_documents
            SET status = $1, remarks = $2, verified_by = $3, verified_date = CURRENT_TIMESTAMP
          WHERE id = $4`,
        [status, String(feedback || '').trim() || null, req.user.id, document.id]
      );
    }
    await refreshSubmissionReviewStatus(client, submissionId);
    await client.query(
      `INSERT INTO submission_logs (submission_id, actor_id, action, remarks)
       VALUES ($1, $2, $3, $4)`,
      [
        submissionId,
        req.user.id,
        status === 'APPROVED' ? 'Requirement approved' : 'Requirement needs revision',
        feedback || requirement.name,
      ]
    );
    const data = await serializeRequirements(client, submission.rows[0].student_id);
    await client.query('COMMIT');
    client.release();
    clientReleased = true;
    const emailNotification = await sendRequirementDecisionEmail(
      studentResult.rows[0],
      requirement.name,
      status,
      feedback
    );
    res.json({
      message: status === 'APPROVED' ? 'Requirement approved.' : 'Requirement marked Needs Revision.',
      ...data,
      emailNotification: summarizeEmailNotification(emailNotification),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) {
      console.error('reviewRequirement rollback error:', rollbackErr);
    }
    console.error('reviewRequirement error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (!clientReleased) client.release();
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
  updatePartnerPreference,
  submitRequirements,
  getRequirements,
  uploadDocument,
  deleteDocument,
  listSubmissions,
  reviewSubmission,
  reviewRequirement,
  bulkReviewSubmissions,
  listDocumentTypes,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  restoreDocumentType,
  permanentDeleteDocumentType,
};
