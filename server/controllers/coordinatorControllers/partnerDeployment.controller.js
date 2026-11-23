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

const requestingStages = {
  in_progress: ['draft', 'pending'],
  changes_requested: ['changes_requested', 'pending_coordinator_agreement'],
};
const openStatuses = Object.values(requestingStages).flat();
const manilaToday = "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')";
const activeDeployment = `dr.status = 'approved'
  AND dr.confirmed_schedule->>'end' >= ${manilaToday}`;
const readyForStudentAssignments = `${activeDeployment} AND dr.agreement IS NOT NULL AND dr.schedule_amendment IS NULL
  AND occupants.assigned + student_review.pending < COALESCE((dr.confirmed_schedule->>'capacity')::int, 0)`;
const hasCreatedBatch = `EXISTS (
  SELECT 1 FROM coordinator_deployment_batches batch
  WHERE batch.id = dr.coordinator_batch_id AND batch.creation_key IS NOT NULL
)`;
const readyToDeploy = `${activeDeployment} AND dr.agreement IS NOT NULL AND dr.schedule_amendment IS NULL
  AND NOT ${hasCreatedBatch} AND pi.is_active AND student_review.accepted > 0 AND student_review.pending = 0
  AND (dr.teacher_batch_id IS NULL OR roster.accepted > 0)
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(dr.confirmed_schedule->'dates') AS workday(date)
    WHERE workday.date >= ${manilaToday}
  )
  AND EXISTS (SELECT 1 FROM immersion_periods ip WHERE ip.id = dr.immersion_period_id AND ip.is_active)`;
const partnerRequestSummary = `
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS request_count, max(dr.id) AS latest_id,
      max(dr.id) FILTER (WHERE ${activeDeployment}) AS active_request_id,
      max(dr.id) FILTER (WHERE dr.status IN ('draft', 'pending', 'changes_requested', 'pending_coordinator_agreement')) AS open_request_id
    FROM deployment_requests dr WHERE dr.partner_institution_id = pi.id AND dr.workflow_version = 2
      AND ($1::int IS NULL OR dr.coordinator_id = $1)
  ) work ON true`;
const statuses = [...openStatuses, 'approved', 'rejected', 'cancelled', 'ongoing', 'completed'];
const deploymentStages = ['no_request', 'requesting', 'approved', 'completed'];
const defaultWindows = { time_in_open: '08:00', time_in_close: '08:30', time_out_open: '17:00', time_out_close: '17:30' };
const standardSchedule = { required_hours: REQUIRED_IMMERSION_HOURS, daily_hours: CREDITABLE_HOURS_PER_DAY, windows: defaultWindows };
const activeAccount = "lower(u.status) IN ('approved', 'active')";
const affiliations = `
  SELECT institution_id, supervisor_user_id FROM partner_institution_supervisor_history WHERE ended_at IS NULL
  UNION
  SELECT institution_id, supervisor_user_id FROM partner_deployment_supervisors`;
const requestDetails = `
  SELECT dr.id, dr.coordinator_id, dr.supervisor_id, dr.teacher_id, dr.immersion_period_id, dr.teacher_batch_id, dr.coordinator_batch_id,
    ${hasCreatedBatch} AS has_created_batch,
    dr.partner_institution_id, dr.status, dr.revision, dr.created_at, dr.updated_at,
    dr.proposal, dr.original_proposal, dr.counterproposal, dr.agreement, dr.confirmed_schedule, dr.schedule_amendment,
    pi.name AS partner_name, pi.address AS partner_address, pi.industry, pi.is_active AS partner_is_active,
    COALESCE(team.ids, ARRAY[t.id]::int[]) AS teacher_ids,
    COALESCE(team.users, ARRAY[t.user_id]::int[]) AS teacher_user_ids,
    COALESCE(team.names, concat_ws(' ', t.first_name, t.last_name)) AS teacher_name,
    concat_ws(' ', sv.first_name, sv.last_name) AS supervisor_name,
    concat_ws(' ', c.first_name, c.last_name) AS coordinator_name,
    c.school AS coordinator_school, c.department AS coordinator_department,
    COALESCE(submission.created_at, dr.created_at) AS submitted_at,
    CASE WHEN submission.action = 'resubmitted' THEN submission.before_state END AS previous_proposal,
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
  LEFT JOIN LATERAL (
    SELECT e.action, e.created_at, e.before_state
    FROM partner_deployment_events e
    WHERE e.deployment_request_id = dr.id AND e.action IN ('submitted', 'resubmitted')
    ORDER BY e.id DESC LIMIT 1
  ) submission ON true
  LEFT JOIN immersion_periods ip ON ip.id = dr.immersion_period_id`;

