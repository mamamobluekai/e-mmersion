const pool = require('../../db');
const studentActivation = require('../../services/studentActivation.service');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DESCRIPTION_LENGTH = 2500;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseInstitution(body) {
  const name = trimmed(body.name);
  const industry = trimmed(body.industry);
  const address = trimmed(body.address);
  const description = trimmed(body.description);

  if (!name || name.length > 255) {
    throw new RequestError(400, 'Company name is required and must be 255 characters or fewer.');
  }
  if (!industry || industry.length > 120) {
    throw new RequestError(400, 'Company type or industry is required and must be 120 characters or fewer.');
  }
  if (!address || address.length > 2000) {
    throw new RequestError(400, 'Company address is required and must be 2,000 characters or fewer.');
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new RequestError(400, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }

  return { name, industry, address, description: description || null };
}

function parseSupervisor(body) {
  const fullName = trimmed(body.fullName);
  const email = trimmed(body.email).toLowerCase();
  const phone = trimmed(body.phone);
  const nameParts = fullName.split(/\s+/).filter(Boolean);

  if (nameParts.length < 2 || fullName.length > 200) {
    throw new RequestError(400, 'Enter the supervisor’s full name.');
  }
  if (nameParts[0].length > 100 || nameParts.slice(1).join(' ').length > 100) {
    throw new RequestError(400, 'Supervisor name must be 100 characters or fewer per name field.');
  }
  if (!EMAIL_REGEX.test(email) || email.length > 255) {
    throw new RequestError(400, 'Enter a valid supervisor email address.');
  }
  if (phone.length > 50) {
    throw new RequestError(400, 'Contact number must be 50 characters or fewer.');
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
    email,
    phone: phone || null,
  };
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function sendError(res, err, label) {
  if (err instanceof RequestError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A company or account with these details already exists.' });
  }
  console.error(`${label} error:`, err);
  return res.status(500).json({ error: 'Server error.' });
}

async function createSupervisorAssignment(client, institution, supervisor, assignedBy) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
    [`partner-supervisor-email:${supervisor.email}`],
  );
  const existing = await client.query(
    'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
    [supervisor.email],
  );
  if (existing.rows.length > 0) {
    throw new RequestError(409, 'That email address already belongs to an account.');
  }

  const credential = await studentActivation.createTemporaryCredential();
  const userResult = await client.query(
    `INSERT INTO users (
       email, password, role, phone, status, temporary_password_expires_at
     )
     VALUES (
       $1, $2, 'supervisor', $3, 'pending_activation',
       CURRENT_TIMESTAMP + make_interval(hours => $4)
     )
     RETURNING id, email, phone, status, created_at`,
    [
      supervisor.email,
      credential.passwordHash,
      supervisor.phone,
      studentActivation.TEMPORARY_PASSWORD_TTL_HOURS,
    ],
  );
  const user = userResult.rows[0];

  await client.query(
    `INSERT INTO supervisors (
       user_id, first_name, last_name, company_name, designation, company_address
     )
     VALUES ($1, $2, $3, $4, 'Workplace Supervisor', $5)`,
    [user.id, supervisor.firstName, supervisor.lastName, institution.name, institution.address],
  );
  await client.query(
    `INSERT INTO partner_institution_supervisor_history
       (
         institution_id, supervisor_user_id, supervisor_first_name,
         supervisor_last_name, supervisor_email, supervisor_phone, assigned_by
       )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      institution.id,
      user.id,
      supervisor.firstName,
      supervisor.lastName,
      supervisor.email,
      supervisor.phone,
      assignedBy,
    ],
  );

  return {
    user,
    firstName: supervisor.firstName,
    lastName: supervisor.lastName,
    temporaryPassword: credential.temporaryPassword,
  };
}

async function assertNoOpenPartnerDeployments(client, institutionId, userId = null) {
  const open = await client.query(`
    SELECT 1 FROM deployment_requests dr
    WHERE to_jsonb(dr)->>'workflow_version' = '2' AND (to_jsonb(dr)->>'partner_institution_id')::int = $1
      AND ($2::int IS NULL OR dr.supervisor_id = $2)
      AND dr.status IN ('draft', 'pending', 'approved', 'changes_requested', 'pending_coordinator_agreement')
      AND (to_jsonb(dr)->>'confirmed_schedule' IS NULL OR
        to_jsonb(dr)->'confirmed_schedule'->>'end' >= to_char(now() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD'))
    LIMIT 1`, [institutionId, userId]);
  if (open.rowCount) throw new RequestError(409, 'Resolve this partner’s open deployments before deactivating or replacing the assignment.');
}

async function deactivateAccount(client, userId) {
  const schema = await client.query("SELECT to_regclass('partner_deployment_supervisors') AS table_name");
  if (schema.rows[0].table_name) {
    const affiliations = await client.query(`
      SELECT 1 FROM partner_deployment_supervisors a JOIN partner_institutions pi ON pi.id = a.institution_id
      WHERE pi.is_active AND a.supervisor_user_id = $1 LIMIT 1`, [userId]);
    if (affiliations.rowCount) return;
  }
  await client.query(
    `UPDATE users
     SET status = 'disapproved',
         temporary_password_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND role = 'supervisor'`,
    [userId],
  );
  await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  await client.query(
    `UPDATE refresh_tokens
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

async function sendActivationEmail(supervisor) {
  const result = await studentActivation.sendTemporaryPasswordEmail(
    {
      email: supervisor.user.email,
      first_name: supervisor.firstName,
      last_name: supervisor.lastName,
      role: 'supervisor',
    },
    supervisor.temporaryPassword,
  );
  return {
    sent: result.emailSent,
    message: result.emailSent
      ? 'Supervisor activation email sent.'
      : result.emailError || 'Supervisor account created, but the activation email could not be sent.',
  };
}

const listPartnerInstitutions = async (req, res) => {
  try {
    const active = req.query.active === 'true'
      ? true
      : req.query.active === 'false'
        ? false
        : null;
    const result = await pool.query(
      `SELECT i.id, i.name, i.industry, i.description, i.address, i.is_active, i.created_at,
              CASE WHEN cu.id IS NULL THEN NULL ELSE
                json_build_object(
                  'id', cu.id,
                  'first_name', current_profile.first_name,
                  'last_name', current_profile.last_name,
                  'email', cu.email,
                  'phone', cu.phone,
                  'status', cu.status,
                  'assignment_id', current_assignment.id,
                  'assigned_at', current_assignment.assigned_at
                )
              END AS current_supervisor,
              COALESCE(
                json_agg(
                  json_build_object(
                    'assignment_id', history.id,
                    'user_id', history.supervisor_user_id,
                    'first_name', COALESCE(history.supervisor_first_name, history_profile.first_name),
                    'last_name', COALESCE(history.supervisor_last_name, history_profile.last_name),
                    'email', COALESCE(history.supervisor_email, history_user.email),
                    'phone', COALESCE(history.supervisor_phone, history_user.phone),
                    'status', history_user.status,
                    'assigned_at', history.assigned_at,
                    'ended_at', history.ended_at,
                    'end_reason', history.end_reason
                  ) ORDER BY history.assigned_at DESC
                ) FILTER (WHERE history.id IS NOT NULL),
                '[]'::json
              ) AS supervisor_history
       FROM partner_institutions i
       LEFT JOIN partner_institution_supervisor_history history
         ON history.institution_id = i.id
       LEFT JOIN users history_user ON history_user.id = history.supervisor_user_id
       LEFT JOIN supervisors history_profile ON history_profile.user_id = history.supervisor_user_id
       LEFT JOIN partner_institution_supervisor_history current_assignment
         ON current_assignment.institution_id = i.id AND current_assignment.ended_at IS NULL
       LEFT JOIN users cu ON cu.id = current_assignment.supervisor_user_id
       LEFT JOIN supervisors current_profile ON current_profile.user_id = current_assignment.supervisor_user_id
       WHERE ($1::boolean IS NULL OR i.is_active = $1)
       GROUP BY i.id, current_assignment.id, cu.id, cu.email,
                cu.phone, cu.status,
                current_profile.first_name, current_profile.last_name
       ORDER BY i.is_active DESC, lower(i.name)`,
      [active],
    );
    res.json({ institutions: result.rows });
  } catch (err) {
    sendError(res, err, 'List partner institutions');
  }
};

const createPartnerInstitution = async (req, res) => {
  let institution;
  let supervisor;
  try {
    institution = parseInstitution(req.body || {});
    supervisor = parseSupervisor(req.body?.supervisor || {});
    const created = await inTransaction(async (client) => {
      const institutionResult = await client.query(
        `INSERT INTO partner_institutions (name, industry, description, address, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, industry, description, address, is_active, created_at`,
        [institution.name, institution.industry, institution.description, institution.address, req.user.id],
      );
      const savedInstitution = institutionResult.rows[0];
      const assigned = await createSupervisorAssignment(
        client,
        savedInstitution,
        supervisor,
        req.user.id,
      );
      return { institution: savedInstitution, supervisor: assigned };
    });
    const emailNotification = await sendActivationEmail(created.supervisor);
    res.status(201).json({
      institution: { ...created.institution, current_supervisor: created.supervisor.user },
      emailNotification,
    });
  } catch (err) {
    sendError(res, err, 'Create partner institution');
  }
};

const updatePartnerInstitution = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) throw new RequestError(400, 'Invalid institution ID.');
    const fields = parseInstitution(req.body || {});
    const institution = await inTransaction(async (client) => {
      const existing = await client.query(
        'SELECT id, is_active FROM partner_institutions WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!existing.rows[0]) throw new RequestError(404, 'Partner institution not found.');
      if (!existing.rows[0].is_active) {
        throw new RequestError(409, 'Reactivate this institution before editing it.');
      }

      const updated = await client.query(
        `UPDATE partner_institutions
         SET name = $1, industry = $2, description = $3, address = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING id, name, industry, description, address, is_active, created_at`,
        [fields.name, fields.industry, fields.description, fields.address, id],
      );
      await client.query(
        `UPDATE supervisors s
         SET company_name = $1, company_address = $2, updated_at = CURRENT_TIMESTAMP
         FROM partner_institution_supervisor_history h
         WHERE h.institution_id = $3 AND h.ended_at IS NULL
           AND h.supervisor_user_id = s.user_id`,
        [fields.name, fields.address, id],
      );
      return updated.rows[0];
    });
    res.json({ institution });
  } catch (err) {
    sendError(res, err, 'Update partner institution');
  }
};

const deactivatePartnerInstitution = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) throw new RequestError(400, 'Invalid institution ID.');
    const result = await inTransaction(async (client) => {
      const existing = await client.query(
        'SELECT id, is_active FROM partner_institutions WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!existing.rows[0]) throw new RequestError(404, 'Partner institution not found.');
      if (!existing.rows[0].is_active) return { institutionId: id, alreadyInactive: true };
      await assertNoOpenPartnerDeployments(client, id);

      const current = await client.query(
        `SELECT supervisor_user_id
         FROM partner_institution_supervisor_history
         WHERE institution_id = $1 AND ended_at IS NULL
         FOR UPDATE`,
        [id],
      );
      await client.query(
        `UPDATE partner_institutions
         SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id],
      );
      if (current.rows[0]) {
        const userId = current.rows[0].supervisor_user_id;
        await client.query(
          `UPDATE partner_institution_supervisor_history
           SET ended_at = CURRENT_TIMESTAMP, end_reason = 'institution_deactivated'
           WHERE institution_id = $1 AND supervisor_user_id = $2 AND ended_at IS NULL`,
          [id, userId],
        );
        await deactivateAccount(client, userId);
      }
      return { institutionId: id, alreadyInactive: false };
    });
    res.json({ message: 'Partner institution deactivated.', ...result });
  } catch (err) {
    sendError(res, err, 'Deactivate partner institution');
  }
};

const reactivatePartnerInstitution = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) throw new RequestError(400, 'Invalid institution ID.');
    const result = await pool.query(
      `UPDATE partner_institutions
       SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, name, industry, description, address, is_active, created_at`,
      [id],
    );
    if (!result.rows[0]) throw new RequestError(404, 'Partner institution not found.');
    res.json({ institution: result.rows[0] });
  } catch (err) {
    sendError(res, err, 'Reactivate partner institution');
  }
};

const replacePartnerSupervisor = async (req, res) => {
  try {
    const institutionId = parseId(req.params.id);
    if (!institutionId) throw new RequestError(400, 'Invalid institution ID.');
    const supervisor = parseSupervisor(req.body || {});
    const assigned = await inTransaction(async (client) => {
      const institutionResult = await client.query(
        `SELECT id, name, address, is_active
         FROM partner_institutions WHERE id = $1 FOR UPDATE`,
        [institutionId],
      );
      const institution = institutionResult.rows[0];
      if (!institution) throw new RequestError(404, 'Partner institution not found.');
      if (!institution.is_active) throw new RequestError(409, 'Reactivate the institution before assigning a supervisor.');

      const current = await client.query(
        `SELECT supervisor_user_id
         FROM partner_institution_supervisor_history
         WHERE institution_id = $1 AND ended_at IS NULL
         FOR UPDATE`,
        [institutionId],
      );
      if (current.rows[0]) {
        const oldSupervisorId = current.rows[0].supervisor_user_id;
        await assertNoOpenPartnerDeployments(client, institutionId, oldSupervisorId);
        await client.query(
          `UPDATE partner_institution_supervisor_history
           SET ended_at = CURRENT_TIMESTAMP, end_reason = 'replaced'
           WHERE institution_id = $1 AND supervisor_user_id = $2 AND ended_at IS NULL`,
          [institutionId, oldSupervisorId],
        );
        await deactivateAccount(client, oldSupervisorId);
      }
      return createSupervisorAssignment(
        client,
        institution,
        supervisor,
        req.user.id,
      );
    });
    const emailNotification = await sendActivationEmail(assigned);
    res.status(201).json({
      supervisor: {
        ...assigned.user,
        first_name: assigned.firstName,
        last_name: assigned.lastName,
      },
      emailNotification,
    });
  } catch (err) {
    sendError(res, err, 'Assign partner supervisor');
  }
};

const updatePartnerSupervisor = async (req, res) => {
  try {
    const institutionId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (!institutionId || !userId) throw new RequestError(400, 'Invalid institution or supervisor ID.');
    const supervisor = parseSupervisor(req.body || {});
    const updated = await inTransaction(async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [`partner-supervisor-email:${supervisor.email}`],
      );
      const assignment = await client.query(
        `SELECT h.id, i.name
         FROM partner_institution_supervisor_history h
         JOIN partner_institutions i ON i.id = h.institution_id
         WHERE h.institution_id = $1 AND h.supervisor_user_id = $2
           AND h.ended_at IS NULL AND i.is_active = TRUE
         FOR UPDATE OF h`,
        [institutionId, userId],
      );
      if (!assignment.rows[0]) {
        throw new RequestError(404, 'The assigned supervisor was not found or is no longer active.');
      }

      const duplicate = await client.query(
        'SELECT id FROM users WHERE lower(email) = $1 AND id <> $2 LIMIT 1',
        [supervisor.email, userId],
      );
      if (duplicate.rows.length) throw new RequestError(409, 'That email address already belongs to another account.');

      const userResult = await client.query(
        `UPDATE users
         SET email = $1, phone = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND role = 'supervisor'
         RETURNING id, email, phone, status`,
        [supervisor.email, supervisor.phone, userId],
      );
      if (!userResult.rows[0]) throw new RequestError(404, 'Supervisor account not found.');
      await client.query(
        `UPDATE supervisors
         SET first_name = $1, last_name = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3`,
        [supervisor.firstName, supervisor.lastName, userId],
      );
      return {
        ...userResult.rows[0],
        first_name: supervisor.firstName,
        last_name: supervisor.lastName,
      };
    });

    let emailNotification = null;
    if (updated.status === 'pending_activation') {
      const resend = await studentActivation.resendTemporaryPassword(
        updated,
        'supervisor',
      );
      emailNotification = {
        sent: Boolean(resend.emailSent),
        message: resend.emailSent
          ? 'Updated supervisor login details emailed.'
          : resend.emailError || 'Supervisor details updated, but credentials could not be emailed.',
      };
    }
    res.json({ supervisor: updated, emailNotification });
  } catch (err) {
    sendError(res, err, 'Update partner supervisor');
  }
};

const deactivatePartnerSupervisor = async (req, res) => {
  try {
    const institutionId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (!institutionId || !userId) throw new RequestError(400, 'Invalid institution or supervisor ID.');
    await inTransaction(async (client) => {
      await client.query('SELECT id FROM partner_institutions WHERE id = $1 FOR UPDATE', [institutionId]);
      await assertNoOpenPartnerDeployments(client, institutionId, userId);
      const assignment = await client.query(
        `SELECT id
         FROM partner_institution_supervisor_history
         WHERE institution_id = $1 AND supervisor_user_id = $2 AND ended_at IS NULL
         FOR UPDATE`,
        [institutionId, userId],
      );
      if (!assignment.rows[0]) throw new RequestError(404, 'Active supervisor assignment not found.');
      await client.query(
        `UPDATE partner_institution_supervisor_history
         SET ended_at = CURRENT_TIMESTAMP, end_reason = 'deactivated'
         WHERE id = $1`,
        [assignment.rows[0].id],
      );
      await deactivateAccount(client, userId);
    });
    res.json({ message: 'Supervisor deactivated. The institution and assignment history were retained.' });
  } catch (err) {
    sendError(res, err, 'Deactivate partner supervisor');
  }
};

const resendPartnerSupervisorActivation = async (req, res) => {
  try {
    const institutionId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (!institutionId || !userId) throw new RequestError(400, 'Invalid institution or supervisor ID.');
    const lookup = await pool.query(
      `SELECT u.id, u.email, u.status, s.first_name, s.last_name
       FROM partner_institution_supervisor_history h
       JOIN partner_institutions i ON i.id = h.institution_id AND i.is_active = TRUE
       JOIN users u ON u.id = h.supervisor_user_id AND u.role = 'supervisor'
       JOIN supervisors s ON s.user_id = u.id
       WHERE h.institution_id = $1 AND h.supervisor_user_id = $2
         AND h.ended_at IS NULL`,
      [institutionId, userId],
    );
    const supervisor = lookup.rows[0];
    if (!supervisor) throw new RequestError(404, 'Active supervisor assignment not found.');
    if (supervisor.status !== 'pending_activation') {
      throw new RequestError(409, 'This supervisor account is no longer awaiting activation.');
    }
    const result = await studentActivation.resendTemporaryPassword(
      supervisor,
      'supervisor',
    );
    if (!result.eligible) {
      throw new RequestError(409, 'This supervisor account is no longer awaiting activation.');
    }
    res.json({
      emailNotification: {
        sent: Boolean(result.emailSent),
        message: result.emailSent
          ? `Temporary login credentials emailed. They expire in ${studentActivation.TEMPORARY_PASSWORD_TTL_HOURS} hours.`
          : result.emailError || 'Credentials were rotated, but the email could not be sent.',
      },
    });
  } catch (err) {
    sendError(res, err, 'Resend supervisor activation');
  }
};

module.exports = {
  listPartnerInstitutions,
  createPartnerInstitution,
  updatePartnerInstitution,
  deactivatePartnerInstitution,
  reactivatePartnerInstitution,
  replacePartnerSupervisor,
  updatePartnerSupervisor,
  deactivatePartnerSupervisor,
  resendPartnerSupervisorActivation,
};
