// controllers/locationController.js
const pool = require("../db");
const { emitTrackingChange } = require("../sockets");
const { getBatchScheduleForDate } = require("./teacherControllers/immersionSchedule.controller");
const { nowInManilaDateOnly } = require("../utils/manilaDate");
const { assertBatchAccess } = require("../utils/batchAccess");

// POST /api/location/update
// Called repeatedly by the student's browser (e.g. every 5-10s) while
// checked in. Only accepted if there's an active (checked_in) attendance
// row for today — this is what enforces "location only visible while
// clocked in."
// body: { latitude, longitude, accuracy }
exports.updateLocation = async (req, res) => {
  const userId = req.user.id;
  const { latitude, longitude, accuracy } = req.body;

  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 2147483647))) {
    return res.status(400).json({ message: "Valid GPS coordinates and accuracy are required." });
  }

  try {
    const { rows: [location] } = await pool.query(
      `WITH active_attendance AS (
         SELECT sa.id, sa.student_id, sa.teacher_batch_id, concat_ws(' ', s.first_name, s.last_name) AS student_name
         FROM students s
         JOIN student_attendance sa ON sa.student_id = s.id AND sa.date = $2 AND sa.status = 'checked_in'
         JOIN teacher_batch_students tbs ON tbs.student_id = s.id AND tbs.teacher_batch_id = sa.teacher_batch_id
           AND (tbs.deployment_started_on IS NULL OR sa.date >= tbs.deployment_started_on)
           AND (tbs.deployment_ended_on IS NULL OR sa.date < tbs.deployment_ended_on)
         JOIN teacher_batches tb ON tb.id = sa.teacher_batch_id AND tb.archived_at IS NULL
         JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
           AND (dr.confirmed_schedule->'dates') ? sa.date::text
         WHERE s.user_id = $1
         FOR UPDATE OF sa
       ), positions AS (
         INSERT INTO student_locations (student_id, attendance_id, latitude, longitude, accuracy)
         SELECT student_id, id, $3, $4, $5 FROM active_attendance
         RETURNING attendance_id
       )
       INSERT INTO gps_logs (student_id, teacher_batch_id, attendance_id, event_type, latitude, longitude, accuracy, student_name)
       SELECT a.student_id, a.teacher_batch_id, a.id, 'live', $3, $4, $5, a.student_name
       FROM active_attendance a JOIN positions p ON p.attendance_id = a.id
       RETURNING teacher_batch_id`,
      [userId, nowInManilaDateOnly(), latitude, longitude, accuracy == null ? null : Math.round(accuracy)]
    );
    if (!location) return res.status(403).json({ message: "No active check-in for an assigned workday." });

    emitTrackingChange(location.teacher_batch_id);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("updateLocation error:", err);
    res.status(500).json({ message: "Failed to record location." });
  }
};

// GET /api/location/batch/:teacherBatchId
// Teacher dashboard: current position of every student currently checked in.
// Only returns students whose attendance date falls within an active work immersion schedule.
exports.getBatchCurrentLocations = async (req, res) => {
  const { teacherBatchId } = req.params;
  const today = nowInManilaDateOnly();

  try {
    const gate = await assertBatchAccess(req.user, teacherBatchId);
    if (!gate.ok) return res.status(gate.denied.status).json({ message: gate.denied.error });
    const schedule = await getBatchScheduleForDate(teacherBatchId, today);
    if (!schedule) {
      return res.json({ students: [], in_schedule: false, message: 'Today is not within the work immersion schedule.' });
    }

    const result = await pool.query(
      `SELECT sa.student_id, st.first_name, st.last_name,
              st.student_number, st.contact_number, st.email,
              st.grade_level, st.track_strand, st.photo_url,
              COALESCE(sl.latitude, sa.check_in_lat) AS latitude,
              COALESCE(sl.longitude, sa.check_in_lng) AS longitude,
              COALESCE(sl.accuracy, sa.check_in_accuracy) AS accuracy,
              COALESCE(sl.recorded_at, sa.check_in_time) AS recorded_at,
              sa.status, sa.check_in_time, sa.check_out_time,
              pi.name AS company_name,
              su.email AS supervisor_email,
              su.phone AS supervisor_phone,
              NULLIF(BTRIM(CONCAT(sv.first_name, ' ', sv.last_name)), '') AS supervisor_name
       FROM student_attendance sa
       JOIN students st ON st.id = sa.student_id
       JOIN teacher_batch_students tbs ON tbs.student_id = sa.student_id AND tbs.teacher_batch_id = sa.teacher_batch_id
         AND (tbs.deployment_started_on IS NULL OR sa.date >= tbs.deployment_started_on)
         AND (tbs.deployment_ended_on IS NULL OR sa.date < tbs.deployment_ended_on)
       JOIN teacher_batches tb ON tb.id = sa.teacher_batch_id AND tb.archived_at IS NULL
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
         AND (dr.confirmed_schedule->'dates') ? sa.date::text
       JOIN partner_institutions pi ON pi.id = dr.partner_institution_id
       LEFT JOIN supervisors sv ON sv.user_id = tb.supervisor_id
       LEFT JOIN users su ON su.id = tb.supervisor_id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, accuracy, recorded_at
         FROM student_locations
         WHERE attendance_id = sa.id
         ORDER BY recorded_at DESC, id DESC
         LIMIT 1
       ) sl ON TRUE
       WHERE sa.teacher_batch_id = $1
         AND sa.date = $2
         AND sa.status = 'checked_in'
         AND (sl.latitude IS NOT NULL OR sa.check_in_lat IS NOT NULL)`,
      [teacherBatchId, today]
    );
    res.json({
      students: result.rows,
      in_schedule: true,
      message: null,
    });
  } catch (err) {
    console.error("getBatchCurrentLocations error:", err);
    res.status(500).json({ message: "Failed to fetch locations." });
  }
};

// GET /api/location/history/:studentId?date=YYYY-MM-DD
// Trail of a single student's movement for a given day (defaults to today).
// Only returns data if the date falls within an active work immersion schedule.
exports.getStudentLocationHistory = async (req, res) => {
  const { studentId } = req.params;
  const date = req.query.date || nowInManilaDateOnly();

  try {
    const attendanceRes = await pool.query(
      `SELECT id, teacher_batch_id FROM student_attendance WHERE student_id = $1 AND date = $2`,
      [studentId, date]
    );
    const attendance = attendanceRes.rows[0];

    let locations = [];
    if (attendance) {
      const gate = await assertBatchAccess(req.user, attendance.teacher_batch_id);
      if (!gate.ok) return res.status(gate.denied.status).json({ message: gate.denied.error });
      const schedule = await getBatchScheduleForDate(attendance.teacher_batch_id, date);
      if (schedule) {
        const result = await pool.query(
          `SELECT sl.latitude, sl.longitude, sl.accuracy, sl.recorded_at
           FROM student_locations sl WHERE sl.attendance_id = $1 AND sl.student_id = $2
           ORDER BY sl.recorded_at ASC, sl.id ASC`,
          [attendance.id, studentId]
        );
        locations = result.rows;
      }
    }

    res.json(locations);
  } catch (err) {
    console.error("getStudentLocationHistory error:", err);
    res.status(500).json({ message: "Failed to fetch location history." });
  }
};
