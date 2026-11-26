const pool = require('../../db/');
const approvalLink = require('../../services/approvalLink.service');
const studentActivation = require('../../services/studentActivation.service');
const { NO_PASSWORD_SENTINEL } = require('../../utils/passwordPolicy');
const { ensureIntakeSchema, teacherReviewScope } = require('../../services/teacherStudentIntake.service');
const { ensureRequirementReviewSchema } = require('./regexes/requirementsHelpers');
const { ensureDocumentTypesSchema } = require('./regexes/documentTypeSchema');

const uploaderName = "COALESCE(NULLIF(trim(concat_ws(' ', uploader.first_name, uploader.last_name)), ''), uploader_account.email)";

function computeActivityStatus(user) {
  if (String(user.status || '').toLowerCase() === 'pending_activation') {
    return { status: 'pending', label: 'Pending Activation', daysSinceLogin: null };
  }

  // If user hasn't set password yet (still has sentinel), they're pending
  if (user.password === NO_PASSWORD_SENTINEL) {
    return { status: 'pending', label: 'Pending Activation', daysSinceLogin: null };
  }

  // If no last_login, they haven't logged in yet
  if (!user.last_login) {
    return { status: 'pending', label: 'Pending Accounts', daysSinceLogin: null };
  }

  const lastLogin = new Date(user.last_login);
  const now = new Date();
  const diffMs = now - lastLogin;
  const daysSinceLogin = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (daysSinceLogin <= 3) {
    return { status: 'active', label: 'Active', daysSinceLogin };
  } else if (daysSinceLogin <= 7) {
    return { status: 'idle', label: 'Idle', daysSinceLogin };
  } else if (daysSinceLogin <= 14) {
    return { status: 'inactive', label: 'Inactive', daysSinceLogin };
  } else {
    return { status: 'dormant', label: 'Dormant', daysSinceLogin };
  }
}

