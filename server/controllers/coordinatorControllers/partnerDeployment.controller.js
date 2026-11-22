const pool = require('../../db');
const { isDeepStrictEqual } = require('node:util');
const { isValidManilaDate, nowInManilaDateOnly } = require('../../utils/manilaDate');
const { loadExcludedDates } = require('../../utils/immersionDays');
const { createNotification } = require('../../services/notification.service');
const { getIO } = require('../../sockets');
const { getActiveDocumentTypes, ensureRequirementReviewSchema } = require('./regexes/requirementsHelpers');
const {
  requireThat, positiveId, note, dateAfter, capacity, strandKey, acceptedStrands,
  REQUIRED_IMMERSION_HOURS, CREDITABLE_HOURS_PER_DAY,
  buildFixedDurationDates, proposalStudents,
} = require('../../services/partnerDeploymentPolicy');

const openStatuses = ['draft', 'pending', 'changes_requested', 'pending_coordinator_agreement'];
const statuses = [...openStatuses, 'approved', 'rejected', 'cancelled', 'ongoing', 'completed'];
const defaultWindows = { time_in_open: '08:00', time_in_close: '08:30', time_out_open: '17:00', time_out_close: '17:30' };
const standardSchedule = { required_hours: REQUIRED_IMMERSION_HOURS, daily_hours: CREDITABLE_HOURS_PER_DAY, windows: defaultWindows };
const activeAccount = "lower(u.status) IN ('approved', 'active')";
const affiliations = `
  SELECT institution_id, supervisor_user_id FROM partner_institution_supervisor_history WHERE ended_at IS NULL
  UNION
  SELECT institution_id, supervisor_user_id FROM partner_deployment_supervisors`;
