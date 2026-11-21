const { isValidManilaDate } = require('../utils/manilaDate');
const { addDays, fromDateOnly, toDateOnly } = require('../utils/immersionDays');

function requireThat(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function positiveId(value) {
  const id = Number(value);
  requireThat(Number.isInteger(id) && id > 0 && id <= 2147483647, 'Select a valid record.');
  return id;
}

function note(value, { required = false, max = 2000 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  requireThat(text.length <= max, `Use at most ${max} characters.`);
  requireThat(!required || text.length > 0, 'Provide a reason or reference.');
  return text;
}

function dateAfter(date, days) {
  return toDateOnly(addDays(fromDateOnly(date), days));
}

function capacity(value) {
  const seats = Number(value);
  requireThat(Number.isInteger(seats) && seats >= 1 && seats <= 2147483647, 'Enter a positive whole-number capacity.');
  return seats;
}

function strandKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function acceptedStrands(value, known, total, quotas = {}) {
  requireThat(value === null || Array.isArray(value), 'Choose all strands or select specific strands.');
  requireThat(quotas && typeof quotas === 'object' && !Array.isArray(quotas), 'Enter valid strand caps.');
  const catalog = new Map(known.map((name) => [strandKey(name), name]));
  const strands = value === null ? null : [...new Set(value.map(strandKey))];
  requireThat(strands === null || (strands.length > 0 && strands.every((key) => catalog.has(key))),
    'Select at least one strand from the school roster.');
  const caps = Object.create(null);
  for (const [name, rawLimit] of Object.entries(quotas)) {
    const key = strandKey(name);
    requireThat(strands?.includes(key), 'A strand cap must belong to an accepted strand.');
    caps[key] = capacity(rawLimit);
  }
  requireThat(Object.values(caps).reduce((sum, limit) => sum + limit, 0) <= total,
    'The sum of strand caps must fit within the confirmed capacity.');
  return { strands: strands?.map((key) => catalog.get(key)) ?? null, caps };
}

function proposedDates(start, end, period, today) {
  requireThat(isValidManilaDate(start) && start >= dateAfter(today, 7),
    'Choose a start date at least seven calendar days from today in the Philippines.');
  requireThat(start >= period.start_date && start <= period.end_date,
    'The start date must be within the selected school immersion period.');
  requireThat(!end || (isValidManilaDate(end) && end > start && end <= period.end_date),
    'The end date must be after the start and within the selected school immersion period.');
}

function buildConfirmedDates({ start, end, blocked, extraBlocked, period, previous, today }) {
  requireThat(isValidManilaDate(start) && isValidManilaDate(end) && end > start &&
    start >= period.start_date && end <= period.end_date,
  'Choose a schedule within the school immersion period, with an end after the start.');
  requireThat(end <= dateAfter(start, 370), 'Choose a schedule covering at most 370 days.');
  if (!previous) proposedDates(start, end, period, today);
  else if (previous.start > today && start !== previous.start) proposedDates(start, end, period, today);
  requireThat(!previous || previous.start > today || start === previous.start,
    'The start date is fixed once the placement begins.');
  requireThat(Array.isArray(extraBlocked) && extraBlocked.every((date) =>
    isValidManilaDate(date) && date >= start && date <= end), 'Enter valid excluded dates inside the schedule.');

  const excluded = new Set([...blocked, ...extraBlocked]);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const schoolDays = new Set(String(period.working_days || 'Mon,Tue,Wed,Thu,Fri').split(',').map((day) => day.trim().slice(0, 3).toLowerCase()));
  requireThat(schoolDays.size <= 5 && [...schoolDays].every((day) =>
    weekdays.some((weekday) => weekday.toLowerCase() === day)),
  'The school period must list up to five valid working days per week.');
  const dates = [];
  for (let date = start; date <= end; date = dateAfter(date, 1)) {
    if (previous && date <= today) {
      if (previous.dates.includes(date)) dates.push(date);
      continue;
    }
    const day = fromDateOnly(date).getDay();
    if (schoolDays.has(weekdays[day].toLowerCase()) && !excluded.has(date)) dates.push(date);
  }
  requireThat(dates[0] === start && dates.at(-1) === end,
    'Use actual workdays as the start and end dates.');
  requireThat(!previous || previous.dates.filter((date) => date <= today).every((date) => dates.includes(date)),
    'Past workdays and today’s workday must be preserved.');
  return dates;
}

function attendanceWindows(input) {
  const keys = ['time_in_open', 'time_in_close', 'time_out_open', 'time_out_close'];
  const windows = Object.fromEntries(keys.map((key) => [key, input?.[key]]));
  requireThat(keys.every((key) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(windows[key])),
    'Enter valid attendance times.');
  requireThat(windows.time_in_open < windows.time_in_close &&
    windows.time_in_close < windows.time_out_open && windows.time_out_open < windows.time_out_close,
  'Attendance windows must be in chronological order.');
  return windows;
}

module.exports = { requireThat, positiveId, note, dateAfter, capacity, strandKey, acceptedStrands,
  proposedDates, buildConfirmedDates, attendanceWindows };