const eligibleStudents = `
  SELECT s.id, s.user_id, s.first_name, s.last_name, s.track_strand, s.section, s.student_number,
    s.preferred_partner_institution_id, preference.name AS preferred_partner_name
  FROM students s JOIN users u ON u.id = s.user_id
  JOIN student_requirement_submissions sr ON sr.student_id = s.id AND sr.user_id = u.id
  LEFT JOIN partner_institutions preference ON preference.id = s.preferred_partner_institution_id
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

const availableForAssignment = `
  AND NOT EXISTS (
    SELECT 1 FROM partner_student_assignments a
    WHERE a.student_id = s.id AND a.status IN ('pending', 'accepted', 'rejected')
      AND a.deployment_request_id <> $8
  )
  AND NOT EXISTS (
    SELECT 1 FROM teacher_batch_students member
    JOIN teacher_batches batch ON batch.id = member.teacher_batch_id AND batch.archived_at IS NULL
    LEFT JOIN work_immersion_schedules schedule ON schedule.teacher_batch_id = batch.id
    WHERE member.student_id = s.id
      AND (member.deployment_ended_on IS NULL OR member.deployment_ended_on > (now() AT TIME ZONE 'Asia/Manila')::date)
      AND COALESCE(schedule.end_date, 'infinity'::date) >= (now() AT TIME ZONE 'Asia/Manila')::date
  )
  AND NOT EXISTS (
    SELECT 1 FROM teacher_batch_students member
    JOIN deployment_requests request ON request.teacher_batch_id = member.teacher_batch_id
    WHERE request.id = $8 AND member.student_id = s.id
      AND member.deployment_ended_on > member.deployment_started_on
  )`;

function endpoint(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.constraint === 'uq_partner_student_open_assignment') {
        return res.status(409).json({ error: 'A selected student already has an open assignment.' });
      }
      if (error.code === '42P01' || error.code === '42703') {
        return res.status(503).json({ error: 'Partner deployments require database migrations 044 through 047.' });
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
  const requesting_stage = Object.keys(requestingStages).find((stage) => requestingStages[stage].includes(status)) ?? null;
  return { ...row, status, reference: reference(row.id), schedule_status, requesting_stage };
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

async function notify(row, userId, text, revision, change) {
  if (!userId) return;
  const coordinatorStage = userId === row.coordinator_id &&
    (change?.action === 'students_reviewed'
      ? (change.after.decisions.some(({ status }) => status === 'rejected') ? 'students_rejected' :
        change.after.pending_review ? 'students_submitted' : 'completed')
      : requestingStages.changes_requested.includes(row.status) ? 'changes_requested' : row.status === 'approved' ? 'approved' : null);
  const deployedBatch = coordinatorStage === 'completed' && row.coordinator_batch_id;
  const actionUrl = userId === row.supervisor_id ? '/dashboard/supervisor/deployment-requests' :
    userId === row.coordinator_id ? (deployedBatch ? '/dashboard/coordinator/batches' : '/dashboard/coordinator/deployment') :
      row.teacher_user_ids?.includes(userId) ? '/dashboard/teacher' :
        row.teacher_batch_id ? '/dashboard/student/immersion-proper/placement-status' : '/dashboard/student/roadmap';
  const studentReview = userId === row.supervisor_id && ['students_submitted', 'students_resubmitted'].includes(change?.action);
  const requestLink = deployedBatch ? `?batch=${deployedBatch}` :
    userId === row.supervisor_id || userId === row.coordinator_id ? `?request=${row.id}` : '';
  const stageLink = coordinatorStage && !deployedBatch ? `&stage=${coordinatorStage}&revision=${revision}` : '';
  try {
    await createNotification({
      userId, title: `Deployment ${reference(row.id)}`, message: text,
      category: 'deployment', actionUrl: `${actionUrl}${requestLink}${stageLink}${studentReview ? `&students=1&revision=${revision}` : ''}`,
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
    'SELECT id, name, address FROM partner_institutions WHERE id = $1 AND is_active = true FOR SHARE', [partnerId]);
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
  if (req.user.role === 'supervisor') {
    const row = await scope(pool, req);
    requireThat(row.status === 'pending', 'This proposal has already been reviewed.', 409);
  }
  const partnerId = req.query.partner ? positiveId(req.query.partner) : null;
  const [teachers, supervisors, strands, authorised] = await Promise.all([
    pool.query(`
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
  const stage = deploymentStages.includes(req.query.stage) ? req.query.stage : null;
  const requestingStatuses = stage === 'requesting' && Object.hasOwn(requestingStages, req.query.requesting_stage)
    ? requestingStages[req.query.requesting_stage] : null;
  const filter = `
    FROM partner_institutions pi
    ${partnerRequestSummary}
    LEFT JOIN deployment_requests dr ON dr.id = CASE WHEN $7::text IS NULL THEN work.latest_id
      ELSE COALESCE(work.active_request_id, work.open_request_id, work.latest_id) END
    LEFT JOIN partner_institution_supervisor_history h ON h.institution_id = pi.id AND h.ended_at IS NULL
    LEFT JOIN supervisors sv ON sv.user_id = COALESCE(dr.supervisor_id, h.supervisor_user_id)
    LEFT JOIN teachers t ON t.id = dr.teacher_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS assigned, count(approval.student_id)::int AS accepted
      FROM teacher_batches batch JOIN teacher_batch_students member ON member.teacher_batch_id = batch.id
      LEFT JOIN partner_student_assignments approval ON approval.deployment_request_id = dr.id
        AND approval.student_id = member.student_id AND approval.status = 'accepted'
      WHERE batch.id = dr.teacher_batch_id AND batch.archived_at IS NULL AND member.deployment_ended_on IS NULL
    ) roster ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE a.status = 'pending')::int AS pending,
        count(*) FILTER (WHERE a.status = 'accepted')::int AS accepted
      FROM partner_student_assignments a WHERE a.deployment_request_id = dr.id
    ) student_review ON true
    CROSS JOIN LATERAL (
      SELECT CASE WHEN dr.teacher_batch_id IS NULL THEN student_review.accepted ELSE roster.assigned END AS assigned
    ) occupants
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
        OR ($6 = 'unassigned' AND dr.teacher_id IS NULL))
      AND ($7::text IS NULL OR $7 = CASE
        WHEN dr.id IS NULL OR dr.status IN ('cancelled', 'rejected') THEN 'no_request'
        WHEN dr.status <> 'approved' OR dr.confirmed_schedule IS NULL THEN 'requesting'
        WHEN ${readyToDeploy} THEN 'completed'
        ELSE 'approved'
      END OR ($7 = 'approved' AND (${readyForStudentAssignments})))
      AND ($7 IS DISTINCT FROM 'approved' OR (${readyForStudentAssignments}))
      AND ($8::text[] IS NULL OR dr.status = ANY($8::text[]))`;
  const args = [coordinator, active, note(req.query.search, { max: 255 }), supervisor, status, teacher, stage, requestingStatuses];
  const readPage = (number) => pool.query(`SELECT pi.*, work.request_count, work.open_request_id IS NOT NULL AS has_unresolved_request,
      work.active_request_id, work.open_request_id, work.latest_id AS latest_request_id, dr.id AS deployment_request_id, dr.status,
      dr.teacher_batch_id IS NOT NULL AS schedule_published,
      dr.num_students, dr.confirmed_schedule, occupants.assigned AS assigned_students, student_review.pending AS pending_students,
      CASE WHEN $7 = 'requesting' THEN dr.proposal - 'student_ids' END AS proposal,
      CASE WHEN $7 = 'requesting' THEN dr.counterproposal END AS requested_changes,
      concat_ws(' ', t.first_name, t.last_name) AS teacher_name,
      concat_ws(' ', sv.first_name, sv.last_name) AS supervisor_name
      ${filter} ORDER BY lower(pi.name), pi.id LIMIT $9 OFFSET $10`,
  [...args, stage === 'completed' ? null : size, (number - 1) * size]);
  if (stage === 'completed') {
    const { rows } = await readPage(1);
    return { partners: rows.map((row) => ({ ...row, schedule_status: classify(row).schedule_status })), page: 1, pages: 1 };
  }
  const [initialData, count] = await Promise.all([
    readPage(page),
    pool.query(`SELECT count(*)::int AS total ${filter}`, args),
  ]);
  const pages = Math.max(1, Math.ceil(count.rows[0].total / size));
  const currentPage = Math.min(page, pages);
  const data = currentPage === page ? initialData : await readPage(currentPage);
  return { partners: data.rows.map((row) => ({ ...row, schedule_status: classify(row).schedule_status })),
    page: currentPage, pages };
});

