// Read access to agreed deployment schedules and historical attendance days.
const pool = require('../../db/');
const { assertBatchAccess } = require('../../utils/batchAccess');
const { buildImmersionDateList: buildImmersionDayList, loadExcludedDates } = require('../../utils/immersionDays');

async function getBatchScheduleForDate(teacherBatchId, targetDate) {
  const { rows: [schedule] } = await pool.query(
    `SELECT wis.* FROM deployment_requests dr
     JOIN teacher_batches tb ON tb.id = dr.teacher_batch_id AND tb.archived_at IS NULL
     JOIN work_immersion_schedules wis ON wis.teacher_batch_id = tb.id AND wis.supervisor_id = dr.supervisor_id
     WHERE dr.teacher_batch_id = $1 AND dr.workflow_version = 2 AND dr.status = 'approved'
       AND (dr.confirmed_schedule->'dates') ? $2::text`, [teacherBatchId, targetDate]);
  return schedule || null;
}

async function assertTeacherOwnsBatch(user, batchId) {
  const gate = await assertBatchAccess(user, batchId);
  if (!gate.ok) return { error: gate.denied.error, status: gate.denied.status };
  return { teacherId: gate.access.teacherId, access: gate.access };
}

// GET /api/attendance/teacher/batch/:batchId/schedules
const getBatchSchedules = async (req, res) => {
  try {
    const { batchId } = req.params;
    const own = await assertTeacherOwnsBatch(req.user, batchId);
    if (own.error) return res.status(own.status).json({ error: own.error });

    const schedulesResult = await pool.query(
      `SELECT wis.*, u.email AS supervisor_email,
              sv.first_name AS supervisor_first_name, sv.last_name AS supervisor_last_name,
              dr.confirmed_schedule->'dates' AS agreed_dates
       FROM work_immersion_schedules wis
       LEFT JOIN users u ON u.id = wis.supervisor_id
       LEFT JOIN supervisors sv ON sv.user_id = wis.supervisor_id
       LEFT JOIN deployment_requests dr ON dr.teacher_batch_id = wis.teacher_batch_id
         AND dr.workflow_version = 2 AND dr.status = 'approved'
        WHERE wis.teacher_batch_id = $1
       ORDER BY wis.supervisor_id NULLS FIRST, wis.id ASC`,
      [batchId]
    );

    const studentsResult = await pool.query(
      `SELECT s.id AS student_id, s.user_id, s.first_name, s.last_name, s.student_number, s.grade_level, s.track_strand, u.email,
              tb.supervisor_id
       FROM teacher_batch_students tbs
       JOIN students s ON s.id = tbs.student_id
       JOIN users u ON u.id = s.user_id
       JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id
       WHERE tbs.teacher_batch_id = $1
       ORDER BY s.last_name ASC, s.first_name ASC`,
      [batchId]
    );

    const supervisorsMap = new Map();
    for (const s of studentsResult.rows) {
      const supId = s.supervisor_id || 'batch';
      if (!supervisorsMap.has(supId)) {
        supervisorsMap.set(supId, {
          supervisor_id: s.supervisor_id,
          students: [],
        });
      }
      supervisorsMap.get(supId).students.push(s);
    }

    // Finalized deployments use the dates agreed by both parties. Legacy
    // schedules without an agreement retain their historical date calculation.
    const scheduleById = new Map();
    for (const row of schedulesResult.rows) {
      const { blocked } = Array.isArray(row.agreed_dates)
        ? { blocked: null }
        : await loadExcludedDates(batchId, row.supervisor_id);
      scheduleById.set(String(row.supervisor_id), {
        ...row,
        attendance_dates: Array.isArray(row.agreed_dates)
          ? row.agreed_dates.map(String)
          : buildImmersionDayList(row.start_date, row.duration_type, row.duration_value, { blockedDates: blocked }),
      });
    }

    const groups = Array.from(supervisorsMap.entries()).map(([supervisor_id, data]) => {
      const schedule = scheduleById.get(String(data.supervisor_id)) || null;
      return {
        supervisor_id: supervisor_id === 'batch' ? null : Number(supervisor_id),
        supervisor_name: schedule ? `${schedule.supervisor_first_name || ''} ${schedule.supervisor_last_name || ''}`.trim() || 'Batch' : 'Batch',
        students: data.students,
        schedule: schedule || null,
      };
    });

    res.json({ groups });
  } catch (err) {
    console.error('getBatchSchedules error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

async function getStudentSchedules(studentId, { includeHistoricalDays = false } = {}) {
  const result = await pool.query(
    `SELECT DISTINCT ON (tb.id) wis.id, tb.id AS teacher_batch_id, wis.supervisor_id, wis.duration_type,
            wis.duration_value, wis.start_date, wis.end_date, wis.created_by, wis.created_at, wis.updated_at,
            tb.batch_label, tbs.assigned_at,
            to_jsonb(tbs)->>'deployment_started_on' AS deployment_started_on,
            to_jsonb(tbs)->>'deployment_ended_on' AS deployment_ended_on,
            dr.confirmed_schedule->'dates' AS agreed_dates,
            (dr.id IS NULL OR dr.status <> 'approved' OR tb.archived_at IS NOT NULL OR tbs.deployment_ended_on IS NOT NULL) AS historical,
            ARRAY(SELECT sa.date FROM student_attendance sa WHERE sa.student_id = $1 AND sa.teacher_batch_id = tb.id
              UNION SELECT sdd.date FROM student_daily_documentation sdd
              WHERE sdd.student_id = $1 AND sdd.teacher_batch_id = tb.id) AS historical_days,
            to_jsonb(dr)->'confirmed_schedule'->>'daily_hours' AS daily_hours,
            COALESCE((to_jsonb(dr)->'confirmed_schedule'->>'required_hours')::int, ip.required_hours) AS period_hours,
            u.email AS supervisor_email,
            sv.first_name AS supervisor_first_name, sv.last_name AS supervisor_last_name
     FROM teacher_batch_students tbs
     JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id
     LEFT JOIN work_immersion_schedules wis ON wis.teacher_batch_id = tb.id
     LEFT JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND to_jsonb(dr)->>'workflow_version' = '2'
     LEFT JOIN immersion_periods ip ON ip.id = tb.immersion_period_id
     LEFT JOIN users u ON u.id = wis.supervisor_id
     LEFT JOIN supervisors sv ON sv.user_id = wis.supervisor_id
     WHERE tbs.student_id = $1 AND ($2::boolean OR (dr.status = 'approved' AND tb.archived_at IS NULL
       AND tbs.deployment_ended_on IS NULL))
     ORDER BY tb.id, (wis.supervisor_id IS NOT DISTINCT FROM tb.supervisor_id) DESC,
              (wis.supervisor_id IS NULL) DESC, wis.id DESC`,
    [studentId, includeHistoricalDays]
  );

  const schedules = [];
  for (const row of result.rows) {
    const dates = row.historical ? row.historical_days.map(String).sort() : row.agreed_dates || [];
    const assignedDates = dates.filter((date) =>
      (!row.deployment_started_on || date >= row.deployment_started_on) &&
      (!row.deployment_ended_on || date < row.deployment_ended_on));
    if (!assignedDates.length) continue;
    const { historical, historical_days, agreed_dates, ...schedule } = row;
    schedules.push({
      ...schedule, attendance_dates: assignedDates.join(','),
      first_day_number: assignedDates.length ? dates.indexOf(assignedDates[0]) + 1 : 1,
    });
  }
  return schedules;
}

// GET /api/attendance/student/schedule
const getMySchedule = async (req, res) => {
  try {
    const studentUserId = req.user.id;
    const studentRow = await pool.query('SELECT id FROM students WHERE user_id = $1', [studentUserId]);
    if (!studentRow.rows.length) return res.status(404).json({ error: 'Student profile not found.' });
    const studentId = studentRow.rows[0].id;

    const schedules = await getStudentSchedules(studentId);
    res.json({ schedules });
  } catch (err) {
    console.error('getMySchedule error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

module.exports = {
  getBatchScheduleForDate,
  getBatchSchedules,
  getMySchedule,
  getStudentSchedules,
};
