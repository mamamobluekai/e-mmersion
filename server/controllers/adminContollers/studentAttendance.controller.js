const queryReadOnly = require('../../db/queryReadOnly');
const { isValidManilaDate, nowInManilaDateOnly } = require('../../utils/manilaDate');

const publishedBatches = `
  FROM deployment_requests dr
  JOIN teacher_batches tb ON tb.id = dr.teacher_batch_id
  WHERE dr.workflow_version = 2 AND dr.status IN ('approved', 'ongoing', 'completed')
    AND jsonb_typeof(dr.confirmed_schedule->'dates') = 'array'`;

const positiveId = (value) => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647;

function failure(res, error) {
  console.error('Admin attendance monitoring:', error.code || error.name, error.message);
  return res.status(503).json({ error: 'Could not load student attendance. Try again.' });
}

async function listAttendancePartners(req, res) {
  try {
    const { rows: partners } = await queryReadOnly(`
      WITH batches AS (
        SELECT dr.partner_institution_id AS partner_id, tb.id AS batch_id ${publishedBatches}
      ), counts AS (
        SELECT b.partner_id, count(DISTINCT b.batch_id)::int AS batches,
               count(DISTINCT m.student_id)::int AS students
        FROM batches b LEFT JOIN teacher_batch_students m ON m.teacher_batch_id = b.batch_id
        GROUP BY b.partner_id
      )
      SELECT pi.id, pi.name, pi.industry, pi.is_active,
             COALESCE(counts.batches, 0) AS batches, COALESCE(counts.students, 0) AS students
      FROM partner_institutions pi LEFT JOIN counts ON counts.partner_id = pi.id
      ORDER BY pi.is_active DESC, lower(pi.name), pi.id`);
    return res.json({ partners });
  } catch (error) {
    return failure(res, error);
  }
}

async function attendancePartner(req, res) {
  const { partnerId } = req.params;
  if (!positiveId(partnerId)) return res.status(400).json({ error: 'Invalid partner institution.' });
  try {
    const { rows: [partner] } = await queryReadOnly(`SELECT id, name, industry, address, is_active
      FROM partner_institutions WHERE id = $1`, [partnerId]);
    if (!partner) return res.status(404).json({ error: 'Partner institution not found.' });
    const { rows: batches } = await queryReadOnly(`
      WITH batches AS (
        SELECT tb.id, tb.batch_label, tb.archived_at IS NOT NULL AS archived,
               dr.immersion_period_id, dr.supervisor_id, dr.confirmed_schedule->'dates' AS dates,
               dr.confirmed_schedule->>'daily_hours' AS daily_hours
        ${publishedBatches} AND dr.partner_institution_id = $1
      )
      SELECT b.id, b.batch_label, b.archived, b.dates, b.daily_hours, ip.period_name,
             NULLIF(concat_ws(' ', sv.first_name, sv.last_name), '') AS supervisor,
             ac.time_in_open::text, ac.time_in_close::text, ac.time_out_open::text, ac.time_out_close::text, ac.timezone
      FROM batches b
      LEFT JOIN immersion_periods ip ON ip.id = b.immersion_period_id
      LEFT JOIN supervisors sv ON sv.user_id = b.supervisor_id
      LEFT JOIN attendance_config ac ON ac.teacher_batch_id = b.id
      ORDER BY b.archived, lower(b.batch_label), b.id`, [partnerId]);
    return res.json({ partner, batches, today: nowInManilaDateOnly() });
  } catch (error) {
    return failure(res, error);
  }
}

async function attendanceDay(req, res) {
  const { partnerId } = req.params;
  const { date, batchId } = req.query;
  if (!positiveId(partnerId) || !isValidManilaDate(date) || (batchId !== undefined && !positiveId(batchId))) {
    return res.status(400).json({ error: 'Invalid partner, batch, or attendance date.' });
  }
  try {
    const { rows: records } = await queryReadOnly(`
      WITH batches AS (
        SELECT tb.id, tb.batch_label ${publishedBatches}
          AND dr.partner_institution_id = $1 AND (dr.confirmed_schedule->'dates') ? ($2::date)::text
          AND ($3::int IS NULL OR tb.id = $3)
      )
      SELECT s.id AS student_id, s.user_id, concat_ws(' ', s.first_name, s.last_name) AS name,
             s.student_number, s.track_strand, b.id AS batch_id, b.batch_label,
             a.status, to_char(a.check_in_time, 'HH24:MI') AS time_in, to_char(a.check_out_time, 'HH24:MI') AS time_out,
             CASE WHEN a.check_out_time >= a.check_in_time
               THEN round(extract(epoch FROM (a.check_out_time - a.check_in_time)) / 3600, 2)::float END AS recorded_hours,
             count(appeal.id) FILTER (WHERE appeal.status = 'pending')::int AS pending_appeals
      FROM batches b
      JOIN teacher_batch_students m ON m.teacher_batch_id = b.id
        AND (m.deployment_started_on IS NULL OR m.deployment_started_on <= $2::date)
        AND (m.deployment_ended_on IS NULL OR m.deployment_ended_on > $2::date)
      JOIN students s ON s.id = m.student_id
      LEFT JOIN student_attendance a ON a.student_id = s.id AND a.teacher_batch_id = b.id AND a.date = $2::date
      LEFT JOIN attendance_appeals appeal ON appeal.student_id = s.id AND appeal.teacher_batch_id = b.id AND appeal.appeal_date = $2::date
      GROUP BY s.id, b.id, b.batch_label, a.id
      ORDER BY lower(s.last_name), lower(s.first_name), b.id, s.id`, [partnerId, date, batchId ?? null]);
    return res.json({ records });
  } catch (error) {
    return failure(res, error);
  }
}

module.exports = { listAttendancePartners, attendancePartner, attendanceDay };