const partnerDetail = endpoint(async (req) => {
  const { rows: [partner] } = await pool.query(
    `SELECT pi.id, pi.name, pi.industry, pi.address, pi.description, pi.is_active,
      work.open_request_id IS NOT NULL AS has_unresolved_request, work.active_request_id
      FROM partner_institutions pi ${partnerRequestSummary} WHERE pi.id = $2`,
    [req.user.role === 'coordinator' ? req.user.id : null, positiveId(req.params.partnerId)]);
  requireThat(partner, 'Partner institution not found.', 404);
  return { partner };
});

const list = endpoint(async (req) => {
  const partner = req.query.partner ? positiveId(req.query.partner) : null;
  const status = statuses.includes(req.query.status) ? req.query.status : null;
  const stage = req.query.requesting_stage;
  const hasRequestingStage = Object.hasOwn(requestingStages, stage);
  const { rows } = await pool.query(`${requestDetails}
    WHERE dr.workflow_version = 2 AND ($1::int IS NULL OR dr.coordinator_id = $1)
      AND ($2::int IS NULL OR dr.supervisor_id = $2)
      AND ($3::int IS NULL OR dr.partner_institution_id = $3)
      AND ($2::int IS NULL OR dr.original_proposal IS NOT NULL)
    ORDER BY dr.created_at DESC, dr.id DESC`,
  [req.user.role === 'coordinator' ? req.user.id : null, req.user.role === 'supervisor' ? req.user.id : null, partner]);
  const requests = rows.map((row) => classify(row)).filter((row) =>
    (!status || row.status === status) &&
    (stage === 'history' ? !row.requesting_stage : !hasRequestingStage || row.requesting_stage === stage));
  return { requests };
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

async function readProposal(client, req, blocked, partnerId, assignedSupervisorId, draft, savedProposal) {
  const input = req.body;
  const teachers = input.teacher_ids ?? (input.teacher_id ? [input.teacher_id] : []);
  requireThat(Array.isArray(teachers), 'Select a valid list of immersion teachers.');
  const teacherIds = [...new Set(teachers.map(positiveId))];
  requireThat(teacherIds.length > 0, 'Assign at least one immersion teacher to the deployment.');
  const period = input.start ? await schoolPeriodForStart(client, input.start) : null;
  const periodId = period?.id ?? null;
  const { partner, supervisorId } = await verifyParties(client, partnerId, teacherIds, assignedSupervisorId,
    { allowPendingActivation: true });
  const worksite = savedProposal?.worksite?.trim() || note(partner.address);
  requireThat(draft || worksite, 'Add the worksite address in Partner Institutions before submitting for review.');
  const seats = draft && !input.capacity ? null : capacity(input.capacity);
  const schedule = { ...input, windows: defaultWindows, daily_hours: CREDITABLE_HOURS_PER_DAY };
  const keepStart = input.start === savedProposal?.start;
  if (!draft && keepStart) requireThat(input.start >= nowInManilaDateOnly(), 'Choose a new start date for the revised proposal.');
  const proposal = draft ? await readDraftSchedule(client, period, schedule, seats, blocked) :
    await validateSchedule(client, { immersion_period_id: periodId }, schedule, blocked, undefined, !keepStart);
  const ids = proposalStudents(input.student_ids ?? [], seats ?? 0);
  if (ids.length) {
    requireThat(proposal.start && proposal.end && proposal.start <= proposal.end, 'Set the dates before selecting students.');
    await validateStudents(client, { immersion_period_id: periodId }, proposal, ids);
  }
  return { teacherId: teacherIds[0] ?? null, teacherIds, supervisorId, periodId, partner, seats: seats ?? 0, proposal: {
    ...proposal, student_ids: ids, teacher_ids: teacherIds, worksite,
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
      SELECT dr.id FROM deployment_requests dr
      WHERE dr.coordinator_id = $1 AND dr.partner_institution_id = $2 AND dr.workflow_version = 2
        AND (dr.status = ANY($3::text[]) OR (${activeDeployment}))
      LIMIT 1`, [req.user.id, partnerId, openStatuses]);
    requireThat(!unresolved.rowCount,
      'This partner already has an open request or an active deployment.', 409);
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
    notify(updated, userId, change.message, updated.revision, change)));
  return { id: updated.id, revision: updated.revision };
}

const resubmit = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  if (req.body.student_ids?.length) await ensureRequirementReviewSchema();
  return changeRequest(req, async (client, row) => {
    requireThat(['draft', 'changes_requested', 'pending_coordinator_agreement'].includes(row.status),
      'This request is not open for a revised proposal.', 409);
    const status = req.body.draft === true && row.status === 'draft' ? 'draft' : 'pending';
    const data = await readProposal(client, req, blocked, row.partner_institution_id, row.supervisor_id,
      status === 'draft', row.proposal);
    await saveTeacherAssignments(client, row.id, data.teacherIds);
    return {
      update: `status = $2::text, responded_at = NULL, teacher_id = $3, immersion_period_id = $4, num_students = $5,
        notes = $6, proposal = $7, counterproposal = NULL,
        original_proposal = CASE WHEN $2 = 'draft' THEN original_proposal ELSE COALESCE(original_proposal, $7::jsonb) END`,
      values: [status, data.teacherId, data.periodId, data.seats, data.proposal.notes, data.proposal],
      action: status === 'draft' ? 'draft_saved' : row.status === 'draft' ? 'submitted' : 'resubmitted',
      before: { ...row.proposal, teacher_ids: row.teacher_ids.filter(Boolean), teacher_name: row.teacher_name,
        teacher_id: row.teacher_id, period_id: row.immersion_period_id },
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

async function requestProposalRevision(client, row, input, blocked) {
  const { start } = input;
  requireThat(isValidManilaDate(start), 'Enter a valid proposed start date.');
  const seats = capacity(input.capacity);
  requireThat(Array.isArray(input.teacher_ids), 'Select the required immersion teachers.');
  const teacherIds = [...new Set(input.teacher_ids.map(positiveId))];
  await verifyParties(client, row.partner_institution_id, teacherIds, row.supervisor_id);
  const { strands } = acceptedStrands(input.strands, await catalog(client), seats);
  if (start !== row.proposal.start) {
    const period = await schoolPeriodForStart(client, start);
    buildFixedDurationDates({ start, blocked, period, today: nowInManilaDateOnly() });
  }
  const reason = note(input.reason);
  const sorted = (values) => values ? [...values].sort() : null;
  requireThat(reason || start !== row.proposal.start || seats !== row.proposal.capacity ||
    !isDeepStrictEqual(sorted(teacherIds), sorted(row.teacher_ids.filter(Boolean))) ||
    !isDeepStrictEqual(sorted(strands), sorted(row.proposal.strands ?? null)),
  'Change a proposal field or describe what the coordinator should revise.');
  const { rows: teachers } = await client.query(
    'SELECT id, concat_ws(\' \', first_name, last_name) AS name FROM teachers WHERE id = ANY($1::int[]) ORDER BY name', [teacherIds]);
  const changes = { start, capacity: seats, strands, teacher_ids: teacherIds, teacher_name: teachers.map(({ name }) => name).join(', '), reason };
  return {
    update: "status = 'changes_requested', counterproposal = $2, responded_at = now()",
    values: [changes], action: 'revision_requested', before: row.proposal, after: changes, reason,
    recipients: [row.coordinator_id], message: 'The supervisor requested changes. Open Deployment to review and resubmit the proposal.',
  };
}

const review = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  return changeRequest(req, async (client, row) => {
    requireThat(row.status === 'pending', 'Only unreviewed proposals can be reviewed.', 409);
    const decision = req.body.status;
    requireThat(['approved', 'changes_requested', 'counterproposal', 'rejected'].includes(decision), 'Choose a review decision.');
    if (decision === 'changes_requested') return requestProposalRevision(client, row, req.body, blocked);
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

function assignmentSchedule(row) {
  requireThat(row.status === 'approved' && row.agreement && row.confirmed_schedule,
    'The deployment agreement must be approved before assigning students.', 409);
  return row.confirmed_schedule;
}

function nextAssignmentDay(row, schedule) {
  const start = schedule.dates.find((date) => date >= nowInManilaDateOnly());
  requireThat(start && !row.schedule_amendment, 'Resolve schedule changes or agree on future workdays before assigning students.', 409);
  return start;
}

async function reservedStudents(client, row) {
  const { rows: reserved } = await client.query(`
    SELECT s.track_strand FROM students s WHERE s.id IN (
      SELECT student_id FROM teacher_batch_students WHERE teacher_batch_id = $1 AND deployment_ended_on IS NULL
      UNION
      SELECT student_id FROM partner_student_assignments WHERE deployment_request_id = $2
        AND (status = 'pending' OR ($1::integer IS NULL AND status = 'accepted'))
    )`, [row.teacher_batch_id, row.id]);
  return reserved;
}

async function checkAssignmentSeats(client, row, schedule, newStudents) {
  const occupants = [...await reservedStudents(client, row), ...newStudents];
  requireThat(occupants.length <= schedule.capacity, 'Pending and accepted students fill the approved capacity.', 409);
  for (const [strand, limit] of Object.entries(schedule.caps || {})) {
    requireThat(occupants.filter((student) => strandKey(student.track_strand) === strand).length <= limit,
      'The selected students exceed an agreed strand capacity.', 409);
  }
}

const submitStudentAssignments = endpoint(async (req) => {
  await ensureRequirementReviewSchema();
  return changeRequest(req, async (client, row) => {
    const schedule = assignmentSchedule(row);
    const ids = proposalStudents(req.body.student_ids ?? row.proposal.student_ids ?? [], schedule.capacity);
    const released = proposalStudents(req.body.release_ids ?? [], 2147483647);
    requireThat((ids.length || released.length) && !ids.some((id) => released.includes(id)),
      'Choose students to submit or rejected students to release.');
    await lockStudents(client, [...ids, ...released]);
    const { rows: previous } = await client.query(`
      SELECT * FROM partner_student_assignments WHERE deployment_request_id = $1 AND student_id = ANY($2::int[])
    `, [row.id, [...ids, ...released]]);
    requireThat(released.every((id) => previous.some((student) => student.student_id === id && student.status === 'rejected')),
      'Only rejected students on this request can be released.', 409);
    requireThat(!previous.some((student) => ids.includes(student.student_id) && ['pending', 'accepted'].includes(student.status)),
      'These students are already pending approval or accepted.', 409);
    if (ids.length) {
      const start = nextAssignmentDay(row, schedule);
      await verifyParties(client, row.partner_institution_id, row.teacher_ids, row.supervisor_id);
      const students = await validateStudents(client, row, { ...schedule, start }, ids, true);
      await checkAssignmentSeats(client, row, schedule, students);
      await client.query(`INSERT INTO partner_student_assignments (deployment_request_id, student_id, status, submitted_by)
        SELECT $1, id, 'pending', $3 FROM unnest($2::int[]) AS ids(id)
        ON CONFLICT (deployment_request_id, student_id) DO UPDATE SET status = 'pending',
          attempt = partner_student_assignments.attempt + 1, submitted_at = now(), submitted_by = EXCLUDED.submitted_by,
          decided_at = NULL, decided_by = NULL, rejection_reason = NULL`, [row.id, ids, req.user.id]);
    }
    if (released.length) await client.query(`UPDATE partner_student_assignments SET status = 'released'
      WHERE deployment_request_id = $1 AND student_id = ANY($2::int[])`, [row.id, released]);
    return { update: 'status = status', values: [],
      action: !ids.length ? 'student_rejections_reviewed' : previous.length ? 'students_resubmitted' : 'students_submitted',
      before: { assignments: previous }, after: { student_ids: ids, released_ids: released },
      recipients: ids.length ? [row.supervisor_id] : [],
      message: 'Student assignments are ready for your review.' };
  });
});

const reviewStudentAssignments = endpoint(async (req) => {
  const input = req.body.decisions;
  requireThat(Array.isArray(input) && input.length > 0, 'Choose at least one student to accept or reject.');
  const decisions = input.map((entry) => {
    requireThat(entry && ['accepted', 'rejected'].includes(entry.status), 'Choose an approval status for each student.');
    return { student_id: positiveId(entry.student_id), status: entry.status,
      reason: entry.status === 'rejected' ? note(entry.reason, { required: true }) : null };
  });
  const ids = proposalStudents(decisions.map(({ student_id }) => student_id), 2147483647);
  await ensureRequirementReviewSchema();
  return changeRequest(req, async (client, row) => {
    const schedule = assignmentSchedule(row);
    await lockStudents(client, ids);
    const { rows: pending } = await client.query(`SELECT assignment.*, concat_ws(' ', s.first_name, s.last_name) AS student_name
      FROM partner_student_assignments assignment JOIN students s ON s.id = assignment.student_id
      WHERE assignment.deployment_request_id = $1 AND assignment.student_id = ANY($2::int[])
        AND assignment.status = 'pending' FOR UPDATE OF assignment`, [row.id, ids]);
    requireThat(pending.length === ids.length, 'Only students awaiting approval can be reviewed.', 409);
    const acceptedIds = decisions.filter(({ status }) => status === 'accepted').map(({ student_id }) => student_id);
    let acceptedStudents = [];
    if (acceptedIds.length) {
      const start = nextAssignmentDay(row, schedule);
      await verifyParties(client, row.partner_institution_id, row.teacher_ids, row.supervisor_id);
      acceptedStudents = await validateStudents(client, row, { ...schedule, start }, acceptedIds, true);
      await checkAssignmentSeats(client, row, schedule, []);
      if (row.teacher_batch_id) await placeAcceptedStudents(client, row.teacher_batch_id, start, acceptedIds);
    }
    await client.query(`UPDATE partner_student_assignments a SET status = choices.status,
      rejection_reason = choices.reason, decided_at = now(), decided_by = $3
      FROM jsonb_to_recordset($2::jsonb) AS choices(student_id int, status text, reason text)
      WHERE a.deployment_request_id = $1 AND a.student_id = choices.student_id`,
    [row.id, JSON.stringify(decisions), req.user.id]);
    const outstanding = await client.query(`SELECT 1 FROM partner_student_assignments
      WHERE deployment_request_id = $1 AND status = 'pending' LIMIT 1`, [row.id]);
    const names = new Map(pending.map(({ student_id, student_name }) => [student_id, student_name]));
    return { update: 'status = status', values: [], action: 'students_reviewed',
      before: { assignments: pending }, after: { decisions: decisions.map((decision) => ({
        ...decision, student_name: names.get(decision.student_id),
      })), batch_id: row.teacher_batch_id, pending_review: outstanding.rowCount > 0 },
      recipients: [row.coordinator_id, ...(row.teacher_batch_id && acceptedIds.length ? row.teacher_user_ids : []),
        ...acceptedStudents.map((student) => student.user_id)].filter(Boolean),
      message: 'The supervisor reviewed student assignments for this deployment.' };
  });
});

async function placeAcceptedStudents(client, batch, start, ids) {
  const inserted = await client.query(`INSERT INTO teacher_batch_students (teacher_batch_id, student_id, deployment_started_on)
    SELECT $1, id, $2 FROM unnest($3::int[]) AS ids(id)
    ON CONFLICT (teacher_batch_id, student_id) DO UPDATE SET deployment_started_on = EXCLUDED.deployment_started_on,
      deployment_ended_on = NULL, assigned_at = now()
    WHERE teacher_batch_students.deployment_ended_on <= teacher_batch_students.deployment_started_on`, [batch, start, ids]);
  requireThat(inserted.rowCount === ids.length, 'A previously attended placement cannot be reassigned to the same roster.', 409);
}

const deploymentBatchName = (number) => `BATCH - ${number}`;

const createDeploymentBatch = endpoint(async (req) => {
  requireThat(Array.isArray(req.body.request_ids) && req.body.request_ids.length, 'Choose at least one partner institution.');
  const ids = req.body.request_ids.map(positiveId);
  requireThat(new Set(ids).size === ids.length, 'A deployment request can only be selected once.');
  const key = note(req.body.creation_key, { required: true, max: 36 });
  requireThat(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(key), 'Invalid batch creation key.');
  const coordinator = req.user.id;
  await ensureRequirementReviewSchema();
  const result = await transaction(async (client) => {
    const owner = await client.query('SELECT id FROM coordinators WHERE user_id = $1 FOR UPDATE', [coordinator]);
    requireThat(owner.rowCount, 'A coordinator profile is required to create a batch.');
    const { rows: [existing] } = await client.query(
      'SELECT id, batch_number FROM coordinator_deployment_batches WHERE coordinator_id = $1 AND creation_key = $2',
      [coordinator, key]);
    if (existing) {
      const { rows: members } = await client.query('SELECT id FROM deployment_requests WHERE coordinator_batch_id = $1', [existing.id]);
      requireThat(members.length === ids.length && members.every(({ id }) => ids.includes(id)),
        'This batch creation key already belongs to a different selection.', 409);
      return { batch: existing, deployments: [] };
    }

    const { rows } = await client.query(`${requestDetails}
      WHERE dr.workflow_version = 2 AND dr.coordinator_id = $1 AND dr.id = ANY($2::int[])
      ORDER BY dr.id FOR UPDATE OF dr`, [coordinator, ids]);
    requireThat(rows.length === ids.length, 'One or more selected deployment requests were not found.', 404);
    requireThat(new Set(rows.map(({ partner_institution_id }) => partner_institution_id)).size === rows.length,
      'Select only one deployment request per partner institution.');
    const { rows: assignments } = await client.query(`SELECT deployment_request_id, student_id, status
      FROM partner_student_assignments
      WHERE deployment_request_id = ANY($1::int[]) AND status IN ('pending', 'accepted')`, [ids]);
    const accepted = new Map();
    for (const assignment of assignments) {
      requireThat(assignment.status === 'accepted', 'Resolve pending student approvals before creating this batch.', 409);
      if (!accepted.has(assignment.deployment_request_id)) accepted.set(assignment.deployment_request_id, []);
      accepted.get(assignment.deployment_request_id).push(assignment.student_id);
    }
    await lockStudents(client, assignments.map(({ student_id }) => student_id));

    const { rows: [batch] } = await client.query(`INSERT INTO coordinator_deployment_batches
      (coordinator_id, batch_number, creation_key)
      SELECT $1, COALESCE(max(batch_number), 0) + 1, $2 FROM coordinator_deployment_batches WHERE coordinator_id = $1
      RETURNING id, batch_number`, [coordinator, key]);
    const deployments = [];
    for (const row of rows) {
      const students = accepted.get(row.id);
      requireThat(!row.has_created_batch && students?.length,
        `${row.partner_name} is no longer ready for batch deployment.`, 409);
      const schedule = assignmentSchedule(row);
      const start = nextAssignmentDay(row, schedule);
      await schoolPeriod(client, row.immersion_period_id);
      await verifyParties(client, row.partner_institution_id, row.teacher_ids, row.supervisor_id);
      let teacherBatchId = row.teacher_batch_id;
      let deployedStudents;
      if (teacherBatchId) {
        // Rebatch the existing placement by changing only its coordinator batch.
        const { rows: roster } = await client.query(`
          SELECT s.user_id FROM teacher_batches batch
          JOIN teacher_batch_students member ON member.teacher_batch_id = batch.id
          JOIN students s ON s.id = member.student_id
          WHERE batch.id = $1 AND batch.archived_at IS NULL AND member.deployment_ended_on IS NULL
            AND member.student_id = ANY($2::int[])`, [teacherBatchId, students]);
        requireThat(roster.length, `${row.partner_name} has no active accepted placements to rebatch.`, 409);
        deployedStudents = roster;
      } else {
        await checkAssignmentSeats(client, row, schedule, []);
        deployedStudents = await validateStudents(client, row, { ...schedule, start }, students, true);
        teacherBatchId = await publishSchedule(client, row, schedule, coordinator);
        await placeAcceptedStudents(client, teacherBatchId, start, students);
      }
      const { rows: [updated] } = await client.query(`
        UPDATE deployment_requests SET teacher_batch_id = $2, coordinator_batch_id = $3,
          revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [row.id, teacherBatchId, batch.id]);
      await event(client, row, coordinator, 'batch_deployed',
        row.coordinator_batch_id ? { coordinator_batch_id: row.coordinator_batch_id } : null, {
        coordinator_batch_id: batch.id, batch_name: deploymentBatchName(batch.batch_number), teacher_batch_id: teacherBatchId,
      });
      deployments.push({ updated: { ...updated, teacher_user_ids: row.teacher_user_ids },
        recipients: new Set([row.supervisor_id, ...row.teacher_user_ids, ...deployedStudents.map(({ user_id }) => user_id)]) });
    }
    return { batch, deployments };
  });
  const name = deploymentBatchName(result.batch.batch_number);
  await Promise.all(result.deployments.flatMap(({ updated, recipients }) => [...recipients].map((userId) =>
    notify(updated, userId, `${name} has been deployed. Review the published immersion schedule.`, updated.revision))));
  return { batch: { id: result.batch.id, name } };
});

