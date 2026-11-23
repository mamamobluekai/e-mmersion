const pool = require('../db');
const { getStudentSchedules } = require('../controllers/teacherControllers/immersionSchedule.controller');
const { nowInManilaDateOnly } = require('../utils/manilaDate');
const { HOURS_PER_IMMERSION_DAY, isDayCompleted } = require('../utils/immersionDays');
const {
  getActiveDocumentTypes,
  ensureRequirementReviewSchema,
} = require('../controllers/coordinatorControllers/regexes/requirementsHelpers');

async function getPreImmersion(userId) {
  await ensureRequirementReviewSchema();
  const [types, result] = await Promise.all([
    getActiveDocumentTypes(pool),
    pool.query(
      `SELECT s.id AS student_id, ss.status AS submission_status,
              COALESCE(
                (SELECT jsonb_object_agg(rs.document_type_id, rs.status)
                 FROM student_requirement_statuses rs WHERE rs.submission_id = ss.id),
                '{}'::jsonb
              ) AS reviews
       FROM students s
       LEFT JOIN LATERAL (
         SELECT id, status FROM student_requirement_submissions
         WHERE student_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1
       ) ss ON TRUE
       WHERE s.user_id = $1`,
      [userId]
    ),
  ]);
  const student = result.rows[0];
  const approved = types.filter((type) => student?.reviews[type.id] === 'APPROVED').length;
  return {
    studentId: student?.student_id,
    status: student?.submission_status || 'Not started',
    total: types.length,
    approved,
    complete: String(student?.submission_status || '').trim().toLowerCase() === 'approved' && approved === types.length,
  };
}

function progressForDays(schedule, attendance, documentation, appeals, today) {
  const key = (row) => `${row.teacher_batch_id}:${row.date}`;
  const attendanceByDay = new Map(attendance.map((row) => [key(row), row]));
  const docsByDay = new Map(documentation.map((row) => [key(row), row]));
  const appealsByDay = new Map();
  for (const appeal of appeals) {
    const day = key(appeal);
    const statuses = appealsByDay.get(day) || [];
    statuses.push(appeal.status);
    appealsByDay.set(day, statuses);
  }

  return schedule.map((day) => {
    const row = day.date <= today ? attendanceByDay.get(key(day)) : null;
    const doc = docsByDay.get(key(day));
    const appealStatuses = day.date <= today ? appealsByDay.get(key(day)) || [] : [];
    const { check_in_time: timeIn, check_out_time: timeOut } = row || {};
    const workedMilliseconds = timeIn && timeOut ? new Date(timeOut) - new Date(timeIn) : 0;
    const validated = day.date <= today && (
      row?.status === 'present' ||
      (row?.status !== 'absent' && isDayCompleted(row) && workedMilliseconds > 0) ||
      (row && row.status !== 'absent' && appealStatuses.includes('approved'))
    );
    let attendanceStatus = 'Not Started';
    if (validated) attendanceStatus = 'Completed';
    else if (appealStatuses.includes('pending')) attendanceStatus = 'Under Review';
    else if (day.date < today || row?.status === 'absent' || appealStatuses.includes('rejected')) {
      attendanceStatus = 'Needs Revision';
    } else if (timeIn || timeOut) attendanceStatus = 'In Progress';

    let documentationStatus = 'Not Started';
    if (day.date <= today) {
      if (doc?.status === 'graded' || doc?.status === 'reviewed') documentationStatus = 'Completed';
      else if (['rejected', 'needs revision', 'needs_revision'].includes(doc?.status)) documentationStatus = 'Needs Revision';
      else if (doc?.status === 'submitted') documentationStatus = 'Submitted';
      else if (doc?.status === 'pending') documentationStatus = 'Under Review';
    }

    return {
      ...day,
      attendance: {
        status: attendanceStatus,
        timeIn: timeIn || null,
        timeOut: timeOut || null,
        recordedHours: validated ? Math.max(0, workedMilliseconds) / 3600000 : 0,
      },
      documentation: { status: documentationStatus },
    };
  });
}

