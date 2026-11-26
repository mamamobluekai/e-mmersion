import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, BriefcaseBusiness, CalendarCheck2, ClipboardCheck, GraduationCap, X } from 'lucide-react';
import { fetchAdminMonitoring } from '../../../api/adminApi';
import about from '../About.module.css';
import archived from './ArchivedPeriods.module.css';
import styles from './ImmersionMonitoring.module.css';

const roles = {
  student: {
    title: 'Student Monitoring', singular: 'Student', subject: 'students', affiliation: 'Track / strand', subgroup: 'Section', identifier: 'Student number',
    description: 'Follow requirements, placements, attendance, and post-immersion milestones for each student.',
  },
  supervisor: {
    title: 'Supervisor Monitoring', singular: 'Supervisor', subject: 'supervisors', affiliation: 'Company', subgroup: 'Designation', identifier: 'Employee ID',
    description: 'Review partner affiliations, assigned deployments, evaluations, appeals, and certificates.',
  },
  teacher: {
    title: 'Teacher Monitoring', singular: 'Teacher', subject: 'teachers', affiliation: 'School', subgroup: 'Department', identifier: 'Employee ID',
    description: 'Review batch assignments, attendance setup, documentation reviews, and concerns that need follow-up.',
  },
};

const navButton = `${about.primaryButton} ${styles.secondaryButton}`;
const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
const numberFormat = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 });

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? '—' : dateFormat.format(date);
}

function dateRange(start, end) {
  if (start && end) return `${dateLabel(start)} – ${dateLabel(end)}`;
  return dateLabel(start || end);
}

function Status({ value }) {
  if (!value) return '—';
  const label = value.replaceAll('_', ' ').toLowerCase();
  return <span className={styles.status}>{label}</span>;
}

