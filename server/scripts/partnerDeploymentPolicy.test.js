const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildFixedDurationDates } = require('../services/partnerDeploymentPolicy');

const period = {
  start_date: '2026-12-01',
  end_date: '2026-12-21',
  working_days: 'Mon,Tue,Wed,Thu,Fri',
};

test('builds exactly ten available workdays for the fixed 80-hour schedule', () => {
  const dates = buildFixedDurationDates({
    start: '2026-12-07',
    blocked: new Set(['2026-12-09']),
    period,
    today: '2026-12-01',
    requireNotice: false,
  });

  assert.equal(dates.length, 10);
  assert.equal(dates[0], '2026-12-07');
  assert.equal(dates.at(-1), '2026-12-21');
  assert.ok(!dates.includes('2026-12-09'));
});

test('does not allow a start date that is not an available workday', () => {
  assert.throws(() => buildFixedDurationDates({
    start: '2026-12-06',
    blocked: new Set(),
    period,
    today: '2026-12-01',
    requireNotice: false,
  }), /available workday/);
});

test('rejects a period that cannot fit all ten required workdays', () => {
  assert.throws(() => buildFixedDurationDates({
    start: '2026-12-07',
    blocked: new Set(),
    period: { ...period, end_date: '2026-12-17' },
    today: '2026-12-01',
    requireNotice: false,
  }), /enough workdays/);
});

test('preserves elapsed agreed workdays when deriving an amendment schedule', () => {
  const pastDates = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10'];
  const dates = buildFixedDurationDates({
    start: '2026-12-07',
    blocked: new Set(['2026-12-09']),
    period,
    previous: { start: '2026-12-07', dates: [...pastDates, '2026-12-11'] },
    today: '2026-12-10',
  });

  assert.deepEqual(dates.slice(0, pastDates.length), pastDates);
  assert.equal(dates.length, 10);
});