const requestDetails = `
  SELECT dr.id, dr.coordinator_id, dr.supervisor_id, dr.teacher_id, dr.immersion_period_id, dr.teacher_batch_id,
    dr.partner_institution_id, dr.status, dr.revision, dr.created_at, dr.updated_at,
    dr.proposal, dr.original_proposal, dr.counterproposal, dr.agreement, dr.confirmed_schedule, dr.schedule_amendment,
    pi.name AS partner_name, pi.address AS partner_address, pi.industry,
    COALESCE(team.ids, ARRAY[t.id]::int[]) AS teacher_ids,
    COALESCE(team.users, ARRAY[t.user_id]::int[]) AS teacher_user_ids,
    COALESCE(team.names, concat_ws(' ', t.first_name, t.last_name)) AS teacher_name,
    concat_ws(' ', sv.first_name, sv.last_name) AS supervisor_name,
    concat_ws(' ', c.first_name, c.last_name) AS coordinator_name,
    ip.period_name, ip.required_hours
  FROM deployment_requests dr
  JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
  LEFT JOIN teachers t ON t.id = dr.teacher_id
  LEFT JOIN LATERAL (
    SELECT array_agg(teacher.id ORDER BY (teacher.id = dr.teacher_id) DESC, teacher.id) AS ids,
      array_agg(teacher.user_id) AS users,
      string_agg(concat_ws(' ', teacher.first_name, teacher.last_name), ', ' ORDER BY (teacher.id = dr.teacher_id) DESC, teacher.id) AS names
    FROM partner_deployment_teachers link JOIN teachers teacher ON teacher.id = link.teacher_id
    WHERE link.deployment_request_id = dr.id
  ) team ON true
  JOIN supervisors sv ON sv.user_id = dr.supervisor_id
  LEFT JOIN coordinators c ON c.user_id = dr.coordinator_id
  LEFT JOIN immersion_periods ip ON ip.id = dr.immersion_period_id`;

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
      WHERE tbs.student_id = s.id AND tb.archived_at IS NULL
        AND (tbs.deployment_ended_on IS NULL OR tbs.deployment_ended_on > $4::date)
        AND (tb.id = $3 OR EXISTS (
          SELECT 1 FROM work_immersion_schedules wis WHERE wis.teacher_batch_id = tb.id
            AND COALESCE(tbs.deployment_started_on, wis.start_date) <= $6::date
            AND COALESCE(wis.end_date, 'infinity'::date) >= $4::date
        ))
    )`;

function endpoint(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '42P01' || error.code === '42703') {
        return res.status(503).json({ error: 'Deployment agreements require database migrations 044 and 045.' });
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
  const status = row.status === 'approved' && row.teacher_batch_id && ['ongoing', 'completed'].includes(schedule_status)
    ? schedule_status : row.status;
  return { ...row, status, reference: reference(row.id), schedule_status };
}

function canSee(req, row) {
  return req.user.role === 'admin' || Number(req.user.id) ===
    (req.user.role === 'supervisor' ? row.supervisor_id : row.coordinator_id);
}

async function scope(client, req, lock = false) {
  const id = positiveId(req.params.id);
  const { rows: [row] } = await client.query(
    `${requestDetails} WHERE dr.id = $1 AND dr.workflow_version = 2 ${lock ? 'FOR UPDATE OF dr' : ''}`, [id]);
  requireThat(row && canSee(req, row) && (req.user.role !== 'supervisor' || row.original_proposal), 'Deployment request not found.', 404);
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
    userId === row.coordinator_id ? '/dashboard/coordinator/deployment' :
      row.teacher_user_ids?.includes(userId) ? '/dashboard/teacher' : '/dashboard/student/immersion-proper/placement-status';
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
  requireThat(row && Number(row.required_hours) === REQUIRED_IMMERSION_HOURS,
    'The deployment must use an active school immersion period configured for 80 hours.');
  return row;
}

async function schoolPeriodForStart(client, start) {
  requireThat(isValidManilaDate(start), 'Choose a valid proposed start date.');
  const { rows } = await client.query(`SELECT * FROM immersion_periods
    WHERE is_active = true AND required_hours = $2 AND start_date <= $1 AND end_date >= $1
    ORDER BY id`, [start, REQUIRED_IMMERSION_HOURS]);
  requireThat(rows.length > 0, 'The proposed start date must be within an active 80-hour school immersion period.');
  requireThat(rows.length === 1, 'More than one active 80-hour period contains this date. Ask an administrator to resolve the overlap.', 409);
  return rows[0];
}

async function verifyParties(client, partnerId, teacherIds, supervisorId = null, { allowPendingActivation = false } = {}) {
  const { rows: [partner] } = await client.query(
    'SELECT id, name FROM partner_institutions WHERE id = $1 AND is_active = true FOR SHARE', [partnerId]);
  requireThat(partner, 'Select an active partner institution.');
  const ids = teacherIds.filter(Boolean);
  requireThat(ids.length > 0, 'Assign at least one immersion teacher to the deployment.', 409);
  if (ids.length) {
    const { rowCount } = await client.query(`
      SELECT 1 FROM teachers t JOIN users u ON u.id = t.user_id
      WHERE t.id = ANY($1::int[]) AND u.role = 'teacher' AND ${activeAccount}`, [ids]);
    requireThat(rowCount === ids.length, 'Select active immersion teachers.');
  }
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
  const [teachers, supervisors, strands, authorised] = await Promise.all([
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
  return { teachers: teachers.rows, supervisors: supervisors.rows, strands,
    authorised: authorised.rows, today: nowInManilaDateOnly(), earliest: dateAfter(nowInManilaDateOnly(), 7),
    standard_schedule: standardSchedule };
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
        COALESCE(bool_or(status IN ('draft', 'pending', 'changes_requested', 'pending_coordinator_agreement')), false) AS has_unresolved_request
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
          AND dr.status IN ('draft', 'pending', 'changes_requested', 'pending_coordinator_agreement')
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
      AND ($3::int IS NULL OR dr.partner_institution_id = $3)
      AND ($2::int IS NULL OR dr.original_proposal IS NOT NULL)
    ORDER BY dr.created_at DESC, dr.id DESC`,
  [req.user.role === 'coordinator' ? req.user.id : null, req.user.role === 'supervisor' ? req.user.id : null, partner]);
  return { requests: rows.map((row) => classify(row)).filter((row) => !status || row.status === status) };
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
    pool.query(`SELECT e.id, e.actor_id, e.action, e.reason, e.created_at, e.before_state, e.after_state, u.role AS actor_role,
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
  const ids = row.proposal?.student_ids || [];
  const proposed = ids.length ? await pool.query(
    'SELECT id, first_name, last_name, track_strand FROM students WHERE id = ANY($1::int[]) ORDER BY last_name, first_name', [ids]) : { rows: [] };
  const active = roster.filter((student) => !student.deployment_ended_on).length;
  const seats = row.confirmed_schedule?.capacity || 0;
  return { request: classify(row), roster: req.user.role === 'supervisor' ? roster.filter((student) => !student.deployment_ended_on) : roster,
    history: history.rows, proposed_students: proposed.rows, strands, active, remaining: Math.max(0, seats - active),
    allocation_status: !active ? 'not_started' : active >= seats ? 'fully_filled' : 'partially_filled' };
});

async function readProposal(client, req, blocked, partnerId, assignedSupervisorId, draft) {
  const input = req.body;
  const teachers = input.teacher_ids ?? (input.teacher_id ? [input.teacher_id] : []);
  requireThat(Array.isArray(teachers), 'Select a valid list of immersion teachers.');
  const teacherIds = [...new Set(teachers.map(positiveId))];
  requireThat(teacherIds.length > 0, 'Assign at least one immersion teacher to the deployment.');
  const period = input.start ? await schoolPeriodForStart(client, input.start) : null;
  const periodId = period?.id ?? null;
  const { partner, supervisorId } = await verifyParties(client, partnerId, teacherIds, assignedSupervisorId,
    { allowPendingActivation: true });
  const seats = draft && !input.capacity ? null : capacity(input.capacity);
  const schedule = { ...input, windows: defaultWindows, daily_hours: CREDITABLE_HOURS_PER_DAY };
  const proposal = draft ? await readDraftSchedule(client, period, schedule, seats, blocked) :
    await validateSchedule(client, { immersion_period_id: periodId }, schedule, blocked);
  const ids = proposalStudents(input.student_ids ?? [], seats ?? 0);
  if (ids.length) {
    requireThat(proposal.start && proposal.end && proposal.start <= proposal.end, 'Set the dates before selecting students.');
    await validateStudents(client, { immersion_period_id: periodId }, proposal, ids);
  }
  return { teacherId: teacherIds[0] ?? null, teacherIds, supervisorId, periodId, partner, seats: seats ?? 0, proposal: {
    ...proposal, student_ids: ids, teacher_ids: teacherIds, worksite: note(input.worksite, { required: !draft }),
  } };
}

async function readDraftSchedule(client, period, input, seats, blocked) {
  const { start } = input;
  let dates = [];
  if (start) {
    requireThat(period, 'The proposed start date must be within an active 80-hour school immersion period.');
    dates = buildFixedDurationDates({ start, blocked, period, today: nowInManilaDateOnly(), requireNotice: false });
  }
  const { strands } = acceptedStrands(input.strands, await catalog(client), seats ?? 0);
  return { start: start || null, end: dates.at(-1) || null, dates, capacity: seats, strands,
    required_hours: REQUIRED_IMMERSION_HOURS, windows: defaultWindows, daily_hours: CREDITABLE_HOURS_PER_DAY,
    notes: note(input.notes) };
}

async function saveTeacherAssignments(client, requestId, ids) {
  await client.query('DELETE FROM partner_deployment_teachers WHERE deployment_request_id = $1', [requestId]);
  if (ids.length) await client.query(`INSERT INTO partner_deployment_teachers (deployment_request_id, teacher_id)
    SELECT $1, id FROM unnest($2::int[]) AS teachers(id)`, [requestId, ids]);
}

const create = endpoint(async (req) => {
  const partnerId = positiveId(req.body.partner_id);
  const key = req.body.creation_key;
  requireThat(typeof key === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(key), 'Invalid submission key.');
  const status = req.body.draft === true ? 'draft' : 'pending';
  const { blocked } = await loadExcludedDates(null, null);
  if (req.body.student_ids?.length) await ensureRequirementReviewSchema();
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
        AND status = ANY($3::text[])
      LIMIT 1`, [req.user.id, partnerId, openStatuses]);
    requireThat(!unresolved.rowCount,
      'Finish the open deployment request before creating another for this partner.', 409);
    const data = await readProposal(client, req, blocked, partnerId, null, status === 'draft');
    const response = await client.query(`
      INSERT INTO deployment_requests (coordinator_id, supervisor_id, batch_label, num_students, notes, direction,
        workflow_version, partner_institution_id, teacher_id, immersion_period_id, proposal, original_proposal, creation_key, status)
      VALUES ($1,$2,$3,$4,$5,'coordinator_to_supervisor',2,$6,$7,$8,$9,CASE WHEN $11 = 'draft' THEN NULL ELSE $9::jsonb END,$10,$11)
      ON CONFLICT (coordinator_id, creation_key) WHERE creation_key IS NOT NULL DO NOTHING RETURNING *`,
    [req.user.id, data.supervisorId, data.partner.name, data.seats, data.proposal.notes, partnerId,
      data.teacherId, data.periodId, data.proposal, key, status]);
    if (!response.rowCount) {
      const retry = await client.query('SELECT id FROM deployment_requests WHERE coordinator_id = $1 AND creation_key = $2', [req.user.id, key]);
      return { id: retry.rows[0].id };
    }
    const row = response.rows[0];
    await saveTeacherAssignments(client, row.id, data.teacherIds);
    await event(client, row, req.user.id, status === 'draft' ? 'draft_saved' : 'submitted', null,
      { ...data.proposal, teacher_id: data.teacherId, supervisor_id: data.supervisorId, period_id: data.periodId });
    return { id: row.id, row };
  });
  if (result.row && status === 'pending') await notify(result.row, result.row.supervisor_id, 'A deployment proposal is ready for your review.', 0);
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
    return { updated: { ...updated, teacher_user_ids: row.teacher_user_ids }, change };
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