const listDeploymentBatches = endpoint(async (req) => {
  const { rows } = await pool.query(`WITH batches AS (
    SELECT id, batch_number, created_at FROM coordinator_deployment_batches
    WHERE coordinator_id = $1 AND creation_key IS NOT NULL
  ), live AS (
    ${requestDetails} JOIN batches batch ON batch.id = dr.coordinator_batch_id
  ), deployments AS (
    SELECT request.coordinator_batch_id AS batch_id, request.id AS request_id, request.partner_name, request.teacher_name,
      request.supervisor_name, request.status, request.confirmed_schedule,
      (SELECT count(*)::int FROM teacher_batch_students tbs WHERE tbs.teacher_batch_id = request.teacher_batch_id) AS student_count,
      (SELECT count(*)::int FROM student_attendance attendance WHERE attendance.teacher_batch_id = request.teacher_batch_id) AS attendance_count,
      false AS archived
    FROM live request
    UNION ALL
    SELECT batch.id, archived.original_request_id, archived.batch_label, archived.partner_deployment->>'teacher_name',
      archived.supervisor_name, archived.status, archived.partner_deployment->'confirmed_schedule',
      jsonb_array_length(archived.student_names), (archived.partner_deployment->>'attendance_count')::int, true
    FROM archive_deployment_requests archived
    JOIN batches batch ON batch.id = (archived.partner_deployment->>'coordinator_batch_id')::int
    WHERE NOT EXISTS (SELECT 1 FROM live WHERE id = archived.original_request_id)
  )
  SELECT batch.id, batch.batch_number, batch.created_at,
    deployment.request_id, deployment.partner_name, deployment.teacher_name, deployment.supervisor_name,
    deployment.status, deployment.confirmed_schedule, deployment.student_count, deployment.attendance_count, deployment.archived
  FROM batches batch JOIN deployments deployment ON deployment.batch_id = batch.id
  ORDER BY batch.batch_number DESC, lower(deployment.partner_name), deployment.request_id`, [req.user.id]);
  const batches = new Map();
  const today = nowInManilaDateOnly();
  for (const { id, batch_number, created_at, ...deployment } of rows) {
    if (!batches.has(id)) batches.set(id, { id, name: deploymentBatchName(batch_number), created_at, deployments: [] });
    const { status, schedule_status } = classify(deployment, today);
    batches.get(id).deployments.push({ ...deployment, status, schedule_status, reference: reference(deployment.request_id) });
  }
  return { batches: [...batches.values()] };
});

