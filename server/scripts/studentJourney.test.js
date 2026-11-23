const assert = require('node:assert/strict');
const { test } = require('node:test');
const { progressForDays, summarizeJourney } = require('../services/studentJourney.service');

const today = '2026-08-04';
const first = { teacher_batch_id: 1, date: '2026-08-03', scheduledHours: 8 };
const second = { teacher_batch_id: 1, date: today, scheduledHours: 4 };
const approved = { complete: true, approved: 3, total: 3 };
const timed = {
  ...first,
  status: 'checked_out',
  check_in_time: '2026-08-03T08:00:00+08:00',
  check_out_time: '2026-08-03T16:00:00+08:00',
};

test('Immersion Proper requires approved requirements and a published schedule', () => {
  assert.deepEqual(summarizeJourney({ ...approved, complete: false }, [], {}).stages,
    { pre: 'active', immersion: 'locked', post: 'locked' });
  assert.deepEqual(summarizeJourney(approved, [], {}).stages,
    { pre: 'completed', immersion: 'locked', post: 'locked' });
  const days = progressForDays([first], [], [], [], today);
  assert.equal(summarizeJourney(approved, days, {}).stages.immersion, 'active');
});

test('a completed day, unmatched records, and submitted or pending work cannot unlock Post-Immersion', () => {
  const days = progressForDays([first, second], [timed, { ...timed, ...second, teacher_batch_id: 2 }],
    [{ ...first, status: 'graded' }, { ...second, status: 'submitted' }],
    [{ ...second, status: 'pending' }], today);

  assert.deepEqual(days.map(({ attendance, documentation }) => [attendance.status, documentation.status]),
    [['Completed', 'Completed'], ['Under Review', 'Submitted']]);
  const result = summarizeJourney(approved, days, {});
  assert.equal(result.stages.post, 'locked');
  assert.equal(result.completedMissions, 5);
  assert.equal(result.totalMissions, 8);
});

test('counts reviewed documentation and validated appeals without fabricating attendance hours', () => {
  const days = progressForDays([first, second], [timed, { ...second, status: 'present' }],
    [{ ...first, status: 'graded' }, { ...second, status: 'reviewed' }], [], today);
  const result = summarizeJourney(approved, days, {});

  assert.equal(result.stages.post, 'active');
  assert.deepEqual(result.hours, { required: 12, scheduled: 12, recorded: 8, credited: 12, recordedOnly: false });
  assert.equal(summarizeJourney(approved, days, { recordedHoursOnly: true }).stages.post, 'locked');
  assert.equal(summarizeJourney(approved, days, { schoolHours: 13 }).stages.post, 'locked');
  assert.equal(summarizeJourney(approved, days, { evaluationBeforePost: true }).awaitingEvaluation, true);
  assert.equal(summarizeJourney(approved, days, { evaluated: true }).stages.post, 'completed');
});

test('future, rejected, and incomplete records do not earn completed missions', () => {
  const future = { ...first, date: '2026-08-05' };
  const days = progressForDays([first, second, future],
    [{ ...timed, ...future }, { ...second, status: 'checked_in', check_in_time: timed.check_in_time }],
    [{ ...first, status: 'rejected' }, { ...future, status: 'graded' }],
    [{ ...first, status: 'rejected' }], today);
  assert.deepEqual(days.map(({ attendance, documentation }) => [attendance.status, documentation.status]),
    [['Needs Revision', 'Needs Revision'], ['In Progress', 'Not Started'], ['Not Started', 'Not Started']]);
});