const resubmit = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  if (req.body.student_ids?.length) await ensureRequirementReviewSchema();
  return changeRequest(req, async (client, row) => {
    requireThat(['draft', 'changes_requested', 'pending_coordinator_agreement'].includes(row.status),
      'This request is not open for a revised proposal.', 409);
    const status = req.body.draft === true && row.status === 'draft' ? 'draft' : 'pending';
    const data = await readProposal(client, req, blocked, row.partner_institution_id, row.supervisor_id, status === 'draft');
    await saveTeacherAssignments(client, row.id, data.teacherIds);
    return {
      update: `status = $2::text, responded_at = NULL, teacher_id = $3, immersion_period_id = $4, num_students = $5,
        notes = $6, proposal = $7, counterproposal = NULL,
        original_proposal = CASE WHEN $2 = 'draft' THEN original_proposal ELSE COALESCE(original_proposal, $7::jsonb) END`,
      values: [status, data.teacherId, data.periodId, data.seats, data.proposal.notes, data.proposal],
      action: status === 'draft' ? 'draft_saved' : row.status === 'draft' ? 'submitted' : 'resubmitted',
      before: { ...row.proposal, teacher_id: row.teacher_id, period_id: row.immersion_period_id },
      after: { ...data.proposal, teacher_id: data.teacherId, period_id: data.periodId },
      recipients: status === 'pending' ? [data.supervisorId] : [],
      message: 'The coordinator submitted a deployment proposal for review.',
    };
  });
});