const deploymentBatchRoster = endpoint(async (req) => {
  const { rows } = await pool.query(`WITH batch AS (
    SELECT id FROM coordinator_deployment_batches
    WHERE id = $1 AND coordinator_id = $2 AND creation_key IS NOT NULL
  ), live AS (
    SELECT dr.id, dr.teacher_batch_id FROM deployment_requests dr JOIN batch ON batch.id = dr.coordinator_batch_id
  ), roster AS (
    SELECT live.id AS request_id, s.id AS student_id, s.first_name, s.last_name, s.student_number, s.track_strand,
      s.section, member.deployment_started_on, member.deployment_ended_on
    FROM live
    JOIN teacher_batch_students member ON member.teacher_batch_id = live.teacher_batch_id
    JOIN students s ON s.id = member.student_id
    UNION ALL
    SELECT archived.original_request_id, s.student_id, s.first_name, s.last_name, s.student_number, s.track_strand,
      s.section, s.deployment_started_on, s.deployment_ended_on
    FROM archive_deployment_requests archived
    JOIN batch ON batch.id = (archived.partner_deployment->>'coordinator_batch_id')::int
    CROSS JOIN LATERAL jsonb_to_recordset(archived.student_names) AS s(
      student_id int, first_name text, last_name text, student_number text, track_strand text, section text,
      deployment_started_on date, deployment_ended_on date
    )
    WHERE NOT EXISTS (SELECT 1 FROM live WHERE live.id = archived.original_request_id)
  )
  SELECT roster.* FROM batch LEFT JOIN roster ON true
  ORDER BY roster.last_name, roster.first_name, roster.student_id`, [positiveId(req.params.batchId), req.user.id]);
  requireThat(rows.length, 'Deployment batch not found.', 404);
  const studentsByRequest = {};
  for (const { request_id, ...student } of rows) {
    if (request_id !== null) (studentsByRequest[request_id] ??= []).push(student);
  }
  return { students_by_request: studentsByRequest };
});