function RecordTable({ label, headers, children, scrollable = false }) {
  const headingId = `${label.toLowerCase().replaceAll(' ', '-')}-table`;
  return (
    <div className={scrollable ? `${styles.tableWrap} ${styles.directoryTable}` : styles.tableWrap} role="region" aria-labelledby={headingId} tabIndex={0}>
      <table className={styles.table}>
        <caption id={headingId} className={styles.visuallyHidden}>{label}</caption>
        <thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function RecordSection({ title, children }) {
  return (
    <section className={styles.section}>
      <div className={about.sectionHeading}><h2>{title}</h2></div>
      {children}
    </section>
  );
}

function Metrics({ items }) {
  return (
    <dl className={styles.metrics}>
      {items.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

function openRecordRow(event) {
  if (event.target.closest('a') || window.getSelection()?.toString()) return;
  const link = event.currentTarget.querySelector('a');
  link?.focus({ preventScroll: true });
  link?.click();
}

function DirectoryFilters({ role, params, onFilter }) {
  const { key } = useLocation();
  const inputRef = useRef(null);
  const timer = useRef(null);
  const search = params.get('search') || '';
  const status = params.get('status') || 'all';

  useEffect(() => {
    const input = inputRef.current;
    if (input.value.trim() !== search) input.value = search;
    return () => clearTimeout(timer.current);
  }, [key, search]);

  function updateFilters(event) {
    const submitted = event.type === 'submit';
    if (submitted) event.preventDefault();
    clearTimeout(timer.current);
    const form = new FormData(submitted ? event.currentTarget : event.currentTarget.form);
    const update = () => onFilter(form.get('search'), form.get('status'));
    if (submitted || event.currentTarget.name === 'status') update();
    else timer.current = setTimeout(update, 250);
  }

  return (
    <form className={styles.filters} role="search" aria-label={`Filter ${roles[role].subject}`} onSubmit={updateFilters}>
      <label>
        Search {roles[role].subject}
        <input ref={inputRef} type="search" name="search" maxLength={100} defaultValue={search} placeholder="Name, email, or ID" onChange={updateFilters} />
      </label>
      <label>
        Account status
        <select name="status" value={status} onChange={updateFilters}>
          <option value="all">All statuses</option>
          <option value="active">Active or approved</option>
          <option value="pending">Pending</option>
          <option value="other">Other statuses</option>
          {role === 'student' && <option value="archived">Archived</option>}
        </select>
      </label>
    </form>
  );
}

function Directory({ data, role, basePath, query, params, onFilter, feedback }) {
  const config = roles[role];
  const { profiles = [], total = 0, page = 1, pageSize = 20 } = data || {};
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const pageLink = (nextPage) => {
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', nextPage);
    else next.delete('page');
    return { search: next.toString() };
  };

  return (
    <RecordSection title={`${config.singular} records`}>
      <DirectoryFilters role={role} params={params} onFilter={onFilter} />
      {feedback}
      {!!data && (profiles.length > 0 ? (
        <RecordTable label={`${config.title} records`} headers={['Name', config.affiliation, 'Immersion period', 'Account status',
          ...(role === 'student' ? ['Requirements'] : [])]} scrollable>
          {profiles.map((profile) => (
            <tr key={profile.id} className={styles.directoryRow} onClick={openRecordRow}>
              <th scope="row">
                <Link
                  className={styles.recordLink}
                  to={`${basePath}/${profile.id}${query}`}
                  state={{ fromMonitoringDirectory: true }}
                  aria-haspopup="dialog"
                >
                  {profile.name}<ArrowRight size={15} aria-hidden="true" />
                </Link>
                {profile.name !== profile.email && <small>{profile.email}</small>}
              </th>
              <td>{profile.affiliation || '—'}{profile.subgroup && <small>{profile.subgroup}</small>}</td>
              <td>{profile.period_name || '—'}</td>
              <td><Status value={profile.account_group === 'archived' ? 'archived' : profile.status} /></td>
              {role === 'student' && <td>
                <Status value={profile.requirements?.status} />
                {profile.requirements && <small>{profile.requirements.approved} of {profile.requirements.total} approved</small>}
              </td>}
            </tr>
          ))}
        </RecordTable>
      ) : <p className={styles.message}>{total ? 'No records on this page.' : `No ${config.subject} match these filters.`}</p>)}
      {total > 0 && (
        <div className={styles.pagination}>
          <span>{profiles.length ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + profiles.length} of ` : ''}{total} {config.subject}</span>
          <nav aria-label="Monitoring results pages">
            {page > 1 && <Link className={navButton} to={pageLink(Math.min(lastPage, page - 1))}>Previous</Link>}
            {page < lastPage && <Link className={navButton} to={pageLink(page + 1)}>Next</Link>}
          </nav>
        </div>
      )}
    </RecordSection>
  );
}

function StudentDetails({ details }) {
  const { journey, placements, records } = details;
  const { requirements, attendance, documentation, hours, days } = journey;
  const cards = [
    [ClipboardCheck, 'Pre-immersion', journey.stages.pre],
    [CalendarCheck2, 'Immersion proper', journey.stages.immersion,
      `${attendance.completed} of ${attendance.total} attendance days completed`, `${documentation.completed} of ${documentation.total} documentation days reviewed`],
    [GraduationCap, 'Post-immersion', journey.stages.post,
      `${records.evaluations} completed evaluations · ${records.certificates} certificates issued`, `${records.feedback} placement feedback submissions`],
  ];

  return (
    <>
      <RecordSection title="Requirements">
        <p className={styles.context}><Status value={requirements.displayStatus || requirements.status} />
          {' '}{requirements.approved} of {requirements.total} approved</p>
        {requirements.checklist?.length ? (
          <RecordTable label="Pre-immersion requirements" headers={['Requirement', 'Status']}>
            {requirements.checklist.map((item) => (
              <tr key={item.id}><th scope="row">{item.name}</th><td><Status value={item.status} /></td></tr>
            ))}
          </RecordTable>
        ) : <p className={styles.message}>No active requirements to display.</p>}
      </RecordSection>
      <RecordSection title="Immersion journey">
        <div className={about.featureGrid}>
          {cards.map(([Icon, title, stage, primary, secondary]) => (
            <article className={about.featureCard} key={title}>
              <span className={about.cardIcon}><Icon size={21} aria-hidden="true" /></span>
              <h3>{title}</h3>
              <Status value={stage} />
              {primary && <p>{primary}</p>}
              {secondary && <p>{secondary}</p>}
            </article>
          ))}
        </div>
        {journey.awaitingEvaluation && <p className={`${about.systemCallout} ${styles.callout}`}>Awaiting evaluation to unlock post-immersion.</p>}
        <Metrics items={[
          ['Mission progress', journey.percent === null ? 'No schedule published' : `${journey.percent}%`],
          ['Credited / required hours', days.length ? `${numberFormat.format(hours.credited)} / ${numberFormat.format(hours.required)} h` : '—'],
          ['Recorded hours', days.length ? `${numberFormat.format(hours.recorded)} h` : '—'],
          ['Pending attendance appeals', records.attendance_appeals],
          ['Pending grade appeals', records.grade_appeals],
        ]} />
      </RecordSection>
      <RecordSection title="Placement history">
        {records.preferred_partner && <p className={styles.context}>Preferred partner <strong>{records.preferred_partner}</strong></p>}
        {placements.length ? (
          <RecordTable label="Student placements" headers={['Deployment or batch', 'Partner', 'Teachers and supervisor', 'Placement status', 'Placement dates']}>
            {placements.map((item) => (
              <tr key={item.deployment_id ? `deployment-${item.deployment_id}` : `batch-${item.batch_id}`}>
                <th scope="row">{item.label}{item.period_name && <small>{item.period_name}</small>}</th>
                <td>{item.partner || '—'}</td>
                <td>{item.teachers || '—'}{item.supervisor && <small>Supervisor {item.supervisor}</small>}</td>
                <td>
                  <Status value={item.archived ? 'archived' : item.released_on ? 'released' : item.decision || (item.batch_id ? 'assigned' : item.deployment_status)} />
                  {item.deployment_status && <small>Deployment {item.deployment_status.replaceAll('_', ' ')}</small>}
                </td>
                <td>{dateRange(item.start_date, item.scheduled_end)}{item.released_on && <small>Released {dateLabel(item.released_on)}</small>}</td>
              </tr>
            ))}
          </RecordTable>
        ) : <p className={styles.message}>No placement records for this student.</p>}
      </RecordSection>
      <RecordSection title="Daily progress">
        {days.length ? (
          <RecordTable label="Daily immersion progress" headers={['Date', 'Batch', 'Attendance', 'Documentation', 'Recorded hours']}>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{dateLabel(day.date)}</th><td>{day.batchLabel || '—'}</td>
                <td><Status value={day.attendance} /></td><td><Status value={day.documentation} /></td>
                <td>{numberFormat.format(day.recordedHours)} h</td>
              </tr>
            ))}
          </RecordTable>
        ) : <p className={styles.message}>Daily progress is available once requirements are complete and the student has immersion workdays.</p>}
      </RecordSection>
    </>
  );
}

function StaffDetails({ details, role }) {
  const { deployments, partners } = details;
  const teacher = role === 'teacher';
  const WorkIcon = teacher ? BookOpenCheck : BriefcaseBusiness;

  return (
    <>
      {partners && (
        <RecordSection title="Partner affiliations">
          {partners.length ? <ul className={styles.partners}>{partners.map((partner) => (
            <li key={partner.name}>{partner.name} <Status value={partner.is_active ? 'active' : 'inactive'} /></li>
          ))}</ul> : <p className={styles.message}>No partner affiliations on record.</p>}
        </RecordSection>
      )}
      <RecordSection title="Deployments and batches">
        {deployments.length ? <div className={styles.deployments}>{deployments.map((item) => (
          <article className={about.featureCard} key={item.deployment_id ? `deployment-${item.deployment_id}` : `batch-${item.batch_id}`}>
            <div className={styles.deploymentTitle}>
              <span className={about.cardIcon}><WorkIcon size={21} aria-hidden="true" /></span>
              <div><h3>{item.label}</h3><p>{[item.partner, item.period_name].filter(Boolean).join(' · ')}</p></div>
              <Status value={item.archived ? 'archived' : item.status} />
            </div>
            <Metrics items={[
              ['Schedule', item.starts_on || item.ends_on ? dateRange(item.starts_on, item.ends_on) : 'Unpublished'],
              ['Scheduled workdays', item.scheduled_days],
              ['Current / total roster', item.batch_id ? `${item.current_roster} / ${item.roster_students}` : '—'],
              ['Placement decisions pending', item.deployment_id ? item.pending_placements : '—'],
              ['Attendance setup', item.batch_id ? (item.attendance_configured ? 'Configured' : 'Not configured') : '—'],
              ['Attendance records / absences', item.batch_id ? `${item.attendance_records} / ${item.recorded_absences}` : '—'],
              ['Open supervisor concerns', item.batch_id ? item.open_reports : '—'],
              ...(teacher ? [
                ['Documentation to review', item.batch_id ? item.pending_documentation : '—'],
                ['Reviewed documentation', item.batch_id ? item.reviewed_documentation : '—'],
                ['Pending attendance appeals', item.batch_id ? item.attendance_appeals : '—'],
              ] : [
                ['Students evaluated', item.batch_id ? item.evaluated_students : '—'],
                ['Pending grade appeals', item.batch_id ? item.grade_appeals : '—'],
                ['Certificates issued', item.batch_id ? item.certificates : '—'],
                ['Placement feedback received', item.deployment_id ? item.feedback : '—'],
              ]),
            ]} />
            {item.amendment_pending && <p className={`${about.systemCallout} ${styles.callout}`}>Schedule amendment awaiting a decision.</p>}
          </article>
        ))}</div> : <p className={styles.message}>No deployments or batches assigned.</p>}
      </RecordSection>
    </>
  );
}

function useMonitoringRequest(role, { userId, search = '' }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const requestKey = JSON.stringify([role, userId, search, revision]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminMonitoring(role, { userId, params: userId ? undefined : new URLSearchParams(search), signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, error: error.message });
      });
    return () => controller.abort();
  }, [role, userId, search, requestKey]);

  return { current: result?.key === requestKey ? result : null, retry: () => setRevision((value) => value + 1) };
}

function MonitoringFeedback({ request }) {
  const { current, retry } = request;
  if (!current) return <p className={styles.message} role="status">Loading monitoring records…</p>;
  if (!current.error) return null;
  return (
    <div className={styles.message} role="alert">
      <p>{current.error}</p>
      <button type="button" className={navButton} onClick={retry}>Try again</button>
    </div>
  );
}

function ProfileDetails({ profile, details, role }) {
  const config = roles[role];
  return (
    <>
      <RecordSection title="Account details">
        <Metrics items={[
          [config.identifier, profile.identifier], [config.affiliation, profile.affiliation], [config.subgroup, profile.subgroup],
          ['Immersion period', profile.period_name], ['Last sign-in', profile.last_login ? dateLabel(profile.last_login) : 'No record'],
        ]} />
        {!details && <p className={styles.message}>This account has no {role} profile on record.</p>}
      </RecordSection>
      {details && (role === 'student' ? <StudentDetails details={details} /> : <StaffDetails details={details} role={role} />)}
    </>
  );
}

function MonitoringRecordModal({ role, userId, onClose }) {
  const dialogRef = useRef(null);
  const request = useMonitoringRequest(role, { userId });
  const record = request.current?.data;
  const profile = record?.profile;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`${about.page} ${styles.modal}`}
      aria-labelledby="monitoring-record-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className={styles.modalHeader}>
        <div className={styles.modalHeading}>
          <h2 id="monitoring-record-title">{profile?.name || `${roles[role].singular} record`}</h2>
          {profile && (
            <>
              {profile.email !== profile.name && <p>{profile.email}</p>}
              <div className={styles.headerStatus}>
                <Status value={profile.account_group === 'archived' ? 'archived' : profile.status} />
              </div>
            </>
          )}
        </div>
        <button type="button" className={styles.modalClose} aria-label={`Close ${role} record`} onClick={onClose}>
          <X size={21} aria-hidden="true" />
        </button>
      </header>
      <div className={`${styles.content} ${styles.modalBody}`}>
        <MonitoringFeedback request={request} />
        {profile && <ProfileDetails profile={profile} details={record.details} role={role} />}
      </div>
    </dialog>
  );
}

export default function ImmersionMonitoring({ role }) {
  const { userId } = useParams();
  const { search, state } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const config = roles[role];
  const basePath = `/dashboard/admin/${role}-monitoring`;
  const directory = useMonitoringRequest(role, { search });

  function applyFilters(searchValue, status) {
    const searchText = searchValue.trim();
    if (searchText === (params.get('search') || '') && status === (params.get('status') || 'all')) return;
    const next = new URLSearchParams();
    if (searchText) next.set('search', searchText);
    if (status !== 'all') next.set('status', status);
    setParams(next, { replace: true });
  }

  function closeRecordModal() {
    if (state?.fromMonitoringDirectory) navigate(-1);
    else navigate(`${basePath}${search}`, { replace: true });
  }

  return (
    <>
      <header className={`${archived.page} ${archived.pageHeader}`} aria-labelledby="monitoring-title">
        <div className={styles.headerCopy}>
          <h1 id="monitoring-title">{config.title}</h1>
          <p>{config.description}</p>
        </div>
      </header>

      <div className={`${about.page} ${styles.content}`}>
        <Directory data={directory.current?.data} role={role} basePath={basePath} query={search} params={params} onFilter={applyFilters}
          feedback={<MonitoringFeedback request={directory} />} />
      </div>
      {userId && <MonitoringRecordModal key={`${role}-${userId}`} role={role} userId={userId} onClose={closeRecordModal} />}
    </>
  );
}