async function validateSchedule(client, row, input, blocked, previous, requireNotice = true) {
  const today = nowInManilaDateOnly();
  const period = await schoolPeriod(client, row.immersion_period_id);
  const extraBlocked = input.excluded_dates || [];
  const dates = buildFixedDurationDates({ start: input.start, blocked, extraBlocked, period, previous, today, requireNotice });
  const seats = capacity(input.capacity);
  const { strands, caps } = acceptedStrands(input.strands, await catalog(client), seats, input.caps);
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
  return { start: input.start, end: dates.at(-1), dates, required_hours: REQUIRED_IMMERSION_HOURS,
    excluded_dates: [...new Set(extraBlocked)].sort(), capacity: seats,
    strands, caps, daily_hours: CREDITABLE_HOURS_PER_DAY, windows: defaultWindows, notes: note(input.notes) };
}

async function acceptSchedule(client, row, input, blocked, previous) {
  requireThat(input?.dates?.length, 'A complete schedule must be submitted for agreement.', 409);
  requireThat(previous || input.start >= nowInManilaDateOnly(), 'The proposed start has passed. Submit a revised proposal.', 409);
  await verifyParties(client, row.partner_institution_id, row.teacher_ids, row.supervisor_id);
  const schedule = await validateSchedule(client, row, input, blocked, previous, false);
  requireThat(JSON.stringify(schedule.dates) === JSON.stringify(input.dates),
    'The school calendar changed. Submit a new proposal with the updated workdays.', 409);
  return schedule;
}