const proposeAmendment = endpoint(async (req) => {
  const { blocked } = await loadExcludedDates(null, null);
  return changeRequest(req, async (client, row) => {
    requireThat(row.status === 'approved' && row.confirmed_schedule && !row.schedule_amendment &&
      (!row.teacher_batch_id || row.confirmed_schedule.end >= nowInManilaDateOnly()),
    'Only an open agreement without a pending amendment can be amended.', 409);
    const pending = await client.query(`SELECT 1 FROM partner_student_assignments
      WHERE deployment_request_id = $1 AND status = 'pending' LIMIT 1`, [row.id]);
    requireThat(!pending.rowCount, 'Resolve pending student approvals before amending the schedule.', 409);
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
  const { rows: assignments } = await client.query(`SELECT student_id FROM partner_student_assignments
    WHERE deployment_request_id = $1 AND status <> 'released'`, [row.id]);
  await lockStudents(client, [...assignments.map(({ student_id }) => student_id), ...roster.map(({ id }) => id)]);
  await client.query("UPDATE partner_student_assignments SET status = 'released' WHERE deployment_request_id = $1", [row.id]);
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

async function validateStudents(client, row, schedule, ids, forAssignment = false) {
  if (!ids.length) return [];
  await lockStudents(client, ids);
  const args = [...await eligibilityArgs(client, row, schedule), ids];
  if (forAssignment) args.push(row.id);
  const { rows } = await client.query(`${eligibleStudents} AND s.id = ANY($7::int[])
    ${forAssignment ? availableForAssignment : ''} FOR SHARE OF u, sr`, args);
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

const assignmentCandidates = endpoint(async (req) => {
  const row = await scope(pool, req);
  const schedule = assignmentSchedule(row);
  const start = nextAssignmentDay(row, schedule);
  const search = note(req.query.search, { max: 100 });
  await ensureRequirementReviewSchema();
  const { rows } = await pool.query(`${eligibleStudents}
    AND strpos(lower(concat_ws(' ', s.first_name, s.last_name, s.track_strand, s.section)), lower($7)) > 0
    ${availableForAssignment}
    AND NOT EXISTS (SELECT 1 FROM partner_student_assignments a WHERE a.deployment_request_id = $8
      AND a.student_id = s.id AND a.status IN ('pending', 'accepted'))
    ORDER BY COALESCE(s.preferred_partner_institution_id = $9, false) DESC, s.last_name, s.first_name, s.id`,
  [...await eligibilityArgs(pool, row, { ...schedule, start }), search, row.id, row.partner_institution_id]);
  return { remaining: Math.max(0, schedule.capacity - (await reservedStudents(pool, row)).length),
    students: rows.map((student) => ({ ...student,
    preferred_match: student.preferred_partner_institution_id === row.partner_institution_id })) };
});

const studentAssignments = endpoint(async (req) => {
  const supervisor = req.user.role === 'supervisor';
  const scopeColumn = supervisor ? 'supervisor_id' : 'coordinator_id';
  await ensureRequirementReviewSchema();
  const required = (await getActiveDocumentTypes(pool)).map(({ id }) => id);
  const { rows } = await pool.query(`WITH visible_requests AS (
    ${requestDetails} WHERE dr.workflow_version = 2 AND dr.${scopeColumn} = $1
  )
  SELECT a.deployment_request_id, a.status, a.attempt, a.submitted_at, a.decided_at, a.rejection_reason,
    s.id AS student_id, s.first_name, s.last_name, s.student_number, s.section, s.track_strand,
    pi.name AS preferred_partner_name, COALESCE(s.preferred_partner_institution_id = dr.partner_institution_id, false) AS preferred_match,
    dr.partner_name, dr.coordinator_name, dr.teacher_name, dr.supervisor_name, dr.revision,
    CASE WHEN NOT $3::boolean AND a.status = 'pending' THEN jsonb_build_object(
      'id', dr.partner_institution_id, 'name', dr.partner_name, 'industry', dr.industry,
      'address', dr.partner_address, 'is_active', dr.partner_is_active,
      'teacher_name', dr.teacher_name, 'supervisor_name', dr.supervisor_name,
      'status', dr.status, 'confirmed_schedule', dr.confirmed_schedule,
      'request_count', (SELECT count(*)::int FROM deployment_requests request
        WHERE request.partner_institution_id = dr.partner_institution_id AND request.workflow_version = 2
          AND request.coordinator_id = dr.coordinator_id),
      'assigned_students', CASE WHEN dr.teacher_batch_id IS NULL THEN (
        SELECT count(*)::int FROM partner_student_assignments accepted
        WHERE accepted.deployment_request_id = dr.id AND accepted.status = 'accepted'
      ) ELSE (
        SELECT count(*)::int FROM teacher_batch_students member
        WHERE member.teacher_batch_id = dr.teacher_batch_id AND member.deployment_ended_on IS NULL
      ) END
    ) END AS deployment_summary,
    EXISTS (SELECT 1 FROM users u JOIN student_requirement_submissions sr ON sr.user_id = u.id AND sr.student_id = s.id
      WHERE u.id = s.user_id AND u.role = 'student' AND ${activeAccount} AND s.archived_at IS NULL
        AND u.immersion_period_id = dr.immersion_period_id AND lower(sr.status) = 'approved' AND sr.progress = 100
        AND NOT EXISTS (SELECT 1 FROM unnest($2::int[]) required(document_type_id)
          WHERE NOT EXISTS (SELECT 1 FROM student_requirement_statuses review
            WHERE review.submission_id = sr.id AND review.document_type_id = required.document_type_id AND review.status = 'APPROVED')
        )) AS eligible
  FROM partner_student_assignments a
  JOIN visible_requests dr ON dr.id = a.deployment_request_id
  JOIN students s ON s.id = a.student_id
  LEFT JOIN partner_institutions pi ON pi.id = s.preferred_partner_institution_id
  WHERE a.status <> 'released'
  ORDER BY a.submitted_at DESC, s.last_name, s.first_name, s.id`, [req.user.id, required, supervisor]);
  const deploymentSummaries = {};
  const assignments = rows.map(({ deployment_summary: summary, ...row }) => {
    if (summary && !deploymentSummaries[row.deployment_request_id]) {
      const { schedule_status } = classify(summary);
      deploymentSummaries[row.deployment_request_id] = { ...summary, schedule_status };
    }
    return { ...row, request_reference: reference(row.deployment_request_id) };
  });
  return supervisor ? { assignments } : { assignments, deployment_summaries: deploymentSummaries };
});

async function rosterChange(client, row, req) {
  canAllocate(row);
  const remove = req.body.remove ? positiveId(req.body.remove) : null;
  requireThat(!req.body.add, 'Submit new students for supervisor approval before adding them to the roster.', 409);
  requireThat(remove, 'Choose a student to withdraw.');
  const reason = note(req.body.reason, { required: true });
  const today = nowInManilaDateOnly();
  await lockStudents(client, [remove]);
  const roster = await getRoster(client, row.teacher_batch_id);
  const active = roster.filter((student) => !student.deployment_ended_on);
  const outgoing = active.find((student) => student.id === remove);
  requireThat(outgoing, 'This student is no longer on the active roster.', 409);
  const schedule = row.confirmed_schedule;
  const leavingOn = today < schedule.start ? today : dateAfter(today, 1);
  await client.query(`UPDATE teacher_batch_students SET deployment_ended_on = $3
    WHERE teacher_batch_id = $1 AND student_id = $2`, [row.teacher_batch_id, remove, leavingOn]);
  await client.query(`UPDATE partner_student_assignments SET status = 'released'
    WHERE deployment_request_id = $1 AND student_id = $2 AND status = 'accepted'`, [row.id, remove]);
  return { update: 'status = status', values: [], action: 'student_withdrawn',
    before: { student_id: remove, ends_before: leavingOn }, after: null,
    reason, recipients: [row.supervisor_id, outgoing.user_id], removedUsers: [outgoing.user_id],
  message: 'The coordinator updated a student placement on this deployment.' };
}

const updateRoster = endpoint(async (req) => {
  await ensureRequirementReviewSchema();
  return changeRequest(req, (client, row) => rosterChange(client, row, req));
});

module.exports = {
  options, partners, partnerDetail, list, detail, create, review,
  resubmit, decideCounterproposal, proposeAmendment, decideAmendment, cancel, proposalCandidates, candidates, updateRoster,
  assignmentCandidates, studentAssignments, submitStudentAssignments, reviewStudentAssignments,
  createDeploymentBatch, listDeploymentBatches, deploymentBatchRoster,
};