function summarizeJourney(requirements, days, policy) {
  const attendanceCompleted = days.filter((day) => day.attendance.status === 'Completed').length;
  const docsCompleted = days.filter((day) => day.documentation.status === 'Completed').length;
  const scheduledHours = days.reduce((sum, day) => sum + day.scheduledHours, 0);
  const recordedHours = days.reduce((sum, day) => sum + day.attendance.recordedHours, 0);
  const requiredHours = Math.max(scheduledHours, policy.schoolHours || 0);
  const creditedHours = policy.recordedHoursOnly ? recordedHours : days.reduce(
    (sum, day) => sum + (day.attendance.status === 'Completed' ? day.scheduledHours : 0), 0
  );
  const immersionComplete = requirements.complete && days.length > 0 &&
    attendanceCompleted === days.length && docsCompleted === days.length &&
    creditedHours >= requiredHours;
  const postUnlocked = immersionComplete && (!policy.evaluationBeforePost || policy.evaluated);
  const stages = {
    pre: requirements.complete ? 'completed' : 'active',
    immersion: postUnlocked ? 'completed' : requirements.complete && days.length > 0 ? 'active' : 'locked',
    post: postUnlocked ? (policy.evaluated ? 'completed' : 'active') : 'locked',
  };
  const completedMissions = requirements.approved + attendanceCompleted + docsCompleted + Number(postUnlocked && policy.evaluated);
  const totalMissions = requirements.total + days.length * 2 + 1;
  const round = (hours) => Math.round(hours * 100) / 100;
  return {
    stages,
    requirements,
    days,
    completedMissions,
    totalMissions,
    // Until a schedule is published the number of daily missions is unknown.
    percent: days.length ? Math.round(completedMissions / totalMissions * 100) : null,
    attendance: { completed: attendanceCompleted, total: days.length },
    documentation: { completed: docsCompleted, total: days.length },
    hours: {
      required: requiredHours,
      scheduled: scheduledHours,
      recorded: round(recordedHours),
      credited: round(creditedHours),
      recordedOnly: Boolean(policy.recordedHoursOnly),
    },
    evaluation: { available: postUnlocked && Boolean(policy.evaluated), requiredBeforePost: Boolean(policy.evaluationBeforePost) },
    certificate: { issued: postUnlocked && Boolean(policy.certificateIssued) },
    awaitingEvaluation: immersionComplete && !postUnlocked,
  };
}

async function getStudentJourney(userId, preImmersion) {
  const { studentId, ...requirements } = preImmersion || await getPreImmersion(userId);
  const policy = {
    recordedHoursOnly: process.env.STUDENT_JOURNEY_RECORDED_HOURS_ONLY === 'true',
    evaluationBeforePost: process.env.STUDENT_JOURNEY_EVALUATION_BEFORE_POST === 'true',
  };
  if (!requirements.complete || !studentId) return summarizeJourney(requirements, [], policy);

  const [schedules, attendance, documentation, appeals, school, evaluation, certificate] = await Promise.all([
    getStudentSchedules(studentId, { includeHistoricalDays: true }),
    pool.query('SELECT teacher_batch_id, date, status, check_in_time, check_out_time FROM student_attendance WHERE student_id = $1', [studentId]),
    pool.query('SELECT teacher_batch_id, date, status FROM student_daily_documentation WHERE student_id = $1', [studentId]),
    pool.query('SELECT teacher_batch_id, appeal_date AS date, status FROM attendance_appeals WHERE student_id = $1', [studentId]),
    pool.query('SELECT required_hours FROM system_settings WHERE id = 1'),
    pool.query(
      `SELECT 1 FROM student_evaluations se
       WHERE se.student_id = $1 AND (se.overall_score IS NOT NULL OR se.overall_percentage IS NOT NULL)
         AND (se.batch_id IS NULL OR EXISTS (
           SELECT 1 FROM teacher_batch_students tbs
           WHERE tbs.student_id = se.student_id AND tbs.teacher_batch_id = se.batch_id
         ))
       LIMIT 1`,
      [studentId]
    ),
    pool.query('SELECT 1 FROM certificates WHERE student_id = $1 AND NULLIF(cloudinary_url, \'\') IS NOT NULL LIMIT 1', [studentId]),
  ]);
  const sortedSchedules = [...schedules].sort((a, b) =>
    Number(b.assigned_at || 0) - Number(a.assigned_at || 0) || b.teacher_batch_id - a.teacher_batch_id);
  const scheduleDays = sortedSchedules.flatMap((schedule) => (
    schedule.attendance_dates.split(',').filter(Boolean).map((date, index) => ({
      date,
      number: index + (schedule.first_day_number || 1),
      teacher_batch_id: schedule.teacher_batch_id,
      batchLabel: schedule.batch_label,
      scheduledHours: schedule.daily_hours ? Number(schedule.daily_hours) : schedule.duration_type === 'hours'
        ? Math.min(HOURS_PER_IMMERSION_DAY, schedule.duration_value - index * HOURS_PER_IMMERSION_DAY)
        : HOURS_PER_IMMERSION_DAY,
    }))
  ));
  // The attendance schema records a single workday per student and date.
  // Prefer the recorded batch for past work, then the most recent assignment.
  const recordedBatchByDate = new Map(attendance.rows.map((row) => [row.date, row.teacher_batch_id]));
  const scheduledByDate = new Map();
  for (const day of scheduleDays) {
    if (!scheduledByDate.has(day.date) || recordedBatchByDate.get(day.date) === day.teacher_batch_id) {
      scheduledByDate.set(day.date, day);
    }
  }
  const days = progressForDays(
    [...scheduledByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    attendance.rows, documentation.rows, appeals.rows, nowInManilaDateOnly()
  );
  return summarizeJourney(requirements, days, {
    ...policy,
    schoolHours: Math.max(0, ...schedules.map((schedule) =>
      Number(schedule.period_hours ?? school.rows[0]?.required_hours) || 0)),
    evaluated: evaluation.rows.length > 0,
    certificateIssued: certificate.rows.length > 0,
  });
}

module.exports = { getPreImmersion, getStudentJourney, progressForDays, summarizeJourney };
