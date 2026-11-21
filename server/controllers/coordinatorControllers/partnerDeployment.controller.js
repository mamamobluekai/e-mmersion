const pool = require('../../db');
const { nowInManilaDateOnly } = require('../../utils/manilaDate');
const { loadExcludedDates } = require('../../utils/immersionDays');
const { createNotification } = require('../../services/notification.service');
const { getIO } = require('../../sockets');
const { getActiveDocumentTypes, ensureRequirementReviewSchema } = require('./regexes/requirementsHelpers');
const {
  requireThat, positiveId, note, dateAfter, capacity, strandKey, acceptedStrands,
  proposedDates, buildConfirmedDates, attendanceWindows,
} = require('../../services/partnerDeploymentPolicy');

const statuses = ['pending', 'approved', 'changes_requested', 'rejected', 'cancelled'];
const activeAccount = "lower(u.status) IN ('approved', 'active')";
const affiliations = `
  SELECT institution_id, supervisor_user_id FROM partner_institution_supervisor_history WHERE ended_at IS NULL
  UNION
  SELECT institution_id, supervisor_user_id FROM partner_deployment_supervisors`;
const requestDetails = `
  SELECT dr.id, dr.coordinator_id, dr.supervisor_id, dr.teacher_id, dr.immersion_period_id, dr.teacher_batch_id,
    dr.partner_institution_id, dr.status, dr.revision, dr.created_at, dr.updated_at,
    dr.proposal, dr.confirmed_schedule, dr.schedule_amendment, dr.school_clearance,
    pi.name AS partner_name, pi.address AS partner_address, pi.industry,
    concat_ws(' ', t.first_name, t.last_name) AS teacher_name,
    concat_ws(' ', sv.first_name, sv.last_name) AS supervisor_name,
    concat_ws(' ', c.first_name, c.last_name) AS coordinator_name,
    ip.period_name, ip.required_hours
  FROM deployment_requests dr
  JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
  JOIN teachers t ON t.id = dr.teacher_id
  JOIN supervisors sv ON sv.user_id = dr.supervisor_id
  LEFT JOIN coordinators c ON c.user_id = dr.coordinator_id
  JOIN immersion_periods ip ON ip.id = dr.immersion_period_id`;

const eligibleStudents = `
  SELECT s.id, s.user_id, s.first_name, s.last_name, s.track_strand, s.section
  FROM students s JOIN users u ON u.id = s.user_id
  JOIN student_requirement_submissions sr ON sr.student_id = s.id AND sr.user_id = u.id
  WHERE s.archived_at IS NULL AND u.role = 'student' AND ${activeAccount}
    AND lower(sr.status) = 'approved' AND sr.progress = 100
    AND u.immersion_period_id = $1
    AND ($2::text[] IS NULL OR lower(btrim(s.track_strand)) = ANY($2::text[]))
    AND NOT EXISTS (
      SELECT 1 FROM unnest($5::int[]) required(document_type_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM student_requirement_statuses review WHERE review.submission_id = sr.id
          AND review.document_type_id = required.document_type_id AND review.status = 'APPROVED'
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM teacher_batch_students tbs JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id
      WHERE tbs.student_id = s.id AND tbs.deployment_ended_on IS NULL AND tb.archived_at IS NULL
        AND (tb.id = $3 OR NOT EXISTS (
          SELECT 1 FROM work_immersion_schedules wis WHERE wis.teacher_batch_id = tb.id
          HAVING max(wis.end_date) < $4::date
        ))
    )`;

function endpoint(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '42P01' || error.code === '42703') {
        return res.status(503).json({ error: 'Partner deployments require database migration 044.' });
      }
      console.error('Partner deployments:', error);
      return res.status(500).json({ error: 'Unable to process the deployment. Please try again.' });
    }
  };
}

