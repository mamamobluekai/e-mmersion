import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Building2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { fetchAdminAttendance } from '../../../api/adminApi';
import { isPresent, labelForStatus } from '../../../utils/attendanceAnalytics';
import about from '../About.module.css';
import archived from './ArchivedPeriods.module.css';
import monitoring from './ImmersionMonitoring.module.css';
import styles from './StudentAttendanceMonitoring.module.css';

const basePath = '/dashboard/admin/student-attendance-monitoring';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'full', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatDate = (iso) => dateFormat.format(new Date(`${iso}T00:00:00Z`));
const timeWindow = (start, end) => start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : 'Not configured';

function useAttendance(path) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${path}:${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    fetchAdminAttendance(path, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key, data });
    }).catch((error) => {
      if (!controller.signal.aborted) setResult({ key, error: error.message });
    });
    return () => controller.abort();
  }, [key, path]);
  return { result: result?.key === key ? result : null, retry: () => setAttempt((value) => value + 1) };
}

function AttendanceFeedback({ request, loading }) {
  if (!request.result) return <p className={monitoring.message} role="status">{loading}</p>;
  if (!request.result.error) return null;
  return <div className={monitoring.message} role="alert">
    <p>{request.result.error}</p>
    <button className={about.primaryButton} type="button" onClick={request.retry}>Try again</button>
  </div>;
}

function AttendanceHeading({ title, children }) {
  return <header className={`${archived.page} ${archived.pageHeader}`}>
    <div className={styles.heading}><h1>{title}</h1>{children}</div>
  </header>;
}

function PartnerDirectory() {
  const request = useAttendance('');
  const [search, setSearch] = useState('');
  const partners = request.result?.data?.partners;
  const matches = partners?.filter((partner) => `${partner.name} ${partner.industry}`.toLowerCase().includes(search.trim().toLowerCase()));

  return <>
    <AttendanceHeading title="Student Attendance Monitoring">
      <p>Select a partner institution to view its work immersion calendar and student attendance.</p>
    </AttendanceHeading>
    <div className={about.page}>
      <AttendanceFeedback request={request} loading="Loading partner institutions…" />
      {partners && <>
        <label className={styles.field}>Search partner institutions
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or industry" />
        </label>
        {matches.length ? <div className={about.featureGrid}>
          {matches.map((partner) => <Link key={partner.id} className={`${about.featureCard} ${styles.partnerCard}`}
            to={`${basePath}/${partner.id}`} state={{ fromPartnerDirectory: true }} aria-haspopup="dialog">
            <span className={about.cardIcon}><Building2 size={21} aria-hidden="true" /></span>
            <h3>{partner.name}</h3>
            <p>{partner.industry}{!partner.is_active && ' · Inactive'}</p>
            <p className={styles.partnerCounts}>{partner.batches} {partner.batches === 1 ? 'batch' : 'batches'} · {partner.students} {partner.students === 1 ? 'student' : 'students'}</p>
            <span className={styles.cardAction}>View attendance <ArrowRight size={16} aria-hidden="true" /></span>
          </Link>)}
        </div> : <p className={monitoring.message}>{partners.length ? 'No partners match your search.' : 'No partner institutions are on record.'}</p>}
      </>}
    </div>
  </>;
}

function WorkCalendar({ dates, month, date, onMonthChange, onSelect }) {
  const scheduled = new Set(dates);
  const months = [...new Set(dates.map((day) => day.slice(0, 7)))];
  const index = months.indexOf(month);
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return <section className={styles.panel} aria-label="Work immersion calendar">
    <h2>Work immersion calendar</h2>
    <div className={styles.monthNav}>
      <button type="button" aria-label="Previous scheduled month" disabled={index === 0} onClick={() => onMonthChange(months[index - 1])}><ChevronLeft size={20} aria-hidden="true" /></button>
      <strong aria-live="polite">{monthFormat.format(firstDay)}</strong>
      <button type="button" aria-label="Next scheduled month" disabled={index === months.length - 1} onClick={() => onMonthChange(months[index + 1])}><ChevronRight size={20} aria-hidden="true" /></button>
    </div>
    <div className={styles.calendar}>
      {weekdays.map((day) => <span key={day} className={styles.weekday}>{day}</span>)}
      {Array.from({ length: firstDay.getUTCDay() }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
      {Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const iso = `${month}-${String(day).padStart(2, '0')}`;
        return scheduled.has(iso) ? <button key={iso} type="button" aria-label={formatDate(iso)} aria-pressed={iso === date} onClick={() => onSelect(iso)}>{day}</button>
          : <span className={styles.unscheduled} key={iso}>{day}</span>;
      })}
    </div>
    <p className={styles.hint}>Select a highlighted workday to view attendance.</p>
  </section>;
}

