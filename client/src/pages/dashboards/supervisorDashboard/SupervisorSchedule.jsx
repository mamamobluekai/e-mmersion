import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSupervisorBatches } from '../../../api/supervisorApi';
import styles from './SupervisorSchedule.module.css';

const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });

function formatDate(date) {
  return dateFormatter.format(new Date(date + 'T00:00:00+08:00'));
}

function formatTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
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
    </div>
    {!result && <p className={styles.loadingPanel} role="status">Loading approved deployments...</p>}
    {result?.error && <p className={styles.empty} role="alert">{result.error}</p>}
    {result && !result.error && !schedule && <p className={styles.empty}>No finalized deployments yet.</p>}
    {schedule && <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2>{deployment.batch_label}</h2>
          <p>{formatDate(schedule.start)} – {formatDate(schedule.end)}</p>
        </div>
        <Link to={'/dashboard/supervisor/deployment-requests?request=' + deployment.partner_request_id}>
          View deployment agreement
        </Link>
      </div>
      <div className={styles.agreedSchedule}>
        {batches.length > 1 && <label>Deployment
          <select value={deployment.request_id} onChange={(event) => setSelectedId(event.target.value)}>
            {batches.map(({ request_id, batch_label }) => <option key={request_id} value={request_id}>{batch_label}</option>)}
          </select>
        </label>}
        <dl>
          <div><dt>Time in</dt><dd>{formatTime(schedule.windows.time_in_open)}–{formatTime(schedule.windows.time_in_close)}</dd></div>
          <div><dt>Time out</dt><dd>{formatTime(schedule.windows.time_out_open)}–{formatTime(schedule.windows.time_out_close)}</dd></div>
        </dl>
        <details>
          <summary>View standard work immersion hours</summary>
          <p>80 total hours · {schedule.daily_hours} creditable hours per workday</p>
          <p>Time in: {formatTime(schedule.windows.time_in_open)}–{formatTime(schedule.windows.time_in_close)}</p>
          <p>Time out: {formatTime(schedule.windows.time_out_open)}–{formatTime(schedule.windows.time_out_close)}</p>
          <p>These are the standard attendance hours for every partner institution.</p>
        </details>
        <details>
          <summary>{schedule.dates.length} agreed workdays</summary>
          <ul>{schedule.dates.map((date) => <li key={date}>{formatDate(date)}</li>)}</ul>
        </details>
        {schedule.notes && <p>{schedule.notes}</p>}
      </div>
    </section>}
  </div>;
}
