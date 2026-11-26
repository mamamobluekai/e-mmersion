const pool = require('../db');
const cloudinary = require('../db/cloudinary');
const streamifier = require('streamifier');

const CATEGORIES = new Set([
  'Login or Account Access',
  'Forgot Password / Password Reset',
  'Technical Issue or System Error',
  'Page Not Loading',
  'Incorrect or Missing Information',
  'Feature Not Working Properly',
  'Account Information Concern',
  'General Inquiry',
  'Complaint or Feedback',
  'Other',
]);

const ROLES = new Set(['student', 'teacher', 'supervisor', 'coordinator', 'admin']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const STATUSES = new Set(['pending', 'in_progress', 'resolved', 'closed']);

function generateReferenceId() {
  const date = new Date();
  const yyyymmdd = date.toISOString().slice(0, 10).replaceAll('-', '');
  const random = String(Math.floor(Math.random() * 90000) + 10000);
  return `SUP-${yyyymmdd}-${random}`;
}

function uploadToCloudinary(buffer, originalName) {
  return new Promise((resolve, reject) => {
    const safeBase = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder: 'support_reports',
        public_id: `${safeBase}`,
        unique_filename: true,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

function isValidEmail(email) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
}

const createSupportReport = async (req, res) => {
  const {
    submitted_name,
    submitted_email,
    submitted_role_id,
    role,
    category,
    category_other,
    subject,
    description,
  } = req.body || {};

  const name = typeof submitted_name === 'string' ? submitted_name.trim() : '';
  const email = typeof submitted_email === 'string' ? submitted_email.trim().toLowerCase() : '';
  const roleId = typeof submitted_role_id === 'string' ? submitted_role_id.trim() : '';
  const reportRole = typeof role === 'string' ? role.trim() : '';
  const reportCategory = typeof category === 'string' ? category.trim() : '';
  const categoryOther = typeof category_other === 'string' ? category_other.trim() : '';
  const subjectVal = typeof subject === 'string' ? subject.trim() : '';
  const descriptionVal = typeof description === 'string' ? description.trim() : '';

  if (!name || name.length > 255) {
    return res.status(400).json({ error: 'Full name is required (max 255 characters).' });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!roleId || roleId.length > 100) {
    return res.status(400).json({ error: 'A role ID is required (max 100 characters).' });
  }
  if (!ROLES.has(reportRole)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (!CATEGORIES.has(reportCategory)) {
    return res.status(400).json({ error: 'Invalid concern category.' });
  }
  if (reportCategory === 'Other' && (!categoryOther || categoryOther.length > 255)) {
    return res.status(400).json({ error: 'Please specify the concern type (max 255 characters).' });
  }
  if (!subjectVal || subjectVal.length > 255) {
    return res.status(400).json({ error: 'Subject is required (max 255 characters).' });
  }
  if (!descriptionVal || descriptionVal.length > 5000) {
    return res.status(400).json({ error: 'Description is required (max 5000 characters).' });
  }

  let attachmentInfo = null;
  if (req.file) {
    const ext = (req.file.originalname || '').toLowerCase();
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(ext);
    if (!isImage || !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only PNG and JPG images are allowed as attachments.' });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Attachment must be 5 MB or smaller.' });
    }
    try {
      const result = await uploadToCloudinary(req.file.buffer, req.file.originalname);
      attachmentInfo = {
        cloudinary_public_id: result.public_id,
        cloudinary_url: result.secure_url,
        original_name: req.file.originalname,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
      };
    } catch (err) {
      console.error('Support report attachment upload error:', err);
      return res.status(500).json({ error: 'Attachment upload failed.' });
    }
  }

  const referenceId = generateReferenceId();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reportResult = await client.query(
      `INSERT INTO support_reports
        (reference_id, submitted_name, submitted_email, role, submitted_role_id, category, category_other,
         subject, description, attachment_url, attachment_name, attachment_size, attachment_mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, reference_id, created_at`,
      [
        referenceId, name, email, reportRole, roleId, reportCategory,
        reportCategory === 'Other' ? categoryOther : null,
        subjectVal, descriptionVal,
        attachmentInfo ? attachmentInfo.cloudinary_url : null,
        attachmentInfo ? attachmentInfo.original_name : null,
        attachmentInfo ? attachmentInfo.file_size : null,
        attachmentInfo ? attachmentInfo.mime_type : null,
      ]
    );

    const reportId = reportResult.rows[0].id;

    if (attachmentInfo) {
      await client.query(
        `INSERT INTO support_report_attachments
          (report_id, cloudinary_public_id, cloudinary_url, original_name, file_size, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [reportId, attachmentInfo.cloudinary_public_id, attachmentInfo.cloudinary_url,
         attachmentInfo.original_name, attachmentInfo.file_size, attachmentInfo.mime_type]
      );
    }

    await client.query(
      `INSERT INTO support_report_activity_logs
        (report_id, actor_type, action, field, new_value)
       VALUES ($1, 'system', 'created', 'status', 'pending')`,
      [reportId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Your concern has been successfully submitted.',
      reference_id: referenceId,
      report: { id: reportId, reference_id: referenceId, status: 'pending' },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create support report error:', err);
    return res.status(500).json({ error: 'Could not submit the report.' });
  } finally {
    client.release();
  }
};

const listSupportReports = async (req, res) => {
  const {
    status, role, category, priority, search,
    sort = 'newest', page = 1, limit = 20,
    date_from, date_to,
  } = req.query;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (status && status !== 'all') {
    if (!STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status filter.' });
    }
    conditions.push(`sr.status = $${paramIndex++}`);
    params.push(status);
  }
  if (role && role !== 'all') {
    if (!ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid role filter.' });
    }
    conditions.push(`sr.role = $${paramIndex++}`);
    params.push(role);
  }
  if (category && category !== 'all') {
    if (!CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'Invalid category filter.' });
    }
    conditions.push(`sr.category = $${paramIndex++}`);
    params.push(category);
  }
  if (priority && priority !== 'all') {
    if (!PRIORITIES.has(priority)) {
      return res.status(400).json({ error: 'Invalid priority filter.' });
    }
    conditions.push(`sr.priority = $${paramIndex++}`);
    params.push(priority);
  }
  if (search && search.trim()) {
    conditions.push(`(sr.reference_id ILIKE $${paramIndex} OR sr.subject ILIKE $${paramIndex}
      OR sr.submitted_name ILIKE $${paramIndex} OR sr.submitted_role_id ILIKE $${paramIndex})`);
    params.push(`%${search.trim()}%`);
    paramIndex++;
  }
  if (date_from) {
    conditions.push(`sr.created_at::date >= $${paramIndex++}`);
    params.push(date_from);
  }
  if (date_to) {
    conditions.push(`sr.created_at::date <= $${paramIndex++}`);
    params.push(date_to);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortDirection = sort === 'oldest' ? 'ASC' : 'DESC';

  try {
    const countResult = await clientQuery(
      `SELECT COUNT(*) FROM support_reports sr ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await clientQuery(
      `SELECT sr.id, sr.reference_id, sr.subject, sr.category, sr.category_other,
              sr.submitted_name, sr.submitted_email, sr.role, sr.submitted_role_id,
              sr.priority, sr.status,
              sr.created_at, sr.updated_at, sr.assigned_to,
              u.email AS assigned_email,
              COALESCE(a.first_name || ' ' || a.last_name, '') AS assigned_name
       FROM support_reports sr
       LEFT JOIN users u ON u.id = sr.assigned_to
       LEFT JOIN admins a ON a.user_id = u.id
       ${whereClause}
       ORDER BY sr.created_at ${sortDirection}, sr.id ${sortDirection}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limitNum, offset]
    );

    return res.json({
      reports: dataResult.rows,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('List support reports error:', err);
    return res.status(500).json({ error: 'Could not load reports.' });
  }
};

function clientQuery(text, params) {
  return pool.query(text, params);
}

const getSupportReport = async (req, res) => {
  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ error: 'Invalid report ID.' });
  }

  try {
    const reportResult = await pool.query(
      `SELECT sr.id, sr.reference_id, sr.subject, sr.category, sr.category_other,
              sr.submitted_name, sr.submitted_email, sr.role, sr.submitted_role_id,
              sr.priority, sr.status,
              sr.description, sr.attachment_url, sr.attachment_name, sr.attachment_size,
              sr.attachment_mime_type, sr.created_at, sr.updated_at, sr.assigned_to,
              u.email AS assigned_email,
              COALESCE(a.first_name || ' ' || a.last_name, '') AS assigned_name
       FROM support_reports sr
       LEFT JOIN users u ON u.id = sr.assigned_to
       LEFT JOIN admins a ON a.user_id = u.id
       WHERE sr.id = $1`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const report = reportResult.rows[0];

    const attachments = await pool.query(
      `SELECT id, cloudinary_public_id, cloudinary_url, original_name, file_size, mime_type, created_at
       FROM support_report_attachments
       WHERE report_id = $1
       ORDER BY created_at DESC`,
      [reportId]
    );

    const replies = await pool.query(
      `SELECT id, sender_type, sender_id, message, is_internal, created_at,
              u.email AS sender_email,
              COALESCE(adm.first_name || ' ' || adm.last_name, '') AS sender_name
       FROM support_report_replies rr
       LEFT JOIN users u ON u.id = rr.sender_id
       LEFT JOIN admins adm ON adm.user_id = u.id
       WHERE rr.report_id = $1
       ORDER BY rr.created_at ASC`,
      [reportId]
    );

    const activity = await pool.query(
      `SELECT id, actor_type, actor_id, action, field, old_value, new_value, created_at,
              u.email AS actor_email
       FROM support_report_activity_logs sal
       LEFT JOIN users u ON u.id = sal.actor_id
       WHERE sal.report_id = $1
       ORDER BY sal.created_at ASC`,
      [reportId]
    );

    return res.json({
      report,
      attachments: attachments.rows,
      replies: replies.rows,
      activity: activity.rows,
    });
  } catch (err) {
    console.error('Get support report error:', err);
    return res.status(500).json({ error: 'Could not load the report.' });
  }
};

const updateSupportReport = async (req, res) => {
  const reportId = Number(req.params.id);
  const { status, priority, assigned_to, actor_type = 'admin', actor_id } = req.body || {};

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ error: 'Invalid report ID.' });
  }

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (status !== undefined) {
    if (!STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    updates.push(`status = $${paramIndex++}`);
    params.push(status);
  }
  if (priority !== undefined) {
    if (!PRIORITIES.has(priority)) {
      return res.status(400).json({ error: 'Invalid priority.' });
    }
    updates.push(`priority = $${paramIndex++}`);
    params.push(priority);
  }
  if (assigned_to !== undefined) {
    const assignedId = assigned_to === null || assigned_to === '' ? null : Number(assigned_to);
    if (assignedId !== null && (!Number.isInteger(assignedId) || assignedId <= 0)) {
      return res.status(400).json({ error: 'Invalid administrator ID.' });
    }
    updates.push(`assigned_to = $${paramIndex++}`);
    params.push(assignedId);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(reportId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT status, priority, assigned_to FROM support_reports WHERE id = $1 FOR UPDATE',
      [reportId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Report not found.' });
    }

    const oldValues = existing.rows[0];

    const result = await client.query(
      `UPDATE support_reports SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, status, priority, assigned_to`,
      params
    );

    const newValues = result.rows[0];

    const logEntries = [];
    if (status !== undefined && status !== oldValues.status) {
      logEntries.push([reportId, actor_type, 'status_changed', 'status', oldValues.status, newValues.status, actor_id]);
    }
    if (priority !== undefined && priority !== oldValues.priority) {
      logEntries.push([reportId, actor_type, 'priority_changed', 'priority', oldValues.priority, newValues.priority, actor_id]);
    }
    if (assigned_to !== undefined && newValues.assigned_to !== oldValues.assigned_to) {
      logEntries.push([reportId, actor_type, 'assignment_changed', 'assigned_to',
        oldValues.assigned_to || null, newValues.assigned_to || null, actor_id]);
    }

    if (logEntries.length) {
      const valuesPlaceholder = logEntries.map(
        (_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6}, $${i * 6 + 7})`
      ).join(', ');
      const flatParams = logEntries.flat();
      await client.query(
        `INSERT INTO support_report_activity_logs
          (report_id, actor_type, action, field, old_value, new_value, actor_id)
         VALUES ${valuesPlaceholder}`,
        flatParams
      );
    }

    await client.query('COMMIT');

    return res.json({ message: 'Report updated.', report: newValues });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update support report error:', err);
    return res.status(500).json({ error: 'Could not update the report.' });
  } finally {
    client.release();
  }
};

const addSupportReportReply = async (req, res) => {
  const reportId = Number(req.params.id);
  const { message, sender_type = 'admin', sender_id, is_internal = false } = req.body || {};

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ error: 'Invalid report ID.' });
  }
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg || msg.length > 5000) {
    return res.status(400).json({ error: 'Message is required (max 5000 characters).' });
  }

  try {
    const reportExists = await pool.query(
      'SELECT id FROM support_reports WHERE id = $1',
      [reportId]
    );
    if (reportExists.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const result = await pool.query(
      `INSERT INTO support_report_replies
        (report_id, sender_type, sender_id, message, is_internal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [reportId, sender_type, sender_id || null, msg, is_internal]
    );

    await pool.query(
      `INSERT INTO support_report_activity_logs
        (report_id, actor_type, action, field, new_value, actor_id)
       VALUES ($1, $2, $3, 'reply', $4, $5)`,
      [reportId, sender_type, is_internal ? 'internal_note_added' : 'reply_sent',
       is_internal ? 'Internal note added' : `Reply: ${msg.slice(0, 100)}`, sender_id || null]
    );

    return res.status(201).json({
      message: is_internal ? 'Internal note added.' : 'Reply sent.',
      reply: result.rows[0],
    });
  } catch (err) {
    console.error('Add support report reply error:', err);
    return res.status(500).json({ error: 'Could not add the reply.' });
  }
};

const getSupportReportStats = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM support_reports
       GROUP BY status`
    );

    const stats = { total: 0, pending: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const row of result.rows) {
      stats.total += parseInt(row.count, 10);
      stats[row.status] = (stats[row.status] || 0) + parseInt(row.count, 10);
    }

    return res.json(stats);
  } catch (err) {
    console.error('Get support report stats error:', err);
    return res.status(500).json({ error: 'Could not load statistics.' });
  }
};

module.exports = {
  createSupportReport,
  listSupportReports,
  getSupportReport,
  updateSupportReport,
  addSupportReportReply,
  getSupportReportStats,
};