function approveAgreement(row, schedule, action, source, proposal) {
  const agreement = {
    coordinator_id: row.coordinator_id, supervisor_id: row.supervisor_id, source,
    agreed_at: new Date().toISOString(),
  };
  return {
    update: `status = 'approved', confirmed_schedule = $2, agreement = $3, proposal = $4,
      num_students = $5, responded_at = now()`,
    values: [schedule, agreement, proposal, schedule.capacity], action,
    before: { status: row.status }, after: { schedule, agreement, student_ids: proposal.student_ids },
    recipients: [source === 'counterproposal' ? row.supervisor_id : row.coordinator_id],
    message: 'Both parties agreed to the deployment. The coordinator can now finalize the student roster.',
  };
}

const review = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  return changeRequest(req, async (client, row) => {
    requireThat(row.status === 'pending', 'Only unreviewed proposals can be reviewed.', 409);
    const decision = req.body.status;
    requireThat(['approved', 'counterproposal', 'rejected'].includes(decision), 'Choose a review decision.');
    if (decision === 'rejected') return {
      update: "status = 'rejected', responded_at = now()", values: [], action: 'rejected',
      before: { status: row.status }, after: { status: 'rejected' }, reason: note(req.body.reason, { required: true }),
      recipients: [row.coordinator_id], message: 'The supervisor rejected the proposal. Open the request for the reason.',
    };
    if (decision === 'approved') {
      const schedule = await acceptSchedule(client, row, row.proposal, blocked);
      await validateStudents(client, row, schedule, row.proposal.student_ids || []);
      return approveAgreement(row, schedule, 'approved', 'coordinator_proposal', row.proposal);
    }
    await verifyParties(client, row.partner_institution_id, row.teacher_ids, row.supervisor_id);
    const { start, capacity: seats } = req.body;
    requireThat(isValidManilaDate(start) && start >= nowInManilaDateOnly(), 'The counterproposal must start on a current or future day.');
      const counter = await validateSchedule(client, row, { ...row.proposal, start, capacity: seats }, blocked,
      undefined, start !== row.proposal.start);
      requireThat(['start', 'capacity'].some((key) => counter[key] !== row.proposal[key]), 'Change the start date or capacity before submitting a counterproposal.');
    const reason = note(req.body.reason, { required: true });
    return {
      update: "status = 'pending_coordinator_agreement', counterproposal = $2", values: [{ ...counter, reason }],
      action: 'counterproposal_submitted', before: row.proposal, after: counter, reason,
      recipients: [row.coordinator_id], message: 'The supervisor proposed changes. Review the dates and capacity.',
    };
  });
});