const getPendingStudents = async (req, res) => {
  try {
    await ensureIntakeSchema();
    const { status, strand, activity } = req.query;

    let whereClause = `WHERE u.role = 'student'`;
    const params = [];
    let paramIdx = 1;
    if (req.user.role === 'teacher') {
      whereClause += ` AND s.intake_teacher_id = $${paramIdx++}`;
      params.push(req.user.id);
    }

    // Exclude archived students from the main approval list
    whereClause += ` AND s.archived_at IS NULL`;

    // Students already deployed into a teacher batch are finished with
    // approval, so keep them off this page. They reappear here only if the
    // coordinator removes them from their batch.
    whereClause += ` AND NOT EXISTS (
      SELECT 1 FROM teacher_batch_students tbs JOIN teacher_batches b ON b.id = tbs.teacher_batch_id
      WHERE tbs.student_id = s.id AND tbs.deployment_ended_on IS NULL AND b.archived_at IS NULL
    )`;

    if (status && status !== 'all') {
      whereClause += ` AND u.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    if (strand && strand !== 'all') {
      whereClause += ` AND s.track_strand = $${paramIdx}`;
      params.push(strand);
      paramIdx++;
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.status, u.password, u.created_at, u.last_login, s.first_name, s.last_name, s.student_number,
              s.grade_level, s.section, s.track_strand, s.school, s.preferred_company
       FROM users u
       JOIN students s ON u.id = s.user_id
       ${whereClause}
       ORDER BY u.created_at DESC`,
      params
    );

    const studentsWithActivity = result.rows.map((student) => {
      const activityStatus = computeActivityStatus(student);
      const studentFields = { ...student };
      delete studentFields.password;
      return {
        ...studentFields,
        needs_password_setup: approvalLink.needsPasswordSetup(student),
        activity_status: activityStatus.status,
        activity_label: activityStatus.label,
        days_since_login: activityStatus.daysSinceLogin,
      };
    });

    // Filter by activity status if provided
    let filteredStudents = studentsWithActivity;
    if (activity && activity !== 'all') {
      filteredStudents = studentsWithActivity.filter((s) => s.activity_status === activity);
    }

    res.json({ students: filteredStudents });
  } catch (err) {
    console.error('Get pending students error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const getStudentStrands = async (req, res) => {
  try {
    await ensureIntakeSchema();
    const teacherId = req.user.role === 'teacher' ? req.user.id : null;
    const result = await pool.query(
      `SELECT DISTINCT s.track_strand
       FROM users u
       JOIN students s ON u.id = s.user_id
       WHERE u.role = 'student' AND s.track_strand IS NOT NULL
         AND ($1::int IS NULL OR ${teacherReviewScope('s', '$1')})
       ORDER BY s.track_strand`,
      [teacherId],
    );
    res.json({ strands: result.rows.map((r) => r.track_strand) });
  } catch (err) {
    console.error('Get student strands error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const getAllStudents = async (req, res) => {
  try {
    await ensureIntakeSchema();
    await ensureDocumentTypesSchema();
    await ensureRequirementReviewSchema();
    const {
      strand,
      activity,
      search,
      requirements_completed,
      deployment_status,
    } = req.query;

    let whereClause = `WHERE u.role = 'student'`;
    const params = [];
    let paramIdx = 1;

    // Exclude archived students from the main list
    whereClause += ` AND s.archived_at IS NULL`;

    if (strand && strand !== 'all') {
      whereClause += ` AND s.track_strand = $${paramIdx}`;
      params.push(strand);
      paramIdx++;
    }

    if (typeof search === 'string' && search.trim()) {
      whereClause += ` AND (
        POSITION($${paramIdx} IN LOWER(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, ''))) > 0 OR
        POSITION($${paramIdx} IN LOWER(u.email)) > 0 OR
        POSITION($${paramIdx} IN LOWER(s.student_number)) > 0 OR
        POSITION($${paramIdx} IN LOWER(${uploaderName})) > 0
      )`;
      params.push(search.trim().toLowerCase());
      paramIdx++;
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.status, u.password, u.created_at, u.last_login,
              s.first_name, s.last_name, s.student_number, s.grade_level, s.section,
              s.track_strand, s.school, s.preferred_company,
              ${uploaderName} AS uploaded_by_teacher, srs.status AS requirements_status,
              COALESCE(lower(srs.status) = 'approved' AND NOT EXISTS (
                SELECT 1 FROM document_types dt WHERE COALESCE(dt.is_active, true) AND NOT EXISTS (
                  SELECT 1 FROM student_requirement_statuses review
                  WHERE review.submission_id = srs.id AND review.document_type_id = dt.id AND review.status = 'APPROVED'
                )
              ), false) AS requirements_completed,
              CASE WHEN EXISTS (
                SELECT 1 FROM teacher_batch_students tbs WHERE tbs.student_id = s.id
              ) THEN true ELSE false END AS is_deployed
       FROM users u
       JOIN students s ON u.id = s.user_id
       LEFT JOIN student_requirement_submissions srs ON srs.student_id = s.id
       LEFT JOIN users uploader_account ON uploader_account.id = s.uploaded_by_teacher_id
       LEFT JOIN teachers uploader ON uploader.user_id = uploader_account.id
       ${whereClause}
       ORDER BY u.created_at DESC`,
      params
    );

    let studentsWithActivity = result.rows.map((student) => {
      const activityStatus = computeActivityStatus(student);
      const studentFields = { ...student };
      delete studentFields.password;
      return {
        ...studentFields,
        needs_password_setup: approvalLink.needsPasswordSetup(student),
        activity_status: activityStatus.status,
        activity_label: activityStatus.label,
        days_since_login: activityStatus.daysSinceLogin,
        deployment_status: student.is_deployed ? 'deployed' : 'not_deployed',
      };
    });

    // Filter by activity status if provided
    if (activity && activity !== 'all') {
      studentsWithActivity = studentsWithActivity.filter((s) => s.activity_status === activity);
    }

    if (requirements_completed === 'true' || requirements_completed === 'false') {
      const requirementsCompleted = requirements_completed === 'true';
      studentsWithActivity = studentsWithActivity.filter(
        (student) => student.requirements_completed === requirementsCompleted
      );
    }

    if (deployment_status && deployment_status !== 'all') {
      studentsWithActivity = studentsWithActivity.filter(
        (student) => student.deployment_status === deployment_status
      );
    }

    res.json({ students: studentsWithActivity });
  } catch (err) {
    console.error('Get all students error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const getSpecialNeedsStudents = async (req, res) => {
  try {
    const coordinatorResult = await pool.query(
      'SELECT strand FROM coordinators WHERE user_id = $1',
      [req.user.id]
    );
    if (!coordinatorResult.rows.length) {
      return res.status(403).json({ error: 'Coordinator profile not found.' });
    }

    const strand = coordinatorResult.rows[0].strand || null;
    const result = await pool.query(
      `SELECT s.id, s.student_number, s.first_name, s.middle_name, s.last_name, s.suffix,
              s.section, s.track_strand AS strand, s.has_special_needs
         FROM students s
         JOIN users u ON u.id = s.user_id
        WHERE u.role = 'student'
          AND s.has_special_needs IS TRUE
          AND s.archived_at IS NULL
          AND ($1::text IS NULL OR s.track_strand = $1)
        ORDER BY s.last_name, s.first_name, s.student_number`,
      [strand]
    );
    res.json({ students: result.rows });
  } catch (err) {
    console.error('Get special needs students error:', err);
    res.status(500).json({ error: 'Could not load students who requested support.' });
  }
};

// Mirrors the admin approval flow but without handing out a temp password.
// Approval issues a one-time link instead; the student opens it and chooses
// their own password + confirmation on /set-password?token=..., which the page
// submits to the token-based reset endpoint.
//
// Why a token and not the plain email flow: /api/users/set-password (email only,
// no token) is reserved for 'pending' activation, and this account is already
// 'approved' by the time the mail goes out. The token endpoint is the one that
// can safely set a password for an approved account, because possession of the
// emailed link is the proof.
//
// The link's lifetime is set centrally in utils/linkExpiry.js.

const approveStudent = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the student being approved (with strand and current status).
    const studentResult = await pool.query(
      `SELECT u.id, u.email, u.role, u.status, u.password, u.last_login, s.track_strand, s.first_name, s.last_name
       FROM users u
       JOIN students s ON u.id = s.user_id
       WHERE u.id = $1 AND u.role = 'student'`,
      [id]
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    const student = studentResult.rows[0];

    // Check if student is already active
    const activity = computeActivityStatus(student);
    if (activity.status === 'active') {
      return res.status(400).json({
        error: 'Student is already active and has logged in. No approval needed.',
        activityStatus: 'active'
      });
    }

    if (student.status !== 'pending') {
      return res.status(400).json({ error: 'Student is not pending approval.' });
    }

    const result = await pool.query(
      `UPDATE users SET status = 'approved', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending' AND role = 'student'
       RETURNING id, email, role, password`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found, already processed, or not a student.' });
    }

    const user = result.rows[0];
    user.first_name = student.first_name;
    user.last_name = student.last_name;

    const { emailSent, emailError, linkSent } = await approvalLink.issueAndEmailApprovalLink(user);

    // A student who self-registered already has a password, so they get a plain
    // approval notice. One created by Excel upload has none, so they get the
    // set-password link. Either way the mail is best-effort and the account is
    // approved regardless - so say so explicitly when nothing was delivered.
    res.json({
      message: emailSent
        ? linkSent
          ? 'Student approved. Set-your-password link emailed.'
          : 'Student approved. Approval email sent.'
        : 'Student approved, but the email failed to send. Use Resend email on their row.',
      emailSent,
      linkSent,
      emailError,
      user: approvalLink.publicUser(user),
    });
  } catch (err) {
    console.error('Approve student error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

// Recovery path when the approval mail bounced or expired. Issues a fresh
// one-time token, which also invalidates the previous link.
const resendStudentApprovalLink = async (req, res) => {
  try {
    const { id } = req.params;
    const recipient = await approvalLink.getApprovalRecipient(Number(id));
    if (!recipient || recipient.role !== 'student') {
      return res.status(404).json({ error: 'Student not found.' });
    }

    if (String(recipient.status || '').toLowerCase() === 'pending_activation') {
      const activation = await studentActivation.resendTemporaryPassword(recipient);
      if (!activation.eligible) {
        return res.status(409).json({ error: 'Student account is no longer awaiting activation.' });
      }
      return res.json({
        message: activation.emailSent
          ? `Temporary login credentials emailed. They are valid for ${studentActivation.TEMPORARY_PASSWORD_TTL_HOURS} hours.`
          : 'The temporary password was rotated, but the email failed. Check the mail settings and resend credentials.',
        emailSent: activation.emailSent,
        emailError: activation.emailError,
      });
    }

    const activity = computeActivityStatus(recipient);
    if (activity.status === 'active') {
      return res.status(400).json({
        error: 'Cannot resend email. Student is already active and has logged in.',
        activityStatus: 'active',
      });
    }

    const { emailSent, emailError } = await approvalLink.resendApprovalLink(recipient);
    res.json({
      message: emailSent
        ? 'Set-your-password link emailed.'
        : 'The email failed to send. Check the mail settings and try again.',
      emailSent,
      emailError,
    });
  } catch (err) {
    console.error('Resend student approval link error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const updateStudentEmail = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    await client.query('BEGIN');

    // Check if email already exists
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, id]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already in use.' });
    }

    // Update email in users table
    const userResult = await client.query(
      `UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND role = 'student'
       RETURNING id, email, role, password, last_login`,
      [email, id]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    // Update email in students table
    await client.query(
      `UPDATE students SET email = $1 WHERE user_id = $2`,
      [email, id]
    );

    await client.query('COMMIT');

    const user = userResult.rows[0];
    // Get student name
    const studentResult = await client.query(
      `SELECT first_name, last_name FROM students WHERE user_id = $1`,
      [id]
    );
    if (studentResult.rows.length > 0) {
      user.first_name = studentResult.rows[0].first_name;
      user.last_name = studentResult.rows[0].last_name;
    }

    res.json({
      message: 'Student email updated successfully.',
      user: { ...user, activity_status: computeActivityStatus(user).status, activity_label: computeActivityStatus(user).label, days_since_login: computeActivityStatus(user).daysSinceLogin }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update student email error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const disapproveStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE users SET status = 'disapproved', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending' AND role = 'student'
       RETURNING id, email, role`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found, already processed, or not a student.' });
    }

    const studentResult = await pool.query(
      `SELECT first_name, last_name FROM students WHERE user_id = $1`,
      [id]
    );

    const user = result.rows[0];
    if (studentResult.rows.length > 0) {
      user.first_name = studentResult.rows[0].first_name;
      user.last_name = studentResult.rows[0].last_name;
    }

    // Invalidates any set-password link already mailed to this student.
    await approvalLink.revokeApprovalTokens(user.id);

    res.json({ message: 'Student disapproved.', user });
  } catch (err) {
    console.error('Disapprove student error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const archiveStudent = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT id, email, role FROM users WHERE id = $1 AND role = 'student'`,
      [id]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    const studentId = userResult.rows[0].id;

    // Soft-delete: mark as archived instead of hard-removing so the student
    // can be restored later or permanently deleted from the archived section.
    await client.query(
      `UPDATE students SET archived_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [studentId]
    );
    await client.query(
      `UPDATE users SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND role = 'student'`,
      [id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Student removed to archive.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Archive student error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

// Restore an archived student back to pending.
const restoreStudent = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT id, email, role FROM users WHERE id = $1 AND role = 'student'`,
      [id]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    const studentId = userResult.rows[0].id;

    await client.query(
      `UPDATE students SET archived_at = NULL WHERE user_id = $1`,
      [studentId]
    );
    await client.query(
      `UPDATE users SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND role = 'student'`,
      [id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Student restored from archive.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Restore student error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

// Permanently delete a student (hard remove from the archived section).
const permanentDeleteStudent = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT id, email, role FROM users WHERE id = $1 AND role = 'student'`,
      [id]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found.' });
    }

    const studentId = userResult.rows[0].id;

    // 1. Delete student documents
    await client.query(`DELETE FROM student_documents WHERE student_id = (SELECT id FROM students WHERE user_id = $1)`, [studentId]);
    // 2. Delete student daily documentation
    await client.query(`DELETE FROM student_daily_documentation WHERE student_id = (SELECT id FROM students WHERE user_id = $1)`, [studentId]);
    // 3. Delete student attendance
    await client.query(`DELETE FROM student_attendance WHERE student_id = (SELECT id FROM students WHERE user_id = $1)`, [studentId]);
    // 4. Delete student requirement submissions
    await client.query(`DELETE FROM student_requirement_submissions WHERE student_id = (SELECT id FROM students WHERE user_id = $1)`, [studentId]);
    // 5. Delete from teacher_batch_students
    await client.query(`DELETE FROM teacher_batch_students WHERE student_id = (SELECT id FROM students WHERE user_id = $1)`, [studentId]);
    // 6. Delete from students table
    await client.query(`DELETE FROM students WHERE user_id = $1`, [studentId]);
    // 7. Finally delete the user
    await client.query(`DELETE FROM users WHERE id = $1 AND role = 'student'`, [id]);

    await client.query('COMMIT');

    res.json({ message: 'Student permanently deleted.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Permanent delete student error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

// List archived students (removed by coordinators).
const getArchivedStudents = async (req, res) => {
  try {
    await ensureIntakeSchema();
    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.status, u.created_at, u.updated_at,
              s.first_name, s.last_name, s.student_number, s.grade_level, s.section,
              s.track_strand, s.school, s.preferred_company, s.archived_at, ${uploaderName} AS uploaded_by_teacher
       FROM users u
       JOIN students s ON u.id = s.user_id
       LEFT JOIN users uploader_account ON uploader_account.id = s.uploaded_by_teacher_id
       LEFT JOIN teachers uploader ON uploader.user_id = uploader_account.id
       WHERE u.role = 'student' AND s.archived_at IS NOT NULL
         AND ($1::int IS NULL OR s.intake_teacher_id = $1)
       ORDER BY s.archived_at DESC`,
      [req.user.role === 'teacher' ? req.user.id : null],
    );
    res.json({ students: result.rows });
  } catch (err) {
    console.error('Get archived students error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

const bulkApproveStudents = async (req, res) => {
  const { student_ids } = req.body;
  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE users
       SET status = 'approved', updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1) AND role = 'student' AND status = 'pending'
       RETURNING id`,
      [student_ids],
    );

    await client.query('COMMIT');

    // The approved rows are collected in the same transaction so the mails go
    // out only for students that were actually flipped to approved.
    const approvedIds = result.rows.map((r) => r.id);

    // Approving in bulk used to send nothing, which left every one of those
    // students unable to sign in: their account was active but they had no
    // password and no way to get one. Each now gets the same one-time
    // set-password link as a single approval.
    let emailFailures = 0;
    let linksSent = 0;
    if (approvedIds.length > 0) {
      // u.password decides per student whether a set-password link is needed or
      // a plain approval notice is enough (see approvalLink.service).
      const recipients = await client.query(
        `SELECT u.id, u.email, u.role, u.password, s.first_name, s.last_name
         FROM users u
         JOIN students s ON s.user_id = u.id
         WHERE u.id = ANY($1)`,
        [approvedIds],
      );

      // Sequential on purpose: a bulk approve of a full year would otherwise
      // open a burst of SMTP connections and get the sender throttled or
      // temporarily blocked.
      for (const recipient of recipients.rows) {
        // Each student needs a distinct token, so issue individually.
        // eslint-disable-next-line no-await-in-loop
        const { emailSent, linkSent } = await approvalLink.issueAndEmailApprovalLink(recipient);
        if (!emailSent) emailFailures += 1;
        if (linkSent) linksSent += 1;
      }
    }

    const summary = `${approvedIds.length} student(s) approved.`;
    const emailNote = emailFailures
      ? ` ${emailFailures} email(s) failed - resend from the student list.`
      : linksSent
        ? ` ${linksSent} set-password link(s) emailed.`
        : ' Approval emails sent.';

    res.json({
      message: summary + emailNote,
      count: approvedIds.length,
      emailFailures,
      linksSent,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk approve students error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const bulkDisapproveStudents = async (req, res) => {
  const { student_ids } = req.body;
  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE users
       SET status = 'disapproved', updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1) AND role = 'student'
       RETURNING id`,
      [student_ids],
    );

    await client.query('COMMIT');

    // Drop any outstanding set-password links so a rejected student cannot use
    // one to set a password and get the account re-approved.
    const revokedIds = result.rows.map((r) => r.id);
    if (revokedIds.length > 0) {
      await client.query(
        `DELETE FROM password_reset_tokens WHERE user_id = ANY($1)`,
        [revokedIds],
      );
    }

    res.json({
      message: `${revokedIds.length} student(s) disapproved.`,
      count: revokedIds.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk disapprove students error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const bulkArchiveStudents = async (req, res) => {
  const { student_ids } = req.body;
  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE students SET archived_at = CURRENT_TIMESTAMP
       WHERE user_id = ANY($1) AND archived_at IS NULL`,
      [student_ids]
    );
    await client.query(
      `UPDATE users SET status = 'archived', updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1) AND role = 'student'`,
      [student_ids]
    );

    await client.query('COMMIT');

    res.json({
      message: `${student_ids.length} student(s) removed to archive.`,
      count: student_ids.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk archive students error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const bulkRestoreStudents = async (req, res) => {
  const { student_ids } = req.body;
  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE students SET archived_at = NULL WHERE user_id = ANY($1)`,
      [student_ids]
    );
    await client.query(
      `UPDATE users SET status = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1) AND role = 'student'`,
      [student_ids]
    );

    await client.query('COMMIT');

    res.json({
      message: `${student_ids.length} student(s) restored from archive.`,
      count: student_ids.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk restore students error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

const bulkPermanentDeleteStudents = async (req, res) => {
  const { student_ids } = req.body;
  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM student_documents WHERE student_id IN (SELECT id FROM students WHERE user_id = ANY($1))`,
      [student_ids]
    );
    await client.query(
      `DELETE FROM student_daily_documentation WHERE student_id IN (SELECT id FROM students WHERE user_id = ANY($1))`,
      [student_ids]
    );
    await client.query(
      `DELETE FROM student_attendance WHERE student_id IN (SELECT id FROM students WHERE user_id = ANY($1))`,
      [student_ids]
    );
    await client.query(
      `DELETE FROM student_requirement_submissions WHERE student_id IN (SELECT id FROM students WHERE user_id = ANY($1))`,
      [student_ids]
    );
    await client.query(
      `DELETE FROM teacher_batch_students WHERE student_id IN (SELECT id FROM students WHERE user_id = ANY($1))`,
      [student_ids]
    );
    await client.query(
      `DELETE FROM students WHERE user_id = ANY($1)`,
      [student_ids]
    );

    const result = await client.query(
      `DELETE FROM users WHERE id = ANY($1) AND role = 'student'
       RETURNING id`,
      [student_ids]
    );

    await client.query('COMMIT');

    res.json({
      message: `${result.rows.length} student(s) permanently deleted.`,
      count: result.rows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk permanent delete students error:', err);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
};

module.exports = {
  getPendingStudents,
  getStudentStrands,
  approveStudent,
  disapproveStudent,
  resendStudentApprovalLink,
  archiveStudent,
  restoreStudent,
  permanentDeleteStudent,
  getArchivedStudents,
  bulkApproveStudents,
  bulkDisapproveStudents,
  bulkArchiveStudents,
bulkRestoreStudents,
  bulkPermanentDeleteStudents,
  updateStudentEmail,
  getAllStudents,
  getSpecialNeedsStudents,
};
