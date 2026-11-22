// Supervisor-blocked immersion dates and the Philippine holiday calendar.
//
// A blocked date is one the supervisor marks as unavailable for a batch - a
// school event, a non-working day that is not on the national calendar, and so
// on. Blocked dates never count as immersion days even when they fall Mon-Fri.
//
// Both this and the shared day builder (server/utils/immersionDays.js) treat
// weekends, ph_holidays and blocked dates as excluded, so every role sees the
// same day numbers.
const pool = require('../../db/');
const { assertBatchAccess } = require('../../utils/batchAccess');
const {
  toDateOnly,
  loadExcludedDates,
  ensureExclusionTables,
  invalidateHolidayCache,
} = require('../../utils/immersionDays');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Both tables are created idempotently by the shared helper, which also seeds
// the fixed-date holidays. Kept as a local alias so the handler bodies below
// read the same as the other controllers.
const ensureBlockedDateTables = ensureExclusionTables;

// Only the supervisor linked to the batch (or its coordinator) may change
// blocked dates; a teacher can read them but must not block a school day.
async function assertCanManage(user, batchId) {
  const gate = await assertBatchAccess(user, batchId);
  if (!gate.ok) return { error: gate.denied.error, status: gate.denied.status };
  const { isSupervisor, isCoordinator, batch } = gate.access;
  if (!isSupervisor && !isCoordinator) {
    return { error: 'Only the batch supervisor or coordinator can block dates.', status: 403 };
  }
  return { batch };
}

/**
 * GET /api/supervisor/batches/:batchId/blocked-dates?supervisor_id=
 * Lists the blocked dates and the holiday calendar, merged and sorted, so the
 * calendar UI can mark both in one request.
 */
const getBlockedDates = async (req, res) => {
  try {
    await ensureBlockedDateTables();
    const batchId = Number(req.params.batchId);
    if (!Number.isInteger(batchId)) return res.status(400).json({ error: 'Invalid batch id.' });

    const gate = await assertBatchAccess(req.user, batchId);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const requested = req.query.supervisor_id;
    // 'all' returns every scope for the batch, so the calendar can mark each
    // group's own blocked dates without one request per group.
    const allScopes = requested === 'all';
    const supervisorId =
      requested === 'batch' || requested === 'null' || requested === undefined
        ? null
        : Number(requested);
    if (
      !allScopes &&
      requested !== undefined &&
      requested !== 'batch' &&
      requested !== 'null' &&
      !Number.isInteger(supervisorId)
    ) {
      return res.status(400).json({ error: 'Invalid supervisor id.' });
    }

    if (allScopes) {
      const allRes = await pool.query(
        `SELECT id, teacher_batch_id, supervisor_id,
                to_char(blocked_date, 'YYYY-MM-DD') AS blocked_date, reason
           FROM work_immersion_blocked_dates
          WHERE teacher_batch_id = $1
          ORDER BY blocked_date`,
        [batchId]
      );
      const holidayRes = await pool.query(
        `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name, is_regular
           FROM ph_holidays ORDER BY holiday_date`
      );
      return res.json({
        blocked_dates: allRes.rows.map((r) => ({
          id: r.id,
          date: r.blocked_date,
          reason: r.reason || null,
          supervisor_id: r.supervisor_id,
          scope: r.supervisor_id == null ? 'batch' : 'supervisor',
        })),
        holidays: holidayRes.rows.map((h) => ({
          date: h.holiday_date,
          name: h.name,
          is_regular: h.is_regular,
        })),
      });
    }

    const { blockedRows, holidayRows } = await loadExcludedDates(batchId, supervisorId);

    return res.json({
      blocked_dates: blockedRows.map((r) => ({
        id: r.id,
        date: r.blocked_date,
        reason: r.reason || null,
        supervisor_id: r.supervisor_id,
        scope: r.supervisor_id == null ? 'batch' : 'supervisor',
      })),
      holidays: holidayRows.map((h) => ({
        date: h.holiday_date,
        name: h.name,
        is_regular: h.is_regular,
      })),
    });
  } catch (err) {
    console.error('getBlockedDates error:', err);
    return res.status(500).json({ error: 'Failed to load blocked dates.' });
  }
};

/**
 * POST /api/supervisor/batches/:batchId/blocked-dates
 * body: { date, reason?, supervisor_id? }  (omit supervisor_id for batch-wide)
 */
const getHolidays = async (req, res) => {
  try {
    await ensureBlockedDateTables();
    const { holidayRows } = await loadExcludedDates(null, null);
    return res.json({
      holidays: holidayRows.map((h) => ({
        date: h.holiday_date,
        name: h.name,
        is_regular: h.is_regular,
      })),
    });
  } catch (err) {
    console.error('getHolidays error:', err);
    return res.status(500).json({ error: 'Failed to load holidays.' });
  }
};

/**
 * POST /api/supervisor/holidays
 * body: { date, name, is_regular? }  - for proclaimed special non-working days
 */
const addHoliday = async (req, res) => {
  try {
    await ensureBlockedDateTables();
    const date = toDateOnly(req.body?.date);
    const name = req.body?.name ? String(req.body.name).slice(0, 120) : null;
    if (!date || !DATE_RE.test(date)) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
    }
    if (!name) return res.status(400).json({ error: 'A holiday name is required.' });

    const isRegular = Boolean(req.body?.is_regular);
    const inserted = await pool.query(
      `INSERT INTO ph_holidays (holiday_date, name, is_regular, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (holiday_date) DO UPDATE
         SET name = EXCLUDED.name, is_regular = EXCLUDED.is_regular
       RETURNING id`,
      [date, name, isRegular, req.user.id]
    );
    invalidateHolidayCache();

    return res.status(201).json({
      message: 'Holiday saved.',
      holiday: { id: inserted.rows[0]?.id, date, name, is_regular: isRegular },
    });
  } catch (err) {
    console.error('addHoliday error:', err);
    return res.status(500).json({ error: 'Failed to save the holiday.' });
  }
};

/** DELETE /api/supervisor/holidays/:id */
const removeHoliday = async (req, res) => {
  try {
    await ensureBlockedDateTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid holiday id.' });
    const del = await pool.query('DELETE FROM ph_holidays WHERE id = $1 RETURNING id', [id]);
    if (!del.rows.length) return res.status(404).json({ error: 'Holiday not found.' });
    invalidateHolidayCache();
    return res.json({ message: 'Holiday removed.', id });
  } catch (err) {
    console.error('removeHoliday error:', err);
    return res.status(500).json({ error: 'Failed to remove the holiday.' });
  }
};

module.exports = {
  getBlockedDates,
  getHolidays,
  addHoliday,
  removeHoliday,
};