const decideCounterproposal = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  await ensureRequirementReviewSchema();
  return changeRequest(req, async (client, row) => {
    requireThat(row.status === 'pending_coordinator_agreement' && row.counterproposal, 'There is no counterproposal awaiting agreement.', 409);
    const decision = req.body.decision;
    requireThat(['accept', 'reject'].includes(decision), 'Choose whether to accept the counterproposal.');
    if (decision === 'reject') return {
      update: "status = 'changes_requested'", values: [], action: 'counterproposal_rejected', before: row.counterproposal, after: null,
      reason: note(req.body.reason, { required: true }), recipients: [row.supervisor_id],
      message: 'The coordinator declined the counterproposal. A revised proposal may follow.',
    };
    const schedule = await acceptSchedule(client, row, row.counterproposal, blocked);
    const ids = proposalStudents(req.body.student_ids ?? row.proposal.student_ids ?? [], schedule.capacity);
    await validateStudents(client, row, schedule, ids);
    return approveAgreement(row, schedule, 'counterproposal_accepted', 'counterproposal', { ...row.proposal, student_ids: ids });
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

const finalize = endpoint(async (req) => {
  await ensureRequirementReviewSchema();
  return changeRequest(req, async (client, row) => {
    const schedule = row.confirmed_schedule;
    requireThat(row.status === 'approved' && row.agreement && schedule && !row.teacher_batch_id,
      'A bilateral agreement is required before finalizing the roster.', 409);
    requireThat(schedule.start >= nowInManilaDateOnly(), 'The agreed start has passed. Agree on an amendment before finalizing.', 409);
    requireThat(!row.schedule_amendment, 'Resolve the pending amendment before finalizing the roster.', 409);
    await verifyParties(client, row.partner_institution_id, row.teacher_ids, row.supervisor_id);
    const ids = proposalStudents(req.body.student_ids ?? row.proposal.student_ids ?? [], schedule.capacity);
    requireThat(ids.length > 0, 'Select at least one student to finalize the deployment.');
    const students = await validateStudents(client, row, schedule, ids);
    const batch = await publishSchedule(client, row, schedule, req.user.id);
    await client.query(`INSERT INTO teacher_batch_students (teacher_batch_id, student_id, deployment_started_on)
      SELECT $1, id, $2 FROM unnest($3::int[]) AS ids(id)`, [batch, schedule.start, ids]);
    return { update: 'teacher_batch_id = $2', values: [batch], action: 'deployment_finalized',
      after: { schedule, batch_id: batch, student_ids: ids },
      recipients: [row.supervisor_id, ...row.teacher_user_ids, ...students.map((student) => student.user_id)].filter(Boolean),
      message: 'The deployment was finalized. The agreed schedule and roster are now available.' };
  });
});

const proposeAmendment = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  return changeRequest(req, async (client, row) => {
    requireThat(row.status === 'approved' && row.confirmed_schedule && !row.schedule_amendment &&
      (!row.teacher_batch_id || row.confirmed_schedule.end >= nowInManilaDateOnly()),
    'Only an open agreement without a pending amendment can be amended.', 409);
    await verifyParties(client, row.partner_institution_id, row.teacher_ids, row.supervisor_id);
    const previous = row.teacher_batch_id ? row.confirmed_schedule : undefined;
    const schedule = await validateSchedule(client, row, { ...row.confirmed_schedule, ...req.body }, blocked, previous);
    const proposedTerms = JSON.parse(JSON.stringify(schedule));
    const existingTerms = Object.fromEntries(Object.keys(proposedTerms).map((key) => [key, row.confirmed_schedule[key]]));
    requireThat(!isDeepStrictEqual(proposedTerms, existingTerms), 'Change the agreed schedule before submitting an amendment.');
    const reason = note(req.body.reason, { required: true });
    const amendment = { ...schedule, reason, proposed_by: req.user.id };
    return { update: 'schedule_amendment = $2', values: [amendment], action: 'amendment_proposed',
      before: row.confirmed_schedule, after: amendment, reason,
      recipients: [req.user.role === 'coordinator' ? row.supervisor_id : row.coordinator_id],
      message: 'A deployment amendment awaits your agreement. The current schedule remains in effect.' };
  });
});