async function transaction(operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function reference(id) {
  return `WI-${String(id).padStart(6, '0')}`;
}

function classify(row, today = nowInManilaDateOnly()) {
  const schedule = row.confirmed_schedule;
  const schedule_status = row.status === 'cancelled' && schedule ? 'cancelled' :
    !schedule ? 'not_scheduled' : today < schedule.start ? 'upcoming' :
      today > schedule.end ? 'completed' : 'ongoing';
  return { ...row, reference: reference(row.id), schedule_status };
}

function canSee(req, row) {
  return req.user.role === 'admin' || Number(req.user.id) ===
    (req.user.role === 'supervisor' ? row.supervisor_id : row.coordinator_id);
}

async function scope(client, req, lock = false) {
  const id = positiveId(req.params.id);
  const { rows: [row] } = await client.query(
    `${requestDetails} WHERE dr.id = $1 AND dr.workflow_version = 2 ${lock ? 'FOR UPDATE OF dr' : ''}`, [id]);
  requireThat(row && canSee(req, row), 'Deployment request not found.', 404);
  if (lock) requireThat(Number(req.body.revision) === row.revision,
    'This request changed. Refresh it and try again.', 409);
  return row;
}

async function event(client, row, actor, action, before, after, reason = null) {
  await client.query(`
    INSERT INTO partner_deployment_events (deployment_request_id, actor_id, action, before_state, after_state, reason)
    VALUES ($1, $2, $3, $4, $5, $6)`, [row.id, actor, action, before, after, reason]);
}

async function notify(row, userId, text, revision) {
  if (!userId) return;
  const actionUrl = userId === row.supervisor_id ? '/dashboard/supervisor/deployment-requests' :
    userId === row.coordinator_id ? '/dashboard/coordinator/deployment' : '/dashboard/student/immersion-proper/placement-status';
  try {
    await createNotification({
      userId, title: `Deployment ${reference(row.id)}`, message: text,
      category: 'deployment', actionUrl: `${actionUrl}${userId === row.supervisor_id || userId === row.coordinator_id ? `?request=${row.id}` : ''}`,
      entityType: 'deployment_request', entityId: row.id, eventKey: `partner-deployment:${row.id}:${revision}`,
    });
  } catch (error) {
    console.error('Partner deployment notification:', error.message);
  }
}

async function catalog(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT btrim(s.track_strand) AS strand
    FROM students s JOIN users u ON u.id = s.user_id
    WHERE u.role = 'student' AND NULLIF(btrim(s.track_strand), '') IS NOT NULL
    ORDER BY strand`);
  return rows.map((row) => row.strand);
}

async function schoolPeriod(client, id) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM immersion_periods WHERE id = $1 AND is_active = true FOR SHARE', [id]);
  requireThat(row && Number(row.required_hours) > 0, 'Select an active school immersion period with configured required hours.');
  return row;
}

async function verifyParties(client, partnerId, teacherId, supervisorId = null, { allowPendingActivation = false } = {}) {
  const { rows: [partner] } = await client.query(
    'SELECT id, name FROM partner_institutions WHERE id = $1 AND is_active = true FOR SHARE', [partnerId]);
  requireThat(partner, 'Select an active partner institution.');
  const { rowCount } = await client.query(`
    SELECT 1 FROM teachers t JOIN users u ON u.id = t.user_id
    WHERE t.id = $1 AND u.role = 'teacher' AND ${activeAccount}`, [teacherId]);
  requireThat(rowCount, 'Select an active immersion teacher.');
  const supervisorSource = supervisorId === null
    ? 'SELECT institution_id, supervisor_user_id FROM partner_institution_supervisor_history WHERE ended_at IS NULL'
    : affiliations;
  const { rows: [supervisor] } = await client.query(`
    SELECT u.id FROM (${supervisorSource}) a
    JOIN users u ON u.id = a.supervisor_user_id
    JOIN supervisors sv ON sv.user_id = u.id
    WHERE a.institution_id = $1 AND ($2::int IS NULL OR u.id = $2)
      AND u.role = 'supervisor'
      AND (${activeAccount} OR ($3::boolean AND lower(u.status) = 'pending_activation'))`,
  [partnerId, supervisorId, allowPendingActivation]);
  requireThat(supervisor, supervisorId === null
    ? 'This partner needs a registered supervisor with an active account or a pending activation invitation.'
    : 'The supervisor assigned to this request must be active and authorized for the partner.', 409);
  return { partner, supervisorId: supervisor.id };
}

const options = endpoint(async (req) => {
  const partnerId = req.query.partner ? positiveId(req.query.partner) : null;
  const periodId = req.query.period ? positiveId(req.query.period) : null;
  const [periods, teachers, supervisors, strands, authorised] = await Promise.all([
    pool.query(`SELECT id, period_name, start_date, end_date, required_hours FROM immersion_periods
      WHERE is_active AND end_date >= $1 ORDER BY start_date DESC`, [nowInManilaDateOnly()]),
    req.user.role === 'supervisor' ? { rows: [] } : pool.query(`
      SELECT t.id, concat_ws(' ', t.first_name, t.last_name) AS name
      FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.role = 'teacher' AND ${activeAccount} ORDER BY name`),
    req.user.role === 'supervisor' ? { rows: [] } : pool.query(`
      SELECT DISTINCT sv.user_id AS id, concat_ws(' ', sv.first_name, sv.last_name) AS name
      FROM supervisors sv JOIN users u ON u.id = sv.user_id
      WHERE u.role = 'supervisor' AND ${activeAccount} ORDER BY name`),
    catalog(pool),
    partnerId && req.user.role !== 'supervisor' ? pool.query(`
      SELECT a.supervisor_user_id AS id, a.supervisor_user_id = h.supervisor_user_id AS "primary",
        lower(u.status) AS account_status
      FROM (${affiliations}) a
      JOIN users u ON u.id = a.supervisor_user_id AND u.role = 'supervisor'
      JOIN supervisors sv ON sv.user_id = u.id
      LEFT JOIN partner_institution_supervisor_history h
        ON h.institution_id = a.institution_id AND h.supervisor_user_id = a.supervisor_user_id AND h.ended_at IS NULL
      WHERE a.institution_id = $1`, [partnerId]) : { rows: [] },
  ]);
  return { periods: periods.rows, teachers: teachers.rows, supervisors: supervisors.rows, strands,
    authorised: authorised.rows, today: nowInManilaDateOnly(), earliest: dateAfter(nowInManilaDateOnly(), 7) };
});

const partners = endpoint(async (req) => {
  const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
  const size = 12;
  const coordinator = req.user.role === 'admin' ? null : req.user.id;
  const active = req.query.active === 'all' ? null : req.query.active !== 'inactive';
  const supervisor = req.query.supervisor ? positiveId(req.query.supervisor) : null;
  const status = statuses.includes(req.query.status) ? req.query.status : null;
  const teacher = ['assigned', 'unassigned'].includes(req.query.teacher) ? req.query.teacher : null;
  const filter = `
    FROM partner_institutions pi
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS request_count, max(id) AS latest_id,
        COALESCE(bool_or(status IN ('pending', 'changes_requested')), false) AS has_unresolved_request
      FROM deployment_requests dr WHERE dr.partner_institution_id = pi.id AND dr.workflow_version = 2
        AND ($1::int IS NULL OR dr.coordinator_id = $1)
    ) work ON true
    LEFT JOIN deployment_requests dr ON dr.id = work.latest_id
    LEFT JOIN partner_institution_supervisor_history h ON h.institution_id = pi.id AND h.ended_at IS NULL
    LEFT JOIN supervisors sv ON sv.user_id = COALESCE(dr.supervisor_id, h.supervisor_user_id)
    LEFT JOIN teachers t ON t.id = dr.teacher_id
    WHERE ($2::boolean IS NULL OR pi.is_active = $2) AND strpos(lower(pi.name), lower($3)) > 0
      AND ($4::int IS NULL OR EXISTS (
        SELECT 1 FROM (${affiliations}) a WHERE a.institution_id = pi.id AND a.supervisor_user_id = $4
      ) OR EXISTS (
        SELECT 1 FROM deployment_requests r WHERE r.partner_institution_id = pi.id AND r.workflow_version = 2
          AND r.supervisor_id = $4 AND ($1::int IS NULL OR r.coordinator_id = $1)
      ))
      AND ($5::text IS NULL OR EXISTS (
        SELECT 1 FROM deployment_requests r WHERE r.partner_institution_id = pi.id AND r.workflow_version = 2
          AND r.status = $5 AND ($1::int IS NULL OR r.coordinator_id = $1)
      ))
      AND ($6::text IS NULL OR ($6 = 'assigned' AND dr.teacher_id IS NOT NULL)
        OR ($6 = 'unassigned' AND dr.teacher_id IS NULL))`;
  const args = [coordinator, active, note(req.query.search, { max: 255 }), supervisor, status, teacher];
  const [data, count] = await Promise.all([
    pool.query(`SELECT pi.*, work.request_count, work.has_unresolved_request, dr.id AS latest_request_id, dr.status,
      dr.num_students, dr.confirmed_schedule,
      concat_ws(' ', t.first_name, t.last_name) AS teacher_name,
      concat_ws(' ', sv.first_name, sv.last_name) AS supervisor_name
      ${filter} ORDER BY lower(pi.name), pi.id LIMIT $7 OFFSET $8`, [...args, size, (page - 1) * size]),
    pool.query(`SELECT count(*)::int AS total ${filter}`, args),
  ]);
  return { partners: data.rows.map((row) => ({ ...row, schedule_status: classify(row).schedule_status })),
    page, pages: Math.max(1, Math.ceil(count.rows[0].total / size)) };
});

const partnerDetail = endpoint(async (req) => {
  const { rows: [partner] } = await pool.query(
    `SELECT pi.id, pi.name, pi.industry, pi.address, pi.description, pi.is_active,
      EXISTS (SELECT 1 FROM deployment_requests dr
        WHERE dr.partner_institution_id = pi.id AND dr.workflow_version = 2
          AND dr.status IN ('pending', 'changes_requested')
          AND ($2::int IS NULL OR dr.coordinator_id = $2)) AS has_unresolved_request
      FROM partner_institutions pi WHERE pi.id = $1`,
    [positiveId(req.params.partnerId), req.user.role === 'coordinator' ? req.user.id : null]);
  requireThat(partner, 'Partner institution not found.', 404);
  return { partner };
});

const list = endpoint(async (req) => {
  const partner = req.query.partner ? positiveId(req.query.partner) : null;
  const status = statuses.includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(`${requestDetails}
    WHERE dr.workflow_version = 2 AND ($1::int IS NULL OR dr.coordinator_id = $1)
      AND ($2::int IS NULL OR dr.supervisor_id = $2)
      AND ($3::int IS NULL OR dr.partner_institution_id = $3) AND ($4::text IS NULL OR dr.status = $4)
    ORDER BY dr.created_at DESC, dr.id DESC`,
  [req.user.role === 'coordinator' ? req.user.id : null, req.user.role === 'supervisor' ? req.user.id : null, partner, status]);
  return { requests: rows.map((row) => classify(row)) };
});

async function getRoster(client, batchId) {
  if (!batchId) return [];
  const { rows } = await client.query(`
    SELECT s.id, s.user_id, s.first_name, s.last_name, s.track_strand, s.section,
      tbs.deployment_started_on, tbs.deployment_ended_on
    FROM teacher_batch_students tbs JOIN students s ON s.id = tbs.student_id
    WHERE tbs.teacher_batch_id = $1 ORDER BY s.last_name, s.first_name`, [batchId]);
  return rows;
}

const detail = endpoint(async (req) => {
  const row = await scope(pool, req);
  const [roster, history, strands] = await Promise.all([
    getRoster(pool, row.teacher_batch_id),
    pool.query(`SELECT e.id, e.actor_id, e.action, e.reason, e.created_at, u.role AS actor_role,
      COALESCE(NULLIF(concat_ws(' ', c.first_name, c.last_name), ''),
        NULLIF(concat_ws(' ', sv.first_name, sv.last_name), ''),
        NULLIF(concat_ws(' ', a.first_name, a.last_name), '')) AS actor_name
      FROM partner_deployment_events e
      LEFT JOIN users u ON u.id = e.actor_id
      LEFT JOIN coordinators c ON c.user_id = u.id
      LEFT JOIN supervisors sv ON sv.user_id = u.id
      LEFT JOIN admins a ON a.user_id = u.id
      WHERE e.deployment_request_id = $1 AND ($2::boolean OR e.action NOT IN ('student_allocated','student_withdrawn','student_replaced'))
      ORDER BY e.id DESC`, [row.id, req.user.role !== 'supervisor']),
    catalog(pool),
  ]);
  const active = roster.filter((student) => !student.deployment_ended_on).length;
  const seats = row.confirmed_schedule?.capacity || 0;
  return { request: classify(row), roster: req.user.role === 'supervisor' ? roster.filter((student) => !student.deployment_ended_on) : roster,
    history: history.rows, strands, active, remaining: Math.max(0, seats - active),
    allocation_status: !active ? 'not_started' : active >= seats ? 'fully_filled' : 'partially_filled' };
});

async function readProposal(client, req, partnerId, assignedSupervisorId = null) {
  const input = req.body;
  const teacherId = positiveId(input.teacher_id);
  const periodId = positiveId(input.period_id);
  const { partner, supervisorId } = await verifyParties(client, partnerId, teacherId, assignedSupervisorId,
    { allowPendingActivation: true });
  const period = await schoolPeriod(client, periodId);
  proposedDates(input.start, input.end, period, nowInManilaDateOnly());
  const seats = capacity(input.capacity);
  const { strands } = acceptedStrands(input.strands, await catalog(client), seats);
  return { teacherId, supervisorId, periodId, partner, seats,
    proposal: { start: input.start, end: input.end || null, capacity: seats, strands,
      worksite: note(input.worksite, { required: true }),
      notes: note(input.notes) } };
}

const create = endpoint(async (req) => {
  const partnerId = positiveId(req.body.partner_id);
  const key = req.body.creation_key;
  requireThat(typeof key === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(key), 'Invalid submission key.');
  const result = await transaction(async (client) => {
    const existing = await client.query('SELECT id FROM deployment_requests WHERE coordinator_id = $1 AND creation_key = $2', [req.user.id, key]);
    if (existing.rowCount) return { id: existing.rows[0].id };
    const coord = await client.query('SELECT id FROM coordinators WHERE user_id = $1', [req.user.id]);
    requireThat(coord.rowCount, 'A coordinator profile is required to submit a request.');
    const partner = await client.query(
      'SELECT id FROM partner_institutions WHERE id = $1 FOR UPDATE', [partnerId]);
    requireThat(partner.rowCount, 'Partner institution not found.', 404);
    const retry = await client.query(
      'SELECT id FROM deployment_requests WHERE coordinator_id = $1 AND creation_key = $2',
      [req.user.id, key]);
    if (retry.rowCount) return { id: retry.rows[0].id };
    const unresolved = await client.query(`
      SELECT id FROM deployment_requests
      WHERE coordinator_id = $1 AND partner_institution_id = $2 AND workflow_version = 2
        AND status IN ('pending', 'changes_requested')
      LIMIT 1`, [req.user.id, partnerId]);
    requireThat(!unresolved.rowCount,
      'A deployment request for this partner is awaiting supervisor approval. You can create another after it is accepted and the connection is established.', 409);
    const data = await readProposal(client, req, partnerId);
    const response = await client.query(`
      INSERT INTO deployment_requests (coordinator_id, supervisor_id, batch_label, num_students, notes, direction,
        workflow_version, partner_institution_id, teacher_id, immersion_period_id, proposal, creation_key)
      VALUES ($1,$2,$3,$4,$5,'coordinator_to_supervisor',2,$6,$7,$8,$9,$10)
      ON CONFLICT (coordinator_id, creation_key) WHERE creation_key IS NOT NULL DO NOTHING RETURNING *`,
    [req.user.id, data.supervisorId, data.partner.name, data.seats, data.proposal.notes, partnerId,
      data.teacherId, data.periodId, data.proposal, key]);
    if (!response.rowCount) {
      const retry = await client.query('SELECT id FROM deployment_requests WHERE coordinator_id = $1 AND creation_key = $2', [req.user.id, key]);
      return { id: retry.rows[0].id };
    }
    const row = response.rows[0];
    await event(client, row, req.user.id, 'submitted', null,
      { ...data.proposal, teacher_id: data.teacherId, supervisor_id: data.supervisorId, period_id: data.periodId });
    return { id: row.id, row };
  });
  if (result.row) await notify(result.row, result.row.supervisor_id, 'A partner deployment request is ready for review.', 0);
  return { id: result.id };
});

async function changeRequest(req, getChange) {
  const result = await transaction(async (client) => {
    const row = await scope(client, req, true);
    const change = await getChange(client, row);
    const { rows: [updated] } = await client.query(
      `UPDATE deployment_requests SET ${change.update}, revision = revision + 1, updated_at = now()
       WHERE id = $1 RETURNING *`, [row.id, ...change.values]);
    await event(client, row, req.user.id, change.action, change.before, change.after, change.reason);
    return { updated, change };
  });
  const { updated, change } = result;
  if (change.removedUsers?.length && updated.teacher_batch_id) {
    try {
      const io = getIO();
      for (const user of change.removedUsers) {
        io.in(`user:${user}`).socketsLeave(`chat:batch:${updated.teacher_batch_id}`);
        io.in(`user:${user}`).socketsLeave(`batch:${updated.teacher_batch_id}`);
      }
    } catch (error) {
      console.error('Partner deployment room update:', error.message);
    }
  }
  await Promise.all([...new Set(change.recipients || [])].map((userId) =>
    notify(updated, userId, change.message, updated.revision)));
  return { id: updated.id, revision: updated.revision };
}

const review = endpoint(async (req) => changeRequest(req, async (client, row) => {
  requireThat(row.status === 'pending', 'Only pending requests can be reviewed.', 409);
  const status = req.body.status;
  requireThat(['approved', 'changes_requested', 'rejected'].includes(status), 'Choose a review decision.');
  const reason = note(req.body.reason, { required: status !== 'approved' || req.user.role === 'admin' });
  if (status === 'approved') await verifyParties(client, row.partner_institution_id, row.teacher_id, row.supervisor_id);
  return { update: 'status = $2, responded_at = now()', values: [status], action: status,
    before: { status: row.status }, after: { status }, reason, recipients: [row.coordinator_id],
    message: status === 'approved' ? 'The proposal was approved and is ready for scheduling.' :
      status === 'rejected' ? 'The proposal was rejected. Open the request for the reason.' :
        'The supervisor requested changes. Review the feedback and resubmit.' };
}));

const resubmit = endpoint(async (req) => changeRequest(req, async (client, row) => {
  requireThat(row.status === 'changes_requested', 'Only returned requests can be resubmitted.', 409);
  const data = await readProposal(client, req, row.partner_institution_id, row.supervisor_id);
  return { update: "status = 'pending', responded_at = NULL, teacher_id = $2, immersion_period_id = $3, num_students = $4, notes = $5, proposal = $6",
    values: [data.teacherId, data.periodId, data.seats, data.proposal.notes, data.proposal],
    action: 'resubmitted', before: { ...row.proposal, teacher_id: row.teacher_id, supervisor_id: row.supervisor_id },
    after: { ...data.proposal, teacher_id: data.teacherId, supervisor_id: data.supervisorId },
    recipients: [data.supervisorId], message: 'The coordinator resubmitted a deployment request for review.' };
}));

async function findOverlaps(client, row, schedule) {
  const { rows } = await client.query(`
    SELECT dr.id, pi.name AS partner_name,
      dr.teacher_id = $2 AS teacher, dr.supervisor_id = $3 AS supervisor,
      dr.partner_institution_id = $4 AS partner
    FROM deployment_requests dr JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
    WHERE dr.id <> $1 AND dr.workflow_version = 2 AND dr.status = 'approved'
      AND (dr.teacher_id = $2 OR dr.supervisor_id = $3 OR dr.partner_institution_id = $4)
      AND (dr.confirmed_schedule->'dates') ?| $5::text[]
    UNION ALL
    SELECT NULL, tb.batch_label, tb.teacher_id = $2, tb.supervisor_id = $3, false
    FROM teacher_batches tb JOIN work_immersion_schedules wis ON wis.teacher_batch_id = tb.id
    WHERE tb.partner_institution_id IS NULL AND tb.archived_at IS NULL
      AND (tb.teacher_id = $2 OR tb.supervisor_id = $3)
      AND wis.start_date <= $7::date AND (wis.end_date IS NULL OR wis.end_date >= $6::date)
    LIMIT 12`, [row.id, row.teacher_id, row.supervisor_id, row.partner_institution_id, schedule.dates, schedule.start, schedule.end]);
  return rows.map((item) => ({
    reference: item.id ? reference(item.id) : null,
    // A supervisor can review the conflict without seeing another deployment's details.
    resources: ['teacher', 'supervisor', 'partner'].filter((resource) => item[resource]),
  }));
}

async function validateSchedule(client, row, input, blocked, previous) {
  const today = nowInManilaDateOnly();
  const period = await schoolPeriod(client, row.immersion_period_id);
  const extraBlocked = input.excluded_dates || [];
  const dates = buildConfirmedDates({ start: input.start, end: input.end, blocked, extraBlocked, period, previous, today });
  const seats = capacity(input.capacity);
  requireThat(seats <= row.proposal.capacity, 'Confirmed capacity cannot exceed the coordinator’s request.');
  const { strands, caps } = acceptedStrands(input.strands, await catalog(client), seats, input.caps);
  const hours = Number(input.daily_hours);
  requireThat(Number.isInteger(hours) && hours >= 1 && hours <= 8, 'Enter one to eight scheduled hours per workday.');
  const windows = attendanceWindows(input.windows);
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  requireThat(minutes(windows.time_out_open) - minutes(windows.time_in_open) >= hours * 60,
    'The attendance windows must leave enough time for the configured daily hours.');
  if (previous && previous.start <= today) {
    requireThat(hours === previous.daily_hours, 'Scheduled daily hours are fixed once the placement begins.');
    requireThat(!previous.dates.includes(today) || Object.keys(windows).every((key) => windows[key] === previous.windows[key]),
      'Today’s attendance windows must be preserved. Update those hours on a non-workday.');
  }
  requireThat(dates.length * hours >= Number(period.required_hours),
    `These workdays provide ${dates.length * hours} of the ${period.required_hours} hours required for the cohort.`);
  const roster = (await getRoster(client, row.teacher_batch_id)).filter((student) => !student.deployment_ended_on);
  requireThat(roster.length <= seats, 'Resolve existing roster assignments before reducing capacity.', 409);
  for (const student of roster) {
    const strand = strandKey(student.track_strand);
    const quota = caps[strand];
    requireThat(!strands || strands.some((accepted) => strandKey(accepted) === strand),
      'The amended strands must include all currently assigned students.', 409);
    requireThat(!quota || roster.filter((candidate) => strandKey(candidate.track_strand) === strand).length <= quota,
      'The amended strand caps must accommodate the current roster.', 409);
  }
  return { start: input.start, end: input.end, dates, required_hours: Number(period.required_hours),
    excluded_dates: [...new Set(extraBlocked)].sort(), capacity: seats,
    strands, caps, daily_hours: hours, windows, notes: note(input.notes) };
}

const setSchedule = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  return changeRequest(req, async (client, row) => {
    requireThat(row.status === 'approved', 'The supervisor must approve the request before scheduling.', 409);
    const previous = row.confirmed_schedule;
    requireThat(!previous || previous.end >= nowInManilaDateOnly(), 'Completed placements retain their schedule.', 409);
    await verifyParties(client, row.partner_institution_id, row.teacher_id, row.supervisor_id);
    const reason = note(req.body.reason, { required: Boolean(previous) || req.user.role === 'admin' });
    const schedule = await validateSchedule(client, row, req.body, blocked, previous);
    const overlaps = await findOverlaps(client, row, schedule);
    requireThat(!overlaps.length || req.body.acknowledge_overlap === true,
      'The teacher, supervisor, or worksite has an overlapping deployment. Review availability and acknowledge the overlap.', 409);
    const stored = { ...schedule, overlap_acknowledged: overlaps.length > 0, overlapping_resources: overlaps };
    const amendment = Boolean(row.school_clearance);
    return { update: amendment ? 'schedule_amendment = $2' : 'confirmed_schedule = $2',
      values: [amendment ? { ...stored, reason } : stored], action: amendment ? 'amendment_proposed' : 'schedule_confirmed',
      before: previous, after: stored, reason, recipients: [row.coordinator_id],
      message: amendment ? 'The supervisor proposed a schedule amendment for school review.' :
        'The partner confirmed the schedule. School clearance is ready to record.' };
  });
});

async function publishSchedule(client, row, schedule, actor) {
  let batch = row.teacher_batch_id;
  if (!batch) {
    const { rows: [created] } = await client.query(`
      INSERT INTO teacher_batches (coordinator_id, teacher_id, batch_label, max_students, supervisor_id,
        immersion_period_id, partner_institution_id)
      SELECT c.id, $2, $3, $4, $5, $6, $7 FROM coordinators c WHERE c.user_id = $1 RETURNING id`,
    [row.coordinator_id, row.teacher_id, `${row.partner_name.slice(0, 225)} · ${reference(row.id)}`, schedule.capacity,
      row.supervisor_id, row.immersion_period_id, row.partner_institution_id]);
    requireThat(created, 'The requesting coordinator needs an active profile.');
    batch = created.id;
  } else {
    await client.query('UPDATE teacher_batches SET max_students = $2, updated_at = now() WHERE id = $1', [batch, schedule.capacity]);
    if (row.confirmed_schedule.start > nowInManilaDateOnly()) {
      await client.query(`UPDATE teacher_batch_students SET deployment_started_on = $2
        WHERE teacher_batch_id = $1 AND deployment_ended_on IS NULL`, [batch, schedule.start]);
    }
  }
  await client.query(`
    INSERT INTO work_immersion_schedules (teacher_batch_id, supervisor_id, duration_type, duration_value, start_date, end_date, created_by)
    VALUES ($1,$2,'days',$3,$4,$5,$6)
    ON CONFLICT (teacher_batch_id, supervisor_id) DO UPDATE SET duration_type = EXCLUDED.duration_type,
      duration_value = EXCLUDED.duration_value, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, updated_at = now()`,
  [batch, row.supervisor_id, schedule.dates.length, schedule.start, schedule.end, actor]);
  const times = schedule.windows;
  await client.query(`
    INSERT INTO attendance_config (teacher_batch_id, time_in_open, time_in_close, time_out_open, time_out_close)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (teacher_batch_id) DO UPDATE SET time_in_open = EXCLUDED.time_in_open, time_in_close = EXCLUDED.time_in_close,
      time_out_open = EXCLUDED.time_out_open, time_out_close = EXCLUDED.time_out_close, updated_at = now()`,
  [batch, times.time_in_open, times.time_in_close, times.time_out_open, times.time_out_close]);
  return batch;
}

const schoolClearance = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  return changeRequest(req, async (client, row) => {
    requireThat(row.status === 'approved' && row.confirmed_schedule && (!row.school_clearance || row.schedule_amendment),
      'A partner confirmation or pending amendment is required.', 409);
    const amendment = row.schedule_amendment;
    const input = amendment || row.confirmed_schedule;
    if (!amendment) requireThat(input.start > nowInManilaDateOnly(), 'The confirmed start has arrived. Ask the supervisor for a new schedule.', 409);
    const recorded = note(req.body.reference, { required: true, max: 255 });
    const checks = ['partner_agreement', 'worksite_safety', 'training_plan', 'learner_safeguards'];
    requireThat(checks.every((key) => req.body.checks?.[key] === true), 'Confirm all school clearance checks.');
    await verifyParties(client, row.partner_institution_id, row.teacher_id, row.supervisor_id);
    const schedule = await validateSchedule(client, row, input, blocked, row.confirmed_schedule);
    requireThat(schedule.dates.length === input.dates.length && schedule.dates.every((day, index) => day === input.dates[index]),
      'The school calendar changed. Ask the supervisor to confirm the updated workdays.', 409);
    const clearance = { reference: recorded, checks, actor: req.user.id, date: nowInManilaDateOnly() };
    const batch = await publishSchedule(client, row, schedule, req.user.id);
    const roster = amendment ? await getRoster(client, batch) : [];
    return { update: 'teacher_batch_id = $2, confirmed_schedule = $3, school_clearance = $4, schedule_amendment = NULL',
      values: [batch, { ...input, ...schedule }, clearance], action: amendment ? 'amendment_cleared' : 'school_cleared',
      before: amendment ? row.confirmed_schedule : null, after: { schedule, clearance }, reason: recorded,
      recipients: [row.supervisor_id, ...roster.filter((s) => !s.deployment_ended_on).map((s) => s.user_id)],
      message: amendment ? 'The school approved revised immersion workdays. Review the confirmed schedule.' :
        'The school cleared the placement. The coordinator can now allocate students.' };
  });
});

const returnSchedule = endpoint(async (req) => changeRequest(req, async (client, row) => {
  requireThat(row.status === 'approved' && row.confirmed_schedule && (!row.school_clearance || row.schedule_amendment),
    'There is no schedule awaiting school clearance.', 409);
  const reason = note(req.body.reason, { required: true });
  return { update: row.school_clearance ? 'schedule_amendment = NULL' : 'confirmed_schedule = NULL',
    values: [], action: 'schedule_returned', before: row.schedule_amendment || row.confirmed_schedule, after: null,
    reason, recipients: [row.supervisor_id], message: 'The school returned the schedule for changes.' };
}));

const cancel = endpoint(async (req) => changeRequest(req, async (client, row) => {
  const today = nowInManilaDateOnly();
  requireThat(!['cancelled', 'rejected'].includes(row.status) && (!row.teacher_batch_id || row.confirmed_schedule.start > today),
    'Only open requests and placements that have not started can be cancelled.', 409);
  const reason = note(req.body.reason, { required: true });
  const roster = await getRoster(client, row.teacher_batch_id);
  if (row.teacher_batch_id) {
    await client.query('UPDATE teacher_batches SET archived_at = now() WHERE id = $1', [row.teacher_batch_id]);
    await client.query(`UPDATE teacher_batch_students SET deployment_ended_on = $2
      WHERE teacher_batch_id = $1 AND deployment_ended_on IS NULL`, [row.teacher_batch_id, today]);
  }
  return { update: "status = 'cancelled', schedule_amendment = NULL", values: [], action: 'cancelled',
    before: { status: row.status }, after: { status: 'cancelled' }, reason,
    recipients: [row.supervisor_id, ...roster.filter((s) => !s.deployment_ended_on).map((s) => s.user_id)],
    removedUsers: roster.filter((s) => !s.deployment_ended_on).map((s) => s.user_id),
    message: 'This immersion deployment was cancelled.' };
}));

function canAllocate(row) {
  requireThat(row.status === 'approved' && row.teacher_batch_id && row.school_clearance &&
    row.confirmed_schedule.end >= nowInManilaDateOnly(),
  'Allocation opens after school clearance and closes when the placement ends.', 409);
}

async function eligibilityArgs(client, row) {
  const required = await getActiveDocumentTypes(client);
  return [row.immersion_period_id, row.confirmed_schedule.strands?.map(strandKey) || null,
    row.teacher_batch_id, nowInManilaDateOnly(), required.map((type) => type.id)];
}

const candidates = endpoint(async (req) => {
  const row = await scope(pool, req);
  canAllocate(row);
  await ensureRequirementReviewSchema();
  const search = note(req.query.search, { max: 100 });
  const { rows } = await pool.query(`${eligibleStudents}
    AND strpos(lower(concat_ws(' ', s.first_name, s.last_name, s.track_strand, s.section)), lower($6)) > 0
    ORDER BY s.last_name, s.first_name LIMIT 100`, [...await eligibilityArgs(pool, row), search]);
  return { students: rows };
});

async function rosterChange(client, row, req) {
  canAllocate(row);
  const add = req.body.add ? positiveId(req.body.add) : null;
  const remove = req.body.remove ? positiveId(req.body.remove) : null;
  requireThat((add || remove) && add !== remove, 'Choose a student to allocate, withdraw, or replace.');
  const reason = note(req.body.reason, { required: Boolean(remove) });
  const today = nowInManilaDateOnly();
  // Legacy roster assignment also locks student rows before checking for conflicts.
  await client.query('SELECT id FROM students WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
    [[add, remove].filter(Boolean)]);
  const roster = await getRoster(client, row.teacher_batch_id);
  const active = roster.filter((student) => !student.deployment_ended_on);
  const outgoing = active.find((student) => student.id === remove);
  requireThat(!remove || outgoing, 'This student is no longer on the active roster.', 409);
  const schedule = row.confirmed_schedule;
  const occupied = active.filter((student) => student.id !== remove);
  const recipients = [row.supervisor_id];
  let enteringOn = null;
  const leavingOn = today < schedule.start ? today : dateAfter(today, 1);
  if (remove) {
    await client.query(`UPDATE teacher_batch_students SET deployment_ended_on = $3
      WHERE teacher_batch_id = $1 AND student_id = $2`, [row.teacher_batch_id, remove, leavingOn]);
    recipients.push(outgoing.user_id);
  }
  if (add) {
    requireThat(occupied.length < schedule.capacity, 'All confirmed seats are filled.', 409);
    const { rows: [student] } = await client.query(`${eligibleStudents} AND s.id = $6 FOR SHARE OF u, sr`,
      [...await eligibilityArgs(client, row), add]);
    requireThat(student, 'This student is no longer eligible or already has an active deployment.', 409);
    const prior = roster.find((member) => member.id === add);
    requireThat(!prior || prior.deployment_ended_on <= prior.deployment_started_on,
      'This student already attended this deployment. Contact the school to reconcile the previous placement.', 409);
    const strand = strandKey(student.track_strand);
    const cap = schedule.caps[strand];
    requireThat(!cap || occupied.filter((member) => strandKey(member.track_strand) === strand).length < cap,
      'This strand has reached its confirmed cap.', 409);
    enteringOn = schedule.dates.find((date) => today < date);
    requireThat(enteringOn, 'There are no future workdays available for this student.', 409);
    await client.query(`
      INSERT INTO teacher_batch_students (teacher_batch_id, student_id, deployment_started_on)
      VALUES ($1,$2,$3)
      ON CONFLICT (teacher_batch_id, student_id) DO UPDATE
        SET deployment_started_on = EXCLUDED.deployment_started_on, deployment_ended_on = NULL, assigned_at = now()`,
    [row.teacher_batch_id, add, enteringOn]);
    recipients.push(student.user_id);
  }
  return { update: 'status = status', values: [], action: add && remove ? 'student_replaced' :
    add ? 'student_allocated' : 'student_withdrawn',
  before: remove ? { student_id: remove, ends_before: leavingOn } : null,
  after: add ? { student_id: add, starts_on: enteringOn } : null,
  reason, recipients, removedUsers: outgoing ? [outgoing.user_id] : [],
  message: 'The coordinator updated a student placement on this deployment.' };
}

const updateRoster = endpoint(async (req) => {
  await ensureRequirementReviewSchema();
  return changeRequest(req, (client, row) => rosterChange(client, row, req));
});

module.exports = {
  options, partners, partnerDetail, list, detail, create, review,
  resubmit, setSchedule, schoolClearance, returnSchedule, cancel, candidates, updateRoster,
};
