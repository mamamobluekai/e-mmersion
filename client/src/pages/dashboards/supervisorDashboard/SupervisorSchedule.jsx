import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getSupervisorBatches } from '../../../api/supervisorApi';
import styles from './SupervisorSchedule.module.css';

const monthFormatter = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function toMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function formatTime(minutes) {
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function ClockWindow({ label, opens, closes }) {
  const start = toMinutes(opens);
  const end = toMinutes(closes);
  const dialStyle = {
    '--hour-angle': `${(start % 720) / 2}deg`,
    '--minute-angle': `${(start % 60) * 6}deg`,
    '--window-angle': `${Math.min((end - start + 1440) % 1440, 720) / 2}deg`,
  };

  return <figure className={styles.clockWindow}>
    <div className={styles.clockDial} style={dialStyle} aria-hidden="true">
      <span className={styles.dialTicks} />
      <span className={styles.dialWindow} />
      <span className={styles.dialNorth}>12</span>
      <span className={styles.dialEast}>3</span>
      <span className={styles.dialSouth}>6</span>
      <span className={styles.dialWest}>9</span>
      <span className={styles.hourHand} />
      <span className={styles.minuteHand} />
      <span className={styles.dialPin} />
    </div>
    <figcaption>
      <span>{label}</span>
      <strong><time dateTime={opens}>{formatTime(start)}</time> – <time dateTime={closes}>{formatTime(end)}</time></strong>
    </figcaption>
  </figure>;
}

function WorkdayCalendar({ dates }) {
  const [monthIndex, setMonthIndex] = useState(0);
  const agreedDays = new Set(dates);
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  const index = Math.min(monthIndex, months.length - 1);
  const month = months[index];

  if (!month) return <p className={styles.calendarEmpty}>No agreed workdays.</p>;

  const first = new Date(`${month}-01T00:00:00Z`);
  const weekdayOffset = (first.getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const monthLabel = monthFormatter.format(first);
  const weeks = Array.from({ length: Math.ceil((weekdayOffset + dayCount) / 7) }, (_, week) =>
    weekdays.map((_, weekday) => week * 7 + weekday - weekdayOffset + 1));

  return <>
    <div className={styles.calendarHeading}>
      <h3 aria-live="polite">{monthLabel}</h3>
      {months.length > 1 && <div className={styles.monthControls}>
        <button type="button" aria-label="Previous month" disabled={index === 0} onClick={() => setMonthIndex(index - 1)}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Next month" disabled={index === months.length - 1} onClick={() => setMonthIndex(index + 1)}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>}
    </div>
    <table className={styles.calendarTable} aria-label={`Agreed workdays in ${monthLabel}`}>
      <thead><tr>{weekdays.map((weekday) => <th scope="col" key={weekday} aria-label={weekday}>{weekday.slice(0, 3)}</th>)}</tr></thead>
      <tbody>{weeks.map((week) => <tr key={week[0]}>{week.map((day) => {
        if (day < 1 || day > dayCount) return <td key={day} />;
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const agreed = agreedDays.has(date);
        return <td key={day}>
          <time dateTime={date} data-agreed={agreed || undefined}>
            {day}{agreed && <span className={styles.srOnly}> agreed workday</span>}
          </time>
        </td>;
      })}</tr>)}</tbody>
    </table>
    <p className={styles.calendarLegend}><span aria-hidden="true" />{agreedDays.size} agreed {agreedDays.size === 1 ? 'workday' : 'workdays'}</p>
  </>;
}

export default function SupervisorSchedule() {
  const [result, setResult] = useState(null);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    let active = true;
    getSupervisorBatches().then(
      ({ batches }) => { if (active) setResult({ batches }); },
      (error) => { if (active) setResult({ error: error.message }); },
    );
    return () => { active = false; };
  }, []);

  const batches = result?.batches || [];
  const deployment = batches.find(({ request_id }) => String(request_id) === selectedId) || batches[0];
  const schedule = deployment?.confirmed_schedule;

  return <div className={styles.page}>
    <div className={styles.pageHeader}>
      <div>
        <h1>Attendance Schedule</h1>
        <p>View the workdays and attendance hours agreed with the school coordinator.</p>
      </div>
      {batches.length > 1 && <label className={styles.deploymentFilter}>Deployment
        <select value={deployment.request_id} onChange={(event) => setSelectedId(event.target.value)}>
          {batches.map(({ request_id, batch_label }) => <option key={request_id} value={request_id}>{batch_label}</option>)}
        </select>
      </label>}
    </div>
    {!result && <p className={styles.loadingPanel} role="status">Loading approved deployments...</p>}
    {result?.error && <p className={styles.empty} role="alert">{result.error}</p>}
    {result && !result.error && !schedule && <p className={styles.empty}>No finalized deployments yet.</p>}
    {schedule && <section className={styles.card} aria-label="Agreed attendance schedule">
      <div className={styles.scheduleLayout}>
        <section className={styles.attendanceHours}>
          <h2>Attendance hours</h2>
          <p className={styles.hoursSummary}>
            <strong>{schedule.required_hours ?? 80}</strong> total hours
            {' · '}<strong>{schedule.daily_hours}</strong> creditable hours per workday
          </p>
          <div className={styles.clocks}>
            <ClockWindow label="Time in" opens={schedule.windows.time_in_open} closes={schedule.windows.time_in_close} />
            <ClockWindow label="Time out" opens={schedule.windows.time_out_open} closes={schedule.windows.time_out_close} />
          </div>
        </section>
        <section className={styles.workdays}>
          <h2>Workdays</h2>
          <WorkdayCalendar key={deployment.request_id} dates={schedule.dates || []} />
        </section>
      </div>
      {schedule.notes && <div className={styles.scheduleNotes}><h2>Schedule notes</h2><p>{schedule.notes}</p></div>}
    </section>}
  </div>;
}