const decideAmendment = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  await ensureRequirementReviewSchema();
  return changeRequest(req, async (client, row) => {
    const amendment = row.schedule_amendment;
    requireThat(row.status === 'approved' && amendment && amendment.proposed_by !== Number(req.user.id) &&
      (!row.teacher_batch_id || row.confirmed_schedule.end >= nowInManilaDateOnly()),
    'Only the other party can decide a pending amendment for an open deployment.', 409);
    requireThat(['accept', 'reject'].includes(req.body.decision), 'Choose whether to accept the amendment.');
    if (req.body.decision === 'reject') return {
      update: 'schedule_amendment = NULL', values: [], action: 'amendment_rejected', before: amendment, after: null,
      reason: note(req.body.reason, { required: true }), recipients: [amendment.proposed_by],
      message: 'The proposed amendment was declined. The agreed schedule is still in effect.',
    };
    const schedule = await acceptSchedule(client, row, amendment, blocked, row.teacher_batch_id ? row.confirmed_schedule : undefined);
    const roster = (await getRoster(client, row.teacher_batch_id)).filter((student) => !student.deployment_ended_on);
    if (row.teacher_batch_id) {
      const ids = roster.map((student) => student.id);
      await lockStudents(client, ids);
      await verifyNoOverlap(client, row.teacher_batch_id, schedule, ids);
      await publishSchedule(client, row, schedule, req.user.id);
    }
    const agreement = { coordinator_id: row.coordinator_id, supervisor_id: row.supervisor_id, source: 'amendment', agreed_at: new Date().toISOString() };
    return { update: 'confirmed_schedule = $2, schedule_amendment = NULL, agreement = $3, num_students = $4',
      values: [schedule, agreement, schedule.capacity], action: 'amendment_accepted', before: row.confirmed_schedule,
      after: { schedule, agreement }, recipients: [amendment.proposed_by, ...(row.teacher_batch_id ? row.teacher_user_ids : []),
        ...roster.map((student) => student.user_id)].filter(Boolean),
      message: 'Both parties agreed to the amendment. Review the updated deployment schedule.' };
  });
});

const cancel = endpoint(async (req) => changeRequest(req, async (client, row) => {
  const today = nowInManilaDateOnly();
  requireThat(!['cancelled', 'rejected'].includes(row.status) && (!row.teacher_batch_id || row.confirmed_schedule.end >= today),
    'Only open requests and deployments can be cancelled.', 409);
  const reason = note(req.body.reason, { required: true });
  const roster = await getRoster(client, row.teacher_batch_id);
  if (row.teacher_batch_id) {
    await client.query('UPDATE teacher_batches SET archived_at = now() WHERE id = $1', [row.teacher_batch_id]);
    await client.query(`UPDATE teacher_batch_students SET deployment_ended_on = $2
      WHERE teacher_batch_id = $1 AND deployment_ended_on IS NULL`, [row.teacher_batch_id, dateAfter(today, 1)]);
  }
  return { update: "status = 'cancelled', schedule_amendment = NULL", values: [], action: 'cancelled',
    before: { status: row.status }, after: { status: 'cancelled' }, reason,
    recipients: [row.status === 'draft' ? null : row.supervisor_id, ...(row.teacher_batch_id ? row.teacher_user_ids : []),
      ...roster.filter((s) => !s.deployment_ended_on).map((s) => s.user_id)].filter(Boolean),
    removedUsers: roster.filter((s) => !s.deployment_ended_on).map((s) => s.user_id),
    message: 'This immersion deployment was cancelled.' };
}));

function canAllocate(row) {
  requireThat(row.status === 'approved' && row.teacher_batch_id &&
    row.confirmed_schedule.end >= nowInManilaDateOnly(),
  'Roster changes open after finalization and close when the deployment ends.', 409);
}

async function eligibilityArgs(client, row, schedule) {
  const required = await getActiveDocumentTypes(client);
  return [row.immersion_period_id, schedule.strands?.map(strandKey) || null, row.teacher_batch_id ?? null,
    schedule.start, required.map((type) => type.id), schedule.end];
}

