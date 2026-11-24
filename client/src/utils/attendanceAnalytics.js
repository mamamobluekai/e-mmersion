// Pure aggregation helpers for the teacher attendance report records.
// Kept separate from the components so the maths is easy to test and the UI
// stays presentational.

export const PRESENT_STATUSES = ['checked_in', 'checked_out', 'present'];

export const STATUS_LABELS = {
  checked_in: 'In',
  checked_out: 'Present',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'On Leave',
};

export function labelForStatus(status) {
  return STATUS_LABELS[status] || status || 'Not recorded';
}

export function getAttendanceLabel(status, date) {
  if (status) return STATUS_LABELS[status] || status;
  const today = manilaDate.format(new Date());
  if (date > today) return 'Not Started';
  if (date && date < today) return 'Absent';
  return 'Not recorded';
}

export function isPresent(status) {
  return PRESENT_STATUSES.includes(status);
}

const manilaDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Collapse flat records into one row per student with an attendance map.
 * @param {object[]} records
 * @returns {object[]} rows
 */
export function reportRows(records = []) {
  const rows = new Map();
  records.forEach((record) => {
    if (!rows.has(record.student_id)) {
      rows.set(record.student_id, { ...record, attendance: {} });
    }
    rows.get(record.student_id).attendance[record.date] = record;
  });
  return Array.from(rows.values());
}

/**
 * Present / absent / late counts for every scheduled date. Dates that have not
 * arrived yet report `upcoming: true` and are never counted as absences.
 * @returns {{date: string, present: number, absent: number, late: number, appeals: number, upcoming: boolean}[]}
 */
export function byDate(records = [], dates = []) {
  const today = manilaDate.format(new Date());
  return dates.map((date) => {
    const dayRecords = records.filter((record) => record.date === date);
    const upcoming = date > today;
    return {
      date,
      present: dayRecords.filter((r) => isPresent(r.status)).length,
      absent: upcoming ? 0 : dayRecords.filter((r) => r.status === 'absent' || (!r.status && date < today)).length,
      late: dayRecords.filter((r) => r.status === 'late').length,
      appeals: dayRecords.filter(hasAppeal).length,
      upcoming,
    };
  });
}

export function hasAppeal(record) {
  return Boolean(record && (record.appeal_time_in_id || record.appeal_time_out_id));
}

export function formatShortDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
