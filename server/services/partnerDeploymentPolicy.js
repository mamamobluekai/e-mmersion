const { isValidManilaDate } = require('../utils/manilaDate');
const { addDays, fromDateOnly, toDateOnly } = require('../utils/immersionDays');

const REQUIRED_IMMERSION_HOURS = 80;
const CREDITABLE_HOURS_PER_DAY = 8;
const REQUIRED_IMMERSION_DAYS = REQUIRED_IMMERSION_HOURS / CREDITABLE_HOURS_PER_DAY;

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

function proposedDates(start, period, today) {
  requireThat(isValidManilaDate(start) && start >= dateAfter(today, 7),
    'Choose a start date at least seven calendar days from today in the Philippines.');
  requireThat(start >= period.start_date && start <= period.end_date,
    'The start date must be within an active school immersion period.');
}

function buildFixedDurationDates({ start, blocked, extraBlocked = [], period, previous, today, requireNotice = true }) {
  requireThat(isValidManilaDate(start) && start >= period.start_date && start <= period.end_date,
    'Choose a start date within an active school immersion period.');
  if (!previous && requireNotice) proposedDates(start, period, today);
  else if (requireNotice && previous && previous.start > today && start !== previous.start) {
    proposedDates(start, period, today);
  }
  requireThat(!previous || previous.start > today || start === previous.start,
    'The start date is fixed once the placement begins.');
  requireThat(Array.isArray(extraBlocked) && extraBlocked.every((date) =>
    isValidManilaDate(date) && date >= start && date <= period.end_date),
  'Enter valid excluded dates inside the school immersion period.');

  const excluded = new Set([...blocked, ...extraBlocked]);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const schoolDays = new Set(String(period.working_days || 'Mon,Tue,Wed,Thu,Fri').split(',').map((day) => day.trim().slice(0, 3).toLowerCase()));
  requireThat(schoolDays.size <= 5 && [...schoolDays].every((day) =>
    weekdays.some((weekday) => weekday.toLowerCase() === day)),
  'The school period must list up to five valid working days per week.');

  const dates = [];
  const lastDateToCheck = dateAfter(start, 370);
  for (let date = start; date <= period.end_date && date <= lastDateToCheck; date = dateAfter(date, 1)) {
    if (previous && date <= today) {
      if (previous.dates.includes(date)) dates.push(date);
    } else {
      const day = fromDateOnly(date).getDay();
      if (schoolDays.has(weekdays[day].toLowerCase()) && !excluded.has(date)) dates.push(date);
    }
    if (dates.length === REQUIRED_IMMERSION_DAYS) break;
  }
  requireThat(dates.length === REQUIRED_IMMERSION_DAYS,
    'The selected start date does not leave enough workdays in the active period to complete 80 hours.');
  requireThat(dates[0] === start, 'The selected start date must be an available workday.');
  requireThat(!previous || previous.dates.filter((date) => date <= today).every((date) => dates.includes(date)),
    'Past workdays and today’s workday must be preserved.');
  return dates;
}

function proposalStudents(input, seats) {
  requireThat(Array.isArray(input), 'Select a valid list of students.');
  const ids = input.map(positiveId);
  requireThat(new Set(ids).size === ids.length, 'A student can appear only once on the proposal.');
  requireThat(ids.length <= seats, 'Adjust the proposed student assignments to fit the capacity.', 409);
  return ids.sort((first, second) => first - second);
}

module.exports = { requireThat, positiveId, note, dateAfter, capacity, strandKey, acceptedStrands,
  REQUIRED_IMMERSION_HOURS, CREDITABLE_HOURS_PER_DAY, REQUIRED_IMMERSION_DAYS,
  proposedDates, buildFixedDurationDates, proposalStudents };
