const pool = require('../db');

const REPORT_REASONS = new Set([
  'remove_account',
  'duplicate_account',
  'incorrect_information',
  'access_problem',
  'other',
]);

const createStudentAccountReport = async (req, res) => {
  const studentUserId = Number(req.params.studentId);
  const { reason } = req.body || {};
  const comments = typeof req.body?.comments === 'string' ? req.body.comments.trim() : '';

  if (!Number.isInteger(studentUserId) || studentUserId <= 0) {
    return res.status(400).json({ error: 'Invalid student account.' });
  }
  if (!REPORT_REASONS.has(reason)) {
    return res.status(400).json({ error: 'Choose a valid report reason.' });
  }
  if (!comments || comments.length > 2000) {
    return res.status(400).json({ error: 'Comments are required and must be 2000 characters or fewer.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO student_account_reports (student_user_id, submitted_by, reason, comments)
       SELECT u.id, $2, $3, $4
       FROM users u
       JOIN students s ON s.user_id = u.id
       WHERE u.id = $1 AND u.role = 'student' AND s.archived_at IS NULL
       RETURNING id, status, created_at`,
      [studentUserId, req.user.id, reason, comments]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Active student account not found.' });
    }

    return res.status(201).json({ report: result.rows[0], message: 'Report sent to the admin team.' });
  } catch (err) {
    console.error('Create student account report error:', err);
    return res.status(500).json({ error: 'Could not submit the account report.' });
  }
};

const listAccountProblemReports = async (req, res) => {
  const status = req.query.status || 'open';
  if (!['open', 'resolved', 'all'].includes(status)) {
    return res.status(400).json({ error: 'Invalid report status.' });
  }

  try {
    const result = await pool.query(
      `SELECT r.id, r.student_user_id, r.reason, r.comments, r.status,
              r.resolution_note, r.resolved_at, r.created_at,
              u.email AS student_email, s.first_name, s.last_name,
              s.student_number, s.track_strand, s.archived_at,
              COALESCE(
                NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
                NULLIF(TRIM(CONCAT_WS(' ', t.first_name, t.last_name)), ''),
                reporter.email,
                'Former staff member'
              ) AS reported_by
       FROM student_account_reports r
       LEFT JOIN users u ON u.id = r.student_user_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN users reporter ON reporter.id = r.submitted_by
       LEFT JOIN coordinators c ON c.user_id = reporter.id
       LEFT JOIN teachers t ON t.user_id = reporter.id
       WHERE $1 = 'all' OR r.status = $1
       ORDER BY r.created_at DESC, r.id DESC`,
      [status]
    );
    return res.json({ reports: result.rows });
  } catch (err) {
    console.error('List account problem reports error:', err);
    return res.status(500).json({ error: 'Could not load account reports.' });
  }
};

const resolveAccountProblemReport = async (req, res) => {
  const reportId = Number(req.params.reportId);
  const note = typeof req.body?.resolution_note === 'string' ? req.body.resolution_note.trim() : '';

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ error: 'Invalid report.' });
  }
  if (note.length > 2000) {
    return res.status(400).json({ error: 'Resolution note must be 2000 characters or fewer.' });
  }

  try {
    const result = await pool.query(
      `UPDATE student_account_reports
       SET status = 'resolved', resolution_note = NULLIF($2, ''),
           resolved_by = $3, resolved_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'open'
       RETURNING id`,
      [reportId, note, req.user.id]
    );

    if (result.rowCount === 0) {
      const existing = await pool.query(
        'SELECT status FROM student_account_reports WHERE id = $1',
        [reportId]
      );
      if (existing.rowCount === 0) {
        return res.status(404).json({ error: 'Report not found.' });
      }
      return res.status(409).json({ error: 'This report has already been resolved.' });
    }

    return res.json({ message: 'Report marked as resolved.' });
  } catch (err) {
    console.error('Resolve account problem report error:', err);
    return res.status(500).json({ error: 'Could not resolve the report.' });
  }
};

const archiveReportedStudent = async (req, res) => {
  const reportId = Number(req.params.reportId);
  const note = typeof req.body?.resolution_note === 'string' ? req.body.resolution_note.trim() : '';

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ error: 'Invalid report.' });
  }
  if (note.length > 2000) {
    return res.status(400).json({ error: 'Resolution note must be 2000 characters or fewer.' });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const reportResult = await client.query(
      `SELECT id, student_user_id, reason, status
       FROM student_account_reports
       WHERE id = $1
       FOR UPDATE`,
      [reportId]
    );
    const report = reportResult.rows[0];
    if (!report) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Report not found.' });
    }
    if (report.status !== 'open') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'This report has already been resolved.' });
    }
    if (report.reason !== 'remove_account') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Only account-removal reports can archive a student.' });
    }

    const studentResult = await client.query(
      `SELECT u.id, s.archived_at
       FROM users u
       JOIN students s ON s.user_id = u.id
       WHERE u.id = $1 AND u.role = 'student'
       FOR UPDATE OF u, s`,
      [report.student_user_id]
    );
    if (studentResult.rowCount === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'The student account no longer exists.' });
    }

    await client.query(
      `UPDATE students
       SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
       WHERE user_id = $1`,
      [report.student_user_id]
    );
    await client.query(
      `UPDATE users
       SET status = 'archived', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND role = 'student'`,
      [report.student_user_id]
    );
    await client.query(
      `UPDATE student_account_reports
       SET status = 'resolved',
           resolution_note = COALESCE(NULLIF($2, ''), 'Student account archived by admin.'),
           resolved_by = $3, resolved_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [reportId, note, req.user.id]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    return res.json({ message: 'Student account archived and report resolved.' });
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback account archive report error:', rollbackErr);
      }
    }
    console.error('Archive reported student error:', err);
    return res.status(500).json({ error: 'Could not archive the student account.' });
  } finally {
    client.release();
  }
};

module.exports = {
  createStudentAccountReport,
  listAccountProblemReports,
  resolveAccountProblemReport,
  archiveReportedStudent,
};
