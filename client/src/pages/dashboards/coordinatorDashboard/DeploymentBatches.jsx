import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight } from 'lucide-react';
import { partnerDeploymentApi } from '../../../api/partnerDeploymentApi';
import { DeploymentDialog } from '../PartnerDeployments';
import styles from '../PartnerDeployments.module.css';

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });
const yearFormat = new Intl.DateTimeFormat('en-PH', { year: 'numeric', timeZone: 'Asia/Manila' });

function formatDate(value) {
  return dateFormat.format(new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value));
}

function scheduleDates(schedule) {
  return schedule ? `${formatDate(schedule.start)} – ${formatDate(schedule.end)}` : 'Unavailable';
}

function DeploymentBadge({ deployment }) {
  const cancelled = deployment.schedule_status === 'cancelled';
  const state = deployment.archived ? 'completed' : cancelled ? 'cancelled' : 'approved';
  const label = deployment.archived ? 'Archived' : cancelled ? 'Cancelled' : 'Deployed';
  return <span className={styles.badge} data-state={state}>{label}</span>;
}

function DeployedInstitutionCard({ deployment, onOpen }) {
  const headingId = useId();
  const details = [
    ['Assigned Teacher', deployment.teacher_name || 'Unassigned'],
    ['Assigned Supervisor', deployment.supervisor_name || 'Unassigned'],
    ['Students Deployed', deployment.student_count],
    ['Attendance Records', deployment.attendance_count ?? 0],
    ['Deployment Schedule', scheduleDates(deployment.confirmed_schedule)],
  ];

  return <article className={`${styles.partnerCard} ${styles.interactivePartnerCard}`} aria-labelledby={headingId}>
    <header className={styles.partnerCardHeader}>
      <span className={styles.partnerIcon}><Building2 size={21} aria-hidden="true" /></span>
      <h3 id={headingId} className={styles.partnerName}>{deployment.partner_name}</h3>
      <p className={styles.partnerMeta}>{deployment.reference}</p>
      <DeploymentBadge deployment={deployment} />
    </header>
    <dl className={styles.partnerDetails}>
      {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <div className={styles.partnerCardFooter}>
      <span className={styles.batchRosterAction} aria-hidden="true">
        View deployed students <ChevronRight size={16} />
      </span>
    </div>
    <button type="button" className={styles.partnerCardTrigger} aria-haspopup="dialog"
      aria-label={`View deployed students at ${deployment.partner_name} · ${deployment.reference}`} onClick={onOpen} />
  </article>;
}

function BatchSection({ batch, onOpen }) {
  const headingId = useId();
  const institutions = batch.deployments.length;
  return <section className={styles.batchGroup} id={`deployment-batch-${batch.id}`} aria-labelledby={headingId}>
    <header className={styles.batchGroupHeader}>
      <h2 id={headingId}>{batch.name}</h2>
      <p>Deployed <time dateTime={batch.created_at}>{formatDate(batch.created_at)}</time> ·{' '}
        {institutions} {institutions === 1 ? 'institution' : 'institutions'}</p>
    </header>
    <div className={styles.cards}>
      {batch.deployments.map((deployment) => <DeployedInstitutionCard key={deployment.request_id} deployment={deployment}
        onOpen={() => onOpen({ batchId: batch.id, requestId: deployment.request_id })} />)}
    </div>
  </section>;
}

function BatchRosterDialog({ batchId, deployment, onClose }) {
  const [result, setResult] = useState({ loading: true });

  useEffect(() => {
    let active = true;
    partnerDeploymentApi('coordinator', `/batches/${batchId}/roster`).then(
      ({ students_by_request }) => { if (active) setResult({ students: students_by_request[deployment.request_id] || [] }); },
      (error) => { if (active) setResult({ error: error.message }); },
    );
    return () => { active = false; };
  }, [batchId, deployment.request_id]);

  return <DeploymentDialog title={`${deployment.partner_name} · ${deployment.reference}`} onClose={onClose}>
    <p>{deployment.teacher_name || 'Unassigned teacher'} · {deployment.supervisor_name || 'Unassigned supervisor'}</p>
    <div className={styles.actions}>
      <DeploymentBadge deployment={deployment} />
      <span>{scheduleDates(deployment.confirmed_schedule)}</span>
    </div>
    {result.loading && <p role="status">Loading deployed students…</p>}
    {result.error && <p className={styles.error} role="alert">{result.error}</p>}
    {result.students && (result.students.length ? <ul className={styles.roster} aria-label="Deployed students">
      {result.students.map((student) => <li key={student.student_id}>
        <span className={styles.studentSummary}>
          <strong>{[student.first_name, student.last_name].filter(Boolean).join(' ')}</strong>
          <small>{[student.student_number, student.track_strand, student.section].filter(Boolean).join(' · ')}</small>
        </span>
        {student.deployment_ended_on && <small>Placement ended {formatDate(student.deployment_ended_on)}</small>}
      </li>)}
    </ul> : <p className={styles.hint}>No deployed students for this institution.</p>)}
  </DeploymentDialog>;
}

export default function DeploymentBatches() {
  const [params] = useSearchParams();
  const [result, setResult] = useState({ loading: true });
  const [revision, setRevision] = useState(0);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;
    partnerDeploymentApi('coordinator', '/batches').then(
      ({ batches }) => { if (active) setResult({ batches }); },
      (error) => { if (active) setResult((previous) => ({ ...previous, loading: false, error: error.message })); },
    );
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') setRevision((current) => current + 1);
    };
    const interval = window.setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
    };
  }, []);

  const batches = (result.batches || []).map((batch) => ({
    ...batch, year: yearFormat.format(new Date(batch.created_at)),
  }));
  const years = [...new Set(batches.map(({ year }) => year))].sort((a, b) => Number(b) - Number(a));
  const yearFilter = years.includes(selectedYear) ? selectedYear : '';
  const batchOptions = yearFilter ? batches.filter(({ year }) => year === yearFilter) : batches;
  const batchFilter = batchOptions.some(({ id }) => String(id) === selectedBatchId) ? selectedBatchId : '';
  const visibleBatches = batchFilter ? batchOptions.filter(({ id }) => String(id) === batchFilter) : batchOptions;
  const linkedBatch = params.get('batch');
  const showLinkedBatch = visibleBatches.some(({ id }) => String(id) === linkedBatch);
  const deployment = batches.find(({ id }) => id === selected?.batchId)?.deployments
    .find(({ request_id }) => request_id === selected.requestId);

  useEffect(() => {
    if (showLinkedBatch) document.getElementById(`deployment-batch-${linkedBatch}`)?.scrollIntoView({ block: 'nearest' });
  }, [linkedBatch, showLinkedBatch]);

  function changeYear(year) {
    setSelectedYear(year);
    if (year && !batches.some((batch) => batch.year === year && String(batch.id) === selectedBatchId)) {
      setSelectedBatchId('');
    }
  }

  return <main className={`${styles.page} ${styles.coordinatorPage}`}>
    <header className={`${styles.header} ${styles.batchPageHeader}`}>
      <div>
        <h1>Batches</h1>
        <p>Monitor deployed partner institutions, schedules, and attendance.</p>
      </div>
      <div className={styles.batchHeaderActions}>
        {years.length > 0 && <label className={styles.batchHeaderFilter}>Deployment year
          <select value={yearFilter} onChange={(event) => changeYear(event.target.value)}>
            <option value="">All years</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>}
        {batchOptions.length > 0 && <label className={styles.batchHeaderFilter}>Batch
          <select value={batchFilter} onChange={(event) => setSelectedBatchId(event.target.value)}>
            <option value="">All batches</option>
            {batchOptions.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
          </select>
        </label>}
        <Link className={styles.primary} to="/dashboard/coordinator/deployment?stage=completed">Create Batch</Link>
      </div>
    </header>
    {result.loading && <p role="status">Loading batches…</p>}
    {result.error && <p className={styles.error} role="alert">{result.error}</p>}
    {visibleBatches.map((batch) => <BatchSection key={batch.id} batch={batch} onOpen={setSelected} />)}
    {result.batches && batches.length === 0 && <p className={styles.hint}>No batches have been deployed yet.</p>}
    {deployment && <BatchRosterDialog key={deployment.request_id} batchId={selected.batchId} deployment={deployment}
      onClose={() => setSelected(null)} />}
  </main>;
}