async function lockStudents(client, ids) {
  if (ids.length) await client.query('SELECT id FROM students WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]);
}

async function validateStudents(client, row, schedule, ids) {
  if (!ids.length) return [];
  await lockStudents(client, ids);
  const { rows } = await client.query(`${eligibleStudents} AND s.id = ANY($7::int[]) FOR SHARE OF u, sr`,
    [...await eligibilityArgs(client, row, schedule), ids]);
  requireThat(new Set(rows.map(({ id }) => id)).size === ids.length,
    'One or more selected students are ineligible or have an overlapping deployment.', 409);
  for (const [strand, limit] of Object.entries(schedule.caps || {})) {
    requireThat(rows.filter((student) => strandKey(student.track_strand) === strand).length <= limit,
      'The selected students exceed an agreed strand capacity.', 409);
  }
  return rows;
}

async function verifyNoOverlap(client, batchId, schedule, ids) {
  if (!ids.length) return;
  const { rowCount } = await client.query(`SELECT 1 FROM teacher_batch_students tbs
    JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id AND tb.archived_at IS NULL
    JOIN work_immersion_schedules wis ON wis.teacher_batch_id = tb.id
    WHERE tbs.student_id = ANY($1::int[]) AND tb.id <> $2
      AND (tbs.deployment_ended_on IS NULL OR tbs.deployment_ended_on > $3::date)
      AND COALESCE(tbs.deployment_started_on, wis.start_date) <= $4::date
      AND COALESCE(wis.end_date, 'infinity'::date) >= $3::date LIMIT 1`, [ids, batchId, schedule.start, schedule.end]);
  requireThat(!rowCount, 'An assigned student has another deployment that overlaps the amended dates.', 409);
}

async function searchCandidates(req, row, schedule) {
  const search = note(req.query.search, { max: 100 });
  const { rows } = await pool.query(`${eligibleStudents}
    AND strpos(lower(concat_ws(' ', s.first_name, s.last_name, s.track_strand, s.section)), lower($7)) > 0
    ORDER BY s.last_name, s.first_name LIMIT 100`, [...await eligibilityArgs(pool, row, schedule), search]);
  return { students: rows };
}

const proposalCandidates = endpoint(async (req) => {
  const { start } = req.query;
  const period = await schoolPeriodForStart(pool, start);
  const { blocked } = await loadExcludedDates(null, null);
  const dates = buildFixedDurationDates({ start, blocked, period, today: nowInManilaDateOnly() });
  const { strands } = acceptedStrands(req.query.strands ? String(req.query.strands).split(',') : null, await catalog(pool), 0);
  await ensureRequirementReviewSchema();
  return searchCandidates(req, { immersion_period_id: period.id }, { start, end: dates.at(-1), strands });
});

const candidates = endpoint(async (req) => {
  const row = await scope(pool, req);
  canAllocate(row);
  await ensureRequirementReviewSchema();
  return searchCandidates(req, row, row.confirmed_schedule);
});

async function rosterChange(client, row, req) {
  canAllocate(row);
  const add = req.body.add ? positiveId(req.body.add) : null;
  const remove = req.body.remove ? positiveId(req.body.remove) : null;
  requireThat((add || remove) && add !== remove, 'Choose a student to allocate, withdraw, or replace.');
  const reason = note(req.body.reason, { required: Boolean(remove) });
  const today = nowInManilaDateOnly();
  await lockStudents(client, [add, remove].filter(Boolean));
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
    const { rows: [student] } = await client.query(`${eligibleStudents} AND s.id = $7 FOR SHARE OF u, sr`,
      [...await eligibilityArgs(client, row, { ...schedule, start: today < schedule.start ? schedule.start : dateAfter(today, 1) }), add]);
    requireThat(student, 'This student is no longer eligible or already has an active deployment.', 409);
    const prior = roster.find((member) => member.id === add);
    requireThat(!prior || prior.deployment_ended_on <= prior.deployment_started_on,
      'This student already attended this deployment. Contact the school to reconcile the previous placement.', 409);
    const strand = strandKey(student.track_strand);
    const cap = schedule.caps?.[strand];
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
  resubmit, decideCounterproposal, finalize, proposeAmendment, decideAmendment, cancel, proposalCandidates, candidates, updateRoster,
};