function DayAttendance({ partnerId, batchId, batches, date, today }) {
  const params = new URLSearchParams({ date });
  if (batchId) params.set('batchId', batchId);
  const request = useAttendance(`/${encodeURIComponent(partnerId)}/day?${params}`);
  const records = request.result?.data?.records;
  const [search, setSearch] = useState('');
  const matches = records?.filter((record) => `${record.name} ${record.student_number || ''} ${record.track_strand || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const dayBatches = batches.filter((batch) => batch.dates.includes(date));
  const counts = records?.reduce((total, record) => ({
    present: total.present + Number(isPresent(record.status) || record.status === 'late'),
    absent: total.absent + Number(record.status === 'absent'),
    appeals: total.appeals + record.pending_appeals,
  }), { present: 0, absent: 0, appeals: 0 });

  return <section className={styles.panel} aria-label="Student attendance records">
    <h2>Student attendance</h2>
    <p className={styles.selectedDate}>{formatDate(date)}{date > today && ' · Upcoming workday'}</p>
    <details className={styles.batchInfo}>
      <summary>Batch and attendance window details</summary>
      {dayBatches.map((batch) => <div key={batch.id}>
        <strong>{batch.batch_label}{batch.archived && ' · Archived'}</strong>
        <p>{[batch.period_name, batch.supervisor && `Supervisor ${batch.supervisor}`, batch.daily_hours && `${batch.daily_hours} scheduled hours`].filter(Boolean).join(' · ')}</p>
        <p>Time in {timeWindow(batch.time_in_open, batch.time_in_close)} · Time out {timeWindow(batch.time_out_open, batch.time_out_close)}{batch.timezone && ` (${batch.timezone})`}</p>
      </div>)}
    </details>
    <AttendanceFeedback request={request} loading="Loading student attendance…" />
    {records && <>
      <ul className={styles.summary} aria-label="Attendance totals">
        <li><strong>{records.length}</strong> Roster entries</li><li><strong>{counts.present}</strong> Present</li>
        <li><strong>{counts.absent}</strong> Recorded absent</li><li><strong>{counts.appeals}</strong> Pending appeals</li>
      </ul>
      {!!records.length && <label className={styles.field}>Search the attendance roster
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student name, number, or strand" />
      </label>}
      {matches.length ? <div className={`${monitoring.tableWrap} ${monitoring.directoryTable}`} tabIndex={0} role="region" aria-label="Attendance roster">
        <table className={monitoring.table}>
          <thead><tr>{['Student', 'Batch', 'Status', 'Time in', 'Time out', 'Recorded hours', 'Pending appeals'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{matches.map((record) => <tr key={`${record.batch_id}-${record.student_id}`}>
            <th scope="row"><Link className={monitoring.recordLink} to={`/dashboard/admin/student-monitoring/${record.user_id}`}>{record.name}</Link>
              <small>{[record.student_number, record.track_strand].filter(Boolean).join(' · ')}</small></th>
            <td>{record.batch_label}</td><td><span className={monitoring.status}>{record.status ? labelForStatus(record.status) : date > today ? 'Upcoming' : 'Not recorded'}</span></td>
            <td>{record.time_in || '—'}</td><td>{record.time_out || '—'}</td><td>{record.recorded_hours ?? '—'}</td><td>{record.pending_appeals}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className={monitoring.message}>{records.length ? 'No students match your search.' : 'No students were assigned to this workday.'}</p>}
    </>}
  </section>;
}

function AttendanceSchedule({ partnerId, batchId, batches, today }) {
  const dates = [...new Set(batches.flatMap((batch) => batch.dates))].sort();
  const [date, setDate] = useState(() => dates.find((day) => day >= today) || dates.at(-1));
  const [month, setMonth] = useState(() => date?.slice(0, 7));
  if (!date) return <p className={monitoring.message}>No published immersion workdays for this institution.</p>;

  function changeMonth(nextMonth) {
    setMonth(nextMonth);
    setDate(dates.find((day) => day.startsWith(nextMonth)));
  }

  return <div className={styles.workspace}>
    <WorkCalendar dates={dates} month={month} date={date} onMonthChange={changeMonth} onSelect={setDate} />
    <DayAttendance partnerId={partnerId} batchId={batchId} batches={batches} date={date} today={today} />
  </div>;
}

function PartnerAttendanceModal({ partnerId, onClose }) {
  const dialogRef = useRef(null);
  const request = useAttendance(`/${encodeURIComponent(partnerId)}`);
  const data = request.result?.data;
  const [batchId, setBatchId] = useState('');
  const batches = data?.batches.filter((batch) => !batchId || String(batch.id) === batchId);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return <dialog
    ref={dialogRef}
    className={`${about.page} ${monitoring.modal} ${styles.partnerModal}`}
    aria-labelledby="partner-attendance-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <header className={monitoring.modalHeader}>
      <div className={monitoring.modalHeading}>
        <h2 id="partner-attendance-title">{data?.partner.name || 'Partner attendance'}</h2>
        {data && <p>{[data.partner.industry, data.partner.address, !data.partner.is_active && 'Inactive partner'].filter(Boolean).join(' · ')}</p>}
      </div>
      <button type="button" className={monitoring.modalClose} aria-label="Close partner attendance" onClick={onClose}>
        <X size={21} aria-hidden="true" />
      </button>
    </header>
    <div className={monitoring.modalBody}>
      <AttendanceFeedback request={request} loading="Loading the immersion schedule…" />
      {data && <>
        {!!data.batches.length && <label className={styles.field}>Immersion batch
          <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
            <option value="">All batches</option>
            {data.batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_label}{batch.period_name && ` · ${batch.period_name}`}{batch.archived && ' · Archived'}</option>)}
          </select>
        </label>}
        <AttendanceSchedule key={batchId} partnerId={partnerId} batchId={batchId} batches={batches} today={data.today} />
      </>}
    </div>
  </dialog>;
}

export default function StudentAttendanceMonitoring() {
  const { partnerId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  function closePartner() {
    if (state?.fromPartnerDirectory) navigate(-1);
    else navigate(basePath, { replace: true });
  }

  return <>
    <PartnerDirectory />
    {partnerId && <PartnerAttendanceModal key={partnerId} partnerId={partnerId} onClose={closePartner} />}
  </>;
}
