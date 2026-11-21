import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarDays, ChevronRight, Handshake, RefreshCw, X } from 'lucide-react';
import { partnerDeploymentApi } from '../../api/partnerDeploymentApi';
import styles from './PartnerDeployments.module.css';

const statusLabels = {
  pending: 'Pending review', approved: 'Approved', changes_requested: 'Changes requested',
  rejected: 'Rejected', cancelled: 'Cancelled', not_scheduled: 'Not scheduled',
  upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed',
  not_started: 'Not started', partially_filled: 'Partially filled', fully_filled: 'Fully filled',
};
const reviewStatuses = ['pending', 'approved', 'changes_requested', 'rejected', 'cancelled'];
const partnerRequestLabels = {
  pending: 'Request pending',
  approved: 'Request approved',
  changes_requested: 'Changes requested',
  rejected: 'Request rejected',
  cancelled: 'Request cancelled',
};
const partnerScheduleLabels = {
  not_scheduled: 'Not scheduled',
  upcoming: 'Scheduled',
  ongoing: 'Schedule ongoing',
  completed: 'Schedule completed',
  cancelled: 'Schedule cancelled',
};
const clearanceChecks = {
  partner_agreement: 'Partner agreement is in place',
  worksite_safety: 'Worksite and supervision have been checked',
  training_plan: 'Training plan matches the learners’ program',
  learner_safeguards: 'Required learner safeguards and pre-deployment steps are in place',
};
const defaultWindows = {
  time_in_open: '08:00', time_in_close: '08:30', time_out_open: '17:00', time_out_close: '17:30',
};
const timeLabels = {
  time_in_open: 'Time in opens', time_in_close: 'Time in closes',
  time_out_open: 'Time out opens', time_out_close: 'Time out closes',
};

function query(values) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString();
}

function formatDate(value) {
  if (!value) return '—';
  const date = value.length === 10 ? `${value}T00:00:00+08:00` : value;
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(date));
}

function person(student) {
  return `${student.first_name} ${student.last_name}`;
}

function useDeploymentData(role, path, refresh) {
  const key = `${role}:${path}`;
  const [result, setResult] = useState({ key: null });
  useEffect(() => {
    if (path === null) return undefined;
    let alive = true;
    partnerDeploymentApi(role, path).then(
      (data) => alive && setResult({ key, data }),
      (error) => alive && setResult({ key, error: error.message }),
    );
    return () => { alive = false; };
  }, [role, path, key, refresh]);
  return result.key === key ? result : { loading: path !== null };
}

function LoadState({ result, children }) {
  if (result.loading) return <p role="status">Loading…</p>;
  if (result.error) return <p className={styles.error} role="alert">{result.error}</p>;
  return result.data ? children(result.data) : null;
}

function Badge({ value, label = statusLabels[value] || 'No requests' }) {
  return <span className={styles.badge} data-state={value}>{label}</span>;
}

function Select({ label, children, ...props }) {
  return <label>{label}<select {...props}>{children}</select></label>;
}

function Field({ label, ...props }) {
  return <label>{label}<input {...props} /></label>;
}

function Notes({ label, ...props }) {
  return <label>{label}<textarea maxLength={2000} rows={3} {...props} /></label>;
}

function RequestList({ requests, onOpen, empty }) {
  if (!requests.length) return <p className={styles.hint}>{empty}</p>;
  return <ul className={styles.rows}>
    {requests.map((request) => (
      <li key={request.id}>
        <button className={styles.requestRow} type="button" onClick={() => onOpen(request.id)}>
          <span><strong>{request.partner_name}</strong>
            <small>{request.reference} · {formatDate(request.proposal.start)}</small></span>
          <span className={styles.badges}><Badge value={request.status} /><Badge value={request.schedule_status} /></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </li>
    ))}
  </ul>;
}

function SupervisorInbox({ requests, onOpen }) {
  const coordinators = new Map();
  for (const request of requests) {
    const key = request.coordinator_id ?? request.coordinator_name ?? request.id;
    if (!coordinators.has(key)) coordinators.set(key, []);
    coordinators.get(key).push(request);
  }
  if (!coordinators.size) return <p className={styles.hint}>No deployment requests match these filters.</p>;
  return [...coordinators.entries()].map(([id, rows]) => <section className={styles.inboxGroup} key={id}>
    <h3><span className={styles.inboxRoleLabel}>Coordinator</span>{rows[0].coordinator_name || 'School coordinator'}</h3>
    <RequestList requests={rows} onOpen={onOpen} />
  </section>);
}

function PendingRequestNotice({ card = false }) {
  return <div className={`${styles.requestPendingNotice} ${card ? styles.cardPendingNotice : ''}`} role="status">
    <p>A deployment request is pending. You can create another after the supervisor accepts this proposal and the connection is established.</p>
    <button className={`${styles.secondary} ${card ? styles.cardAction : ''}`} type="button" disabled>
      Awaiting supervisor approval
    </button>
  </div>;
}

function PartnerCard({ partner, onOpen, onCreate, revision, busy }) {
  const canAccessPartner = partner.is_active && onCreate;
  const canCreate = canAccessPartner && !partner.has_unresolved_request;
  const location = partner.address?.trim() || 'Location not set';
  const partnerInfo = [partner.industry?.trim(), location].filter(Boolean).join(' · ');
  const requestState = partner.request_count === 0 ? 'no_requests' : partner.status;
  const requestLabel = requestState === 'no_requests' ? 'No requests' : partnerRequestLabels[requestState];
  const scheduleLabel = partnerScheduleLabels[partner.schedule_status];
  const details = [
    ['Assigned Teacher', partner.teacher_name?.trim() || 'Unassigned'],
    ['Assigned Supervisor', partner.supervisor_name?.trim() || 'Unassigned'],
    ['Deployment Requests', partner.request_count ?? 'Not set'],
    ['Student Capacity', partner.confirmed_schedule?.capacity ?? partner.num_students ?? 'Not set'],
  ];

  return <article className={styles.partnerCard} aria-labelledby={`partner-name-${partner.id}`}>
    <header className={styles.partnerCardHeader}>
      <span className={styles.partnerIcon}><Building2 size={21} aria-hidden="true" /></span>
      <h2 id={`partner-name-${partner.id}`} className={styles.partnerName}>
        {canAccessPartner ? <Link className={styles.partnerTitleLink} to={`?partner=${partner.id}`}>{partner.name}</Link> : partner.name}
      </h2>
      <p className={styles.partnerMeta}>{partnerInfo}</p>
      {typeof partner.is_active === 'boolean' && <Badge
        value={partner.is_active ? 'establishment_active' : 'establishment_inactive'}
        label={partner.is_active ? 'Active' : 'Inactive'}
      />}
    </header>
    <dl className={styles.partnerDetails}>
      {details.map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>)}
    </dl>
    <div className={styles.partnerCardFooter}>
      {(requestLabel || scheduleLabel) && <div className={styles.badges} role="group" aria-label="Latest deployment status">
        {requestLabel && <Badge value={requestState} label={requestLabel} />}
        {scheduleLabel && <Badge value={partner.schedule_status} label={scheduleLabel} />}
      </div>}
      {canCreate ? <CreateDeploymentButton partner={partner} revision={revision} busy={busy} onCreate={onCreate} card /> :
      canAccessPartner && partner.has_unresolved_request ? <PendingRequestNotice card /> :
      <button className={`${styles.secondary} ${styles.cardAction}`} type="button"
        onClick={() => onOpen(partner.id)} aria-label={`View partner: ${partner.name}`}>
        View Partner <ChevronRight size={16} aria-hidden="true" />
      </button>}
    </div>
  </article>;
}

function PartnerLoading() {
  return <>
    <span className={styles.visuallyHidden} role="status">Loading partner establishments</span>
    <div className={styles.cards} aria-hidden="true">
      {[1, 2, 3].map((slot) => <div className={`${styles.partnerCard} ${styles.skeletonCard}`} key={slot}>
        <div className={styles.partnerCardHeader}>
          <span className={`${styles.partnerIcon} ${styles.skeletonBlock}`} />
          <span className={`${styles.skeletonBlock} ${styles.partnerName} ${styles.skeletonName}`} />
          <span className={`${styles.skeletonBlock} ${styles.partnerMeta} ${styles.skeletonMeta}`} />
          <span className={`${styles.skeletonBlock} ${styles.skeletonBadge}`} />
        </div>
        <div className={styles.partnerDetails}>
          {[1, 2, 3, 4].map((line) => <span className={styles.skeletonBlock} key={line} />)}
        </div>
        <div className={styles.partnerCardFooter}>
          <span className={styles.skeletonBlock} />
          <span className={styles.skeletonBlock} />
        </div>
      </div>)}
    </div>
  </>;
}

function Partners({ result, filters, setFilter, supervisors, onOpen, onCreate, revision, busy }) {
  const hasFilters = filters.search?.trim() || filters.teacher || filters.supervisor || filters.status;
  const activity = filters.active === 'all' ? '' : filters.active === 'inactive' ? ' inactive' : ' active';
  return <>
    <div className={`${styles.filterPanel} ${styles.filters} ${styles.partnerFilters}`}>
      <Field label="Search partner name" type="search" value={filters.search || ''} onChange={(event) => setFilter('search', event.target.value)} />
      <Select label="Partner activity" value={filters.active || 'active'} onChange={(event) => setFilter('active', event.target.value)}>
        <option value="active">Active partners</option><option value="inactive">Inactive partners</option><option value="all">All partners</option>
      </Select>
      <Select label="Teacher" value={filters.teacher || ''} onChange={(event) => setFilter('teacher', event.target.value)}>
        <option value="">Any teacher assignment</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option>
      </Select>
      <Select label="Supervisor" value={filters.supervisor || ''} onChange={(event) => setFilter('supervisor', event.target.value)}>
        <option value="">Any supervisor</option>{supervisors.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>)}
      </Select>
      <Select label="Request status" value={filters.status || ''} onChange={(event) => setFilter('status', event.target.value)}>
        <option value="">Any request status</option>{reviewStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
      </Select>
    </div>
    {result.loading ? <PartnerLoading /> : <LoadState result={result}>{({ partners, page, pages }) => <>
      {partners.length ? <div className={styles.cards}>
        {partners.map((partner) => <PartnerCard key={partner.id} partner={partner} onOpen={onOpen}
          onCreate={onCreate} revision={revision} busy={busy} />)}
      </div> : <section className={styles.partnerEmpty}>
        <span className={styles.partnerIcon}><Building2 size={21} aria-hidden="true" /></span>
        <h2>{hasFilters ? 'No matching partner establishments' : `No${activity} partner establishments`}</h2>
        {(hasFilters || activity) && <p>{hasFilters ? 'Try a different search or change the filters.' :
          'Choose All partners to see establishments with any activity status.'}</p>}
      </section>}
      {pages > 1 && <nav className={styles.actions} aria-label="Partner pages">
        <button className={styles.secondary} type="button" disabled={page <= 1} onClick={() => setFilter('page', page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className={styles.secondary} type="button" disabled={page >= pages} onClick={() => setFilter('page', page + 1)}>Next</button>
      </nav>}
    </>}</LoadState>}
  </>;
}

function StrandFields({ catalog, selection, setSelection, caps, setCaps }) {
  return <fieldset className={styles.fieldset}>
    <legend>Accepted strands</legend>
    <Select label="Student strands" value={selection === null ? 'all' : 'selected'}
      onChange={(event) => setSelection(event.target.value === 'all' ? null : [])}>
      <option value="all">All strands</option><option value="selected">Selected strands</option>
    </Select>
    {selection !== null && (!catalog.length ? <p className={styles.hint}>No student strands are available in the school records.</p> :
      <div className={styles.strands}>{catalog.map((strand) => {
        const checked = selection.includes(strand);
        const key = strand.trim().toLowerCase();
        return <div key={strand} className={styles.strand}>
          <label className={styles.check}><input type="checkbox" checked={checked} onChange={() => setSelection(
            checked ? selection.filter((item) => item !== strand) : [...selection, strand],
          )} />{strand}</label>
          {setCaps && checked && <Field label={`${strand} seat cap (optional)`} type="number" min="1"
            value={caps[key] ?? ''} onChange={(event) => setCaps({ ...caps, [key]: event.target.value })} />}
        </div>;
      })}</div>)}
  </fieldset>;
}

function ProposalForm({ partner, initial, revision, onSave, onCancel, busy }) {
  const [period, setPeriod] = useState(initial?.immersion_period_id || '');
  const [teacher, setTeacher] = useState(initial?.teacher_id || '');
  const [selection, setSelection] = useState(initial?.proposal.strands ?? null);
  const [creationKey] = useState(() => globalThis.crypto?.randomUUID?.() ||
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte, index) =>
      `${[4, 6, 8, 10].includes(index) ? '-' : ''}${byte.toString(16).padStart(2, '0')}`).join(''));
  const options = useDeploymentData('coordinator', `/options?${query({ partner: partner.id, period })}`, revision);
  const [data, setData] = useState(initial?.proposal);
  const [preview, setPreview] = useState(false);
  const supervisor = options.data?.authorised.find(({ id, primary }) => initial ? id === initial.supervisor_id : primary);
  const awaitingActivation = supervisor?.account_status === 'pending_activation';
  const supervisorReady = awaitingActivation || ['active', 'approved'].includes(supervisor?.account_status);
  return <>
    <p className={styles.hint}>The assigned supervisor reviews this proposal before confirming a schedule.</p>
    {options.error && <p role="alert" className={styles.error}>{options.error}</p>}
    {options.loading && <p role="status">Loading school records…</p>}
    {options.data && !supervisorReady && <p className={styles.notice}>
      {initial ? 'The supervisor assigned to this request is unavailable.' : supervisor ?
        'The registered supervisor is unavailable. Check their account in Partner Institutions.' :
        'This partner has no registered supervisor. Assign one in Partner Institutions before sending a request.'}
    </p>}
    {awaitingActivation && <p className={styles.hint}>
      You can send this request now. The assigned supervisor can review it after activating their account.
    </p>}
    {preview ? <div className={styles.panel}>
      <h3>Review proposed deployment</h3>
      <p>{partner.name} · {data.worksite}</p>
      <p>{formatDate(data.start)}{data.end ? ` – ${formatDate(data.end)}` : ''} · Student capacity: {data.capacity} students · {data.strands?.join(', ') || 'All strands'}</p>
      <p>{options.data?.teachers.find(({ id }) => id === Number(data.teacher_id))?.name}</p>
      {data.notes && <p>{data.notes}</p>}
      <div className={styles.actions}>
        <button className={styles.primary} type="button" disabled={busy || !supervisorReady} onClick={() => onSave(data)}>{busy ? 'Sending…' : initial ? 'Resubmit request' : 'Send request'}</button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => setPreview(false)}>Edit proposal</button>
      </div>
    </div> : <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      if (!supervisorReady) return;
      setData({
        ...Object.fromEntries(new FormData(event.currentTarget)),
        partner_id: partner.id,
        strands: selection,
        creation_key: creationKey,
      });
      setPreview(true);
    }}>
      <div className={styles.formGrid}>
        <Select label="School immersion period" name="period_id" value={period} required onChange={(event) => {
          setPeriod(event.target.value); setSelection(null);
        }}>
          <option value="">Select a period</option>
          {options.data?.periods.map((item) => <option key={item.id} value={item.id}>{item.period_name} · {item.required_hours} h</option>)}
        </Select>
        <Select label="Immersion teacher" name="teacher_id" value={teacher} onChange={(event) => setTeacher(event.target.value)} required>
          <option value="">Select a teacher</option>{options.data?.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Field label="Worksite address" name="worksite" defaultValue={data?.worksite ?? partner.address ?? ''} required maxLength={2000} readOnly />
        <Field label="Proposed start date" name="start" type="date" min={options.data?.earliest} defaultValue={data?.start} required />
        <Field label="Maximum students" name="capacity" type="number" min="1" defaultValue={data?.capacity} required />
      </div>
      <StrandFields catalog={options.data?.strands || []} selection={selection} setSelection={setSelection} />
      <Notes label="Special requirements or instructions (optional)" name="notes" defaultValue={data?.notes} />
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy || !supervisorReady || selection?.length === 0}>Review proposal</button>
        <button className={styles.secondary} type="button" onClick={onCancel}>Close form</button>
      </div>
    </form>}
  </>;
}

function CreateDeploymentDialog({ partner, revision, busy, onClose, onCreate }) {
  const dialogRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  function close() {
    if (busy) return;
    dialogRef.current.close();
    onClose();
  }

  return <dialog className={styles.proposalDialog} ref={dialogRef} aria-labelledby="create-deployment-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className={styles.proposalDialogHeader}>
      <div>
        <h2 id="create-deployment-title">Create deployment request</h2>
        <p className={styles.hint}>{partner.name}</p>
      </div>
      <button className={styles.dialogClose} type="button" aria-label="Close deployment request" disabled={busy} onClick={close}>
        <X size={20} aria-hidden="true" />
      </button>
    </header>
    <div className={styles.proposalDialogBody}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <ProposalForm partner={partner} revision={revision} busy={busy} onCancel={close}
        onSave={async (data) => {
          setError('');
          await onCreate(data, setError);
        }} />
    </div>
  </dialog>;
}

function CreateDeploymentButton({ partner, revision, busy, onCreate, card = false }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);

  return <>
    <button className={card ? `${styles.secondary} ${styles.cardAction}` : styles.primary} type="button"
      ref={trigger} aria-haspopup="dialog" aria-label={`Create Deployment Request for ${partner.name}`}
      disabled={busy} onClick={() => setOpen(true)}>
      Create Deployment Request {card && <ChevronRight size={16} aria-hidden="true" />}
    </button>
    {open && <CreateDeploymentDialog partner={partner} revision={revision} busy={busy} onCreate={onCreate}
      onClose={() => {
        setOpen(false);
        trigger.current?.focus();
      }} />}
  </>;
}

function ScheduleForm({ request, strands, busy, onSave, onCancel, admin }) {
  const source = request.schedule_amendment || request.confirmed_schedule || request.proposal;
  const [selection, setSelection] = useState(source.strands ?? null);
  const [caps, setCaps] = useState(source.caps || {});
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    onSave({ ...data, strands: selection, caps: Object.fromEntries(Object.entries(caps).filter(([key, value]) =>
      value && selection?.some((strand) => strand.trim().toLowerCase() === key))),
    windows: Object.fromEntries(Object.keys(defaultWindows).map((key) => [key, data[key]])),
    excluded_dates: data.excluded_dates.split(/[\s,]+/).filter(Boolean),
    acknowledge_overlap: data.acknowledge_overlap === 'on' });
  }}>
    <div className={styles.formGrid}>
      <Field label="First workday" name="start" type="date" defaultValue={source.start} required />
      <Field label="Last workday" name="end" type="date" defaultValue={source.end || ''} required />
      <Field label="Confirmed capacity" name="capacity" type="number" min="1" max={request.proposal.capacity} defaultValue={source.capacity} required />
      <Field label="Creditable hours per workday" name="daily_hours" type="number" min="1" max="8" defaultValue={source.daily_hours || 8} required />
      {Object.keys(defaultWindows).map((key) => <Field key={key} label={timeLabels[key]} name={key} type="time"
        defaultValue={source.windows?.[key] || defaultWindows[key]} required />)}
    </div>
    <Field label="Additional excluded workdays (optional, YYYY-MM-DD separated by commas)" name="excluded_dates"
      defaultValue={source.excluded_dates?.join(', ')} />
    <StrandFields catalog={strands} selection={selection} setSelection={setSelection} caps={caps} setCaps={setCaps} />
    <Notes label="Schedule instructions (optional)" name="notes" defaultValue={source === request.proposal ? '' : source.notes} />
    {(request.confirmed_schedule || admin) && <Notes label="Reason for the change" name="reason" required />}
    <label className={styles.check}><input type="checkbox" name="acknowledge_overlap" defaultChecked={source.overlap_acknowledged} />
      I’ve checked availability and can proceed if the schedule overlaps another deployment.
    </label>
    <div className={styles.actions}>
      <button className={styles.primary} disabled={busy || selection?.length === 0}>{busy ? 'Saving…' : request.school_clearance ? 'Send amendment for clearance' : 'Confirm schedule'}</button>
      <button className={styles.secondary} type="button" onClick={onCancel}>Close form</button>
    </div>
  </form>;
}

function ScheduleSummary({ title, schedule, request, detailed = false, showWorksite = true }) {
  if (!schedule) return null;
  return <section className={styles.panel}>
    <h3><CalendarDays size={18} aria-hidden="true" /> {title}</h3>
    {detailed ? <dl className={styles.scheduleDetails}>
      <div><dt>Proposed start date</dt><dd>{formatDate(schedule.start)}</dd></div>
      {schedule.end && <div><dt>Proposed end date</dt><dd>{formatDate(schedule.end)}</dd></div>}
      <div><dt>Student capacity</dt><dd>{schedule.capacity} students</dd></div>
      {request?.period_name && <div><dt>School period</dt><dd>{request.period_name}</dd></div>}
      {request?.required_hours && <div><dt>Required immersion hours</dt><dd>{request.required_hours} hours</dd></div>}
      <div><dt>Requested strands</dt><dd>{schedule.strands?.join(', ') || 'All strands'}</dd></div>
      {schedule.notes && <div className={styles.scheduleDetailsWide}><dt>Special instructions</dt><dd>{schedule.notes}</dd></div>}
    </dl> : <>
      <p>{formatDate(schedule.start)}{schedule.end ? ` – ${formatDate(schedule.end)}` : ''} · {schedule.capacity} students</p>
      <p>{schedule.strands?.join(', ') || 'All strands'}</p>
      {showWorksite && schedule.worksite && <p>{schedule.worksite}</p>}
    </>}
    {!!Object.keys(schedule.caps || {}).length && <p>{schedule.strands.map((strand) => {
      const cap = schedule.caps[strand.trim().toLowerCase()];
      return cap ? `${strand}: ${cap}` : '';
    }).filter(Boolean).join(' · ')}</p>}
    {!detailed && schedule.notes && <p>{schedule.notes}</p>}
    {schedule.reason && <p>{schedule.reason}</p>}
    {schedule.overlap_acknowledged && <p className={styles.hint}>Schedule overlap acknowledged by the reviewer.</p>}
    {schedule.dates?.length > 0 && <details>
      <summary>{schedule.dates.length} workdays · {schedule.daily_hours} h per day · {schedule.dates.length * schedule.daily_hours} h scheduled</summary>
      <p>Time in {schedule.windows.time_in_open}–{schedule.windows.time_in_close} · Time out {schedule.windows.time_out_open}–{schedule.windows.time_out_close}</p>
      <ul className={styles.dateList}>{schedule.dates.map((date) => <li key={date}>{formatDate(date)}</li>)}</ul>
    </details>}
  </section>;
}

function SchoolClearance({ request, save, busy, close }) {
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save('clearance', { reference: data.get('reference'),
      checks: Object.fromEntries(Object.keys(clearanceChecks).map((key) => [key, data.has(key)])) });
  }}>
    <h3>{request.schedule_amendment ? 'Approve schedule amendment' : 'Record school clearance'}</h3>
    <Field label="School authorization reference" name="reference" required maxLength={255} />
    {Object.entries(clearanceChecks).map(([key, label]) => <label key={key} className={styles.check}>
      <input type="checkbox" name={key} required />{label}
    </label>)}
    <div className={styles.actions}>
      <button className={styles.primary} disabled={busy}>{busy ? 'Saving…' : 'Record clearance'}</button>
      <button className={styles.secondary} type="button" onClick={close}>Close form</button>
    </div>
  </form>;
}

function ReasonForm({ title, busy, onSave, close }) {
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    onSave(new FormData(event.currentTarget).get('reason'));
  }}>
    <Notes label="Reason" name="reason" required />
    <div className={styles.actions}><button className={styles.primary} disabled={busy}>{busy ? 'Saving…' : title}</button>
      <button className={styles.secondary} type="button" onClick={close}>Close form</button></div>
  </form>;
}

function Roster({ detail, busy, save, refresh, school }) {
  const { request, roster } = detail;
  const [search, setSearch] = useState('');
  const [find, setFind] = useState(false);
  const [remove, setRemove] = useState('');
  const [add, setAdd] = useState('');
  const current = roster.filter((student) => !student.deployment_ended_on);
  const open = school && request.status === 'approved' && request.school_clearance && request.schedule_status !== 'completed';
  const result = useDeploymentData('coordinator', open && find ? `/${request.id}/candidates?${query({ search })}` : null, refresh);
  return <section className={styles.panel}>
    <h3>Student allocation</h3>
    <p className={styles.badges}><Badge value={detail.allocation_status} />
      {request.confirmed_schedule && <span>{detail.active} assigned · {detail.remaining} remaining</span>}</p>
    {request.confirmed_schedule && !request.school_clearance && <p className={styles.hint}>Allocation opens after school clearance.</p>}
    {roster.length > 0 && <ul className={styles.roster}>{roster.map((student) => <li key={student.id}>
      <span><strong>{person(student)}</strong> · {student.track_strand || 'Unspecified strand'}</span>
      {student.deployment_ended_on && <small>Withdrawn · {formatDate(student.deployment_ended_on)}</small>}
    </li>)}</ul>}
    {open && !find && <button className={styles.secondary} type="button" onClick={() => setFind(true)}>Manage roster</button>}
    {open && find && <form className={styles.form} onSubmit={async (event) => {
      event.preventDefault();
      const worked = await save('roster', { add, remove, reason: new FormData(event.currentTarget).get('reason') });
      if (worked) { setRemove(''); setAdd(''); setFind(false); }
    }}>
      <Select label="Withdraw or replace an assigned student" value={remove} onChange={(event) => setRemove(event.target.value)}>
        <option value="">Keep all assigned students</option>
        {current.map((student) => <option key={student.id} value={student.id}>{person(student)}</option>)}
      </Select>
      {(detail.remaining > 0 || remove) && <>
        <Field label="Find an eligible student by name, strand, or section" type="search" value={search} onChange={(event) => {
          setSearch(event.target.value); setAdd('');
        }} />
        <LoadState result={result}>{({ students }) => <Select label="Add eligible student" value={add} onChange={(event) => setAdd(event.target.value)}>
          <option value="">{students.length ? 'Select a student' : 'No matching eligible students'}</option>
          {students.map((student) => <option key={student.id} value={student.id}>{person(student)} · {student.track_strand}</option>)}
        </Select>}</LoadState>
      </>}
      {remove && <Notes label="Reason for withdrawal or replacement" name="reason" required />}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy || (!add && !remove)}>{busy ? 'Saving…' : add && remove ? 'Replace student' : remove ? 'Withdraw student' : 'Allocate student'}</button>
        <button className={styles.secondary} type="button" onClick={() => { setFind(false); setAdd(''); setRemove(''); }}>Close form</button>
      </div>
    </form>}
  </section>;
}

function ApprovalConfirmationDialog({ request, busy, onApprove, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  return <dialog
    className={styles.approvalDialog}
    ref={dialogRef}
    aria-labelledby="approve-coordinator-request-title"
    aria-describedby="approve-coordinator-request-description"
    onCancel={(event) => {
      event.preventDefault();
      if (!busy) onCancel();
    }}
  >
    <h2 id="approve-coordinator-request-title">Approve coordinator request?</h2>
    <p id="approve-coordinator-request-description">
      Are you sure you want to approve this deployment request from {request.coordinator_name || 'the coordinator'}?
    </p>
    <div className={styles.actions}>
      <button className={styles.primary} type="button" disabled={busy} onClick={onApprove}>
        {busy ? 'Approving…' : 'Yes, approve request'}
      </button>
      <button className={styles.secondary} type="button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </dialog>;
}

function RequestDetail({ role, detail, refresh, mutate, busy, goBack }) {
  const { request, history, strands } = detail;
  const [form, setForm] = useState('');
  const [connectionSuccess, setConnectionSuccess] = useState(false);
  const school = role !== 'supervisor';
  const admin = role === 'admin';
  const reviewing = (!school || admin) && request.status === 'pending';
  const scheduling = (!school || admin) && request.status === 'approved' && request.schedule_status !== 'completed';
  const awaitingClearance = school && request.status === 'approved' &&
    request.confirmed_schedule && (!request.school_clearance || request.schedule_amendment);
  const cancellable = school && !['rejected', 'cancelled'].includes(request.status) &&
    (!request.teacher_batch_id || request.schedule_status === 'upcoming');
  const save = async (action, data) => {
    const success = await mutate(`/${request.id}/${action}`, { ...data, revision: request.revision });
    if (success) {
      setForm('');
      if (role === 'supervisor' && action === 'review' && data.status === 'approved') {
        setConnectionSuccess(true);
      }
    }
    return success;
  };
  const close = () => setForm('');
  const partner = { id: request.partner_institution_id, name: request.partner_name, address: request.partner_address };
  return <>
    <button className={styles.back} type="button" onClick={goBack}><ArrowLeft size={17} /> Back to {school ? 'deployments' : 'requests'}</button>
    <section className={styles.panel}>
      <div className={styles.headingRow}>
        <div>
          {role === 'supervisor' && <span className={styles.headingLabel}>Coordinator</span>}
          <h2>{role === 'supervisor' ? request.coordinator_name || 'School coordinator' : request.partner_name}</h2>
          <p>
            {request.reference} · {request.period_name} · {request.required_hours} h required
            {role === 'supervisor' && <> · <span className={styles.partnerLabel}>Partner institution:</span> {request.partner_name}</>}
          </p>
        </div>
        <div className={styles.badges}><Badge value={request.status} /><Badge value={request.schedule_status} /></div>
      </div>
      <dl className={styles.stats}>
        <div><dt>Teacher</dt><dd>{request.teacher_name}</dd></div>
        <div><dt>Supervisor</dt><dd>{request.supervisor_name}</dd></div>
        {role !== 'supervisor' && <div><dt>Coordinator</dt><dd>{request.coordinator_name || 'School coordinator'}</dd></div>}
        <div><dt>Submitted</dt><dd>{formatDate(request.created_at)}</dd></div>
      </dl>
      {request.confirmed_schedule && !request.school_clearance && request.status !== 'cancelled' && <p className={styles.notice}>Awaiting school clearance</p>}
      {request.school_clearance && request.status !== 'cancelled' && <p className={styles.hint}>School clearance recorded · {request.school_clearance.reference}</p>}
      <div className={styles.actions}>
        {reviewing && <>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => admin ? setForm('approve') : setForm('confirm-approve')}>Approve request</button>
          <button className={styles.secondary} type="button" onClick={() => setForm('changes')}>Request changes</button>
          <button className={styles.secondary} type="button" onClick={() => setForm('reject')}>Reject</button>
        </>}
        {scheduling && <button className={styles.primary} type="button" onClick={() => setForm('schedule')}>
          {request.school_clearance ? 'Propose schedule amendment' : request.confirmed_schedule ? 'Revise confirmed schedule' : 'Schedule immersion'}
        </button>}
        {school && request.status === 'changes_requested' && <button className={styles.primary} type="button" onClick={() => setForm('resubmit')}>Edit and resubmit</button>}
        {awaitingClearance && <>
          <button className={styles.primary} type="button" onClick={() => setForm('clearance')}>{request.schedule_amendment ? 'Clear amendment' : 'Record school clearance'}</button>
          <button className={styles.secondary} type="button" onClick={() => setForm('return')}>Return schedule for changes</button>
        </>}
        {cancellable && <button className={styles.secondary} type="button" onClick={() => setForm('cancel')}>Cancel deployment</button>}
      </div>
      {form === 'confirm-approve' && <ApprovalConfirmationDialog
        request={request}
        busy={busy}
        onApprove={() => save('review', { status: 'approved' })}
        onCancel={close}
      />}
      {connectionSuccess && <div className={styles.connectionSuccess} role="status" aria-live="polite">
        <span className={styles.handshakeIcon}><Handshake size={34} strokeWidth={1.8} aria-hidden="true" /></span>
        <h3>Request approved!</h3>
        <p>{request.supervisor_name || 'The supervisor'} and {request.coordinator_name || 'the coordinator'} are now connected for this deployment.</p>
        <button className={styles.secondary} type="button" onClick={() => setConnectionSuccess(false)}>Continue</button>
      </div>}
      {form === 'resubmit' && <ProposalForm partner={partner} initial={request} revision={refresh} onSave={(data) => save('resubmit', data)} onCancel={close} busy={busy} />}
      {form === 'schedule' && <ScheduleForm request={request} strands={strands} busy={busy} onSave={(data) => save('schedule', data)} onCancel={close} admin={admin} />}
      {form === 'clearance' && <SchoolClearance request={request} save={save} busy={busy} close={close} />}
      {form === 'approve' && <ReasonForm title="Approve with admin override" onSave={(reason) => save('review', { status: 'approved', reason })} busy={busy} close={close} />}
      {form === 'changes' && <ReasonForm title="Send change request" onSave={(reason) => save('review', { status: 'changes_requested', reason })} busy={busy} close={close} />}
      {form === 'reject' && <ReasonForm title="Reject request" onSave={(reason) => save('review', { status: 'rejected', reason })} busy={busy} close={close} />}
      {form === 'return' && <ReasonForm title="Return schedule" onSave={(reason) => save('return-schedule', { reason })} busy={busy} close={close} />}
      {form === 'cancel' && <ReasonForm title="Confirm cancellation" onSave={(reason) => save('cancel', { reason })} busy={busy} close={close} />}
    </section>
    <div className={styles.compare}>
      <ScheduleSummary title="Coordinator proposal" schedule={request.proposal} request={request}
        detailed={role === 'supervisor'} showWorksite={role !== 'supervisor'} />
      <ScheduleSummary title="Partner-confirmed schedule" schedule={request.confirmed_schedule} showWorksite={role !== 'supervisor'} />
    </div>
    <ScheduleSummary title="Proposed schedule amendment" schedule={request.schedule_amendment} showWorksite={role !== 'supervisor'} />
    {(school || request.school_clearance) && <Roster detail={detail} busy={busy} save={save} refresh={refresh} school={school} />}
    <section className={styles.panel}>
      <h3>Activity history</h3>
      <ul className={styles.roster}>{history.map((entry) => <li key={entry.id}>
        <span><strong className={styles.actionName}>{entry.action.replaceAll('_', ' ')}</strong>{entry.reason && ` · ${entry.reason}`}</span>
        <small>{entry.actor_name || entry.actor_role || 'School system'} · {formatDate(entry.created_at)}</small>
      </li>)}</ul>
    </section>
  </>;
}

function PartnerDetail({ id, refresh, busy, onCreate, openRequest, back }) {
  const list = useDeploymentData('coordinator', `?partner=${id}`, refresh);
  const partnerData = useDeploymentData('coordinator', `/partners/${id}`, refresh);
  return <>
    <button className={styles.back} type="button" onClick={back}><ArrowLeft size={17} /> All partners</button>
    <LoadState result={partnerData}>{({ partner }) => <section className={styles.panel}>
      <h2>{partner.name}</h2>
      <p>{[partner.industry, partner.address, partner.is_active ? 'Active partner' : 'Inactive partner'].filter(Boolean).join(' · ')}</p>
      {partner.description && <p>{partner.description}</p>}
      {partner.is_active && onCreate && <div className={styles.actions}>
        {partner.has_unresolved_request ? <PendingRequestNotice /> :
          <CreateDeploymentButton partner={partner} revision={refresh} busy={busy} onCreate={onCreate} />}
      </div>}
    </section>}</LoadState>
    <section className={styles.panel}>
      <h3>Deployment history</h3>
      <LoadState result={list}>{({ requests }) => <RequestList requests={requests} onOpen={openRequest} empty="This partner has no deployment requests yet." />}</LoadState>
    </section>
  </>;
}

export default function PartnerDeployments({ role = 'coordinator' }) {
  const [params, setParams] = useSearchParams();
  const [section, setSection] = useState('partners');
  const [filters, setFilters] = useState({});
  const [status, setStatus] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [action, setAction] = useState({ busy: false, error: '', message: '' });
  const requestId = params.get('request');
  const partnerId = params.get('partner');
  const school = role !== 'supervisor';
  const browse = school && section === 'partners' && !partnerId && !requestId;
  const monitor = !requestId && !partnerId && !browse;
  const options = useDeploymentData(role, browse ? '/options' : null, refresh);
  const partners = useDeploymentData(role, browse ? `/partners?${query(filters)}` : null, refresh);
  const list = useDeploymentData(role, monitor ? `?${query({ status })}` : null, refresh);
  const detail = useDeploymentData(role, requestId ? `/${encodeURIComponent(requestId)}` : null, refresh);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh((value) => value + 1);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const changeFilter = (key, value) => setFilters((previous) => ({ ...previous, page: 1, [key]: value }));
  const openRequest = (id) => {
    setAction({ busy: false, error: '', message: '' });
    setParams(partnerId ? { partner: partnerId, request: id } : { request: id });
  };
  const back = () => {
    setAction({ busy: false, error: '', message: '' });
    setParams(requestId && partnerId ? { partner: partnerId } : {});
  };
  const mutate = async (path, body, method, showError) => {
    setAction({ busy: true, error: '', message: '' });
    try {
      const data = await partnerDeploymentApi(role, path, body, method);
      setRefresh((value) => value + 1);
      setAction({ busy: false, error: '', message: 'Changes saved.' });
      return data;
    } catch (error) {
      setAction({ busy: false, error: showError ? '' : error.message, message: '' });
      showError?.(error.message);
      return null;
    }
  };
  const createRequest = role === 'coordinator' ? async (data, showError) => {
    const result = await mutate('', data, 'POST', showError);
    if (result) openRequest(result.id);
  } : undefined;

  return <main className={role === 'coordinator' ? `${styles.page} ${styles.coordinatorPage}` : styles.page}>
    <header className={styles.header}>
      <div>
        {role === 'coordinator' && <p className={styles.headerEyebrow}>Work Immersion placements</p>}
        <h1>{school ? 'Deployment' : 'Deployment Requests'}</h1>
        <p>{school ? 'Coordinate work immersion with partner institutions and manage student placements.' :
          'Review partner placement requests and confirm work immersion schedules.'}</p>
      </div>
    </header>
    {action.error && <div className={styles.notice} role="alert">{action.error}{' '}
      <button className={styles.secondary} type="button" onClick={() => {
        setRefresh((value) => value + 1);
        setAction({ busy: false, error: '', message: '' });
      }}>Refresh</button></div>}
    {action.message && <p role="status" className={styles.notice}>{action.message}</p>}
    {school && !requestId && !partnerId && <nav className={styles.tabs} aria-label="Deployment sections">
      <button type="button" aria-pressed={browse} onClick={() => setSection('partners')}>Partner institutions</button>
      <button type="button" aria-pressed={monitor} onClick={() => setSection('monitor')}>Request monitoring</button>
    </nav>}
    {browse && <Partners result={partners} filters={filters} setFilter={changeFilter}
      supervisors={options.data?.supervisors || []} onOpen={(id) => setParams({ partner: id })}
      onCreate={createRequest} revision={refresh} busy={action.busy} />}
    {monitor && <div className={styles.requestArea}>
      <div className={`${styles.filterPanel} ${styles.filters}`}>
        <Select label="Request status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All request statuses</option>{reviewStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
        </Select>
        <Select label="Schedule status" value={scheduleStatus} onChange={(event) => setScheduleStatus(event.target.value)}>
          <option value="">All schedule statuses</option>{['not_scheduled', 'upcoming', 'ongoing', 'completed', 'cancelled'].map((value) =>
            <option key={value} value={value}>{statusLabels[value]}</option>)}
        </Select>
        <button className={styles.secondary} type="button" onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh requests
        </button>
      </div>
      <LoadState result={list}>{({ requests }) => {
        const visible = requests.filter((item) => !scheduleStatus || item.schedule_status === scheduleStatus);
        return school ? <div className={styles.panel}><RequestList requests={visible} onOpen={openRequest} empty="No deployment requests match these filters." /></div> :
          <SupervisorInbox requests={visible} onOpen={openRequest} />;
      }}</LoadState>
    </div>}
    {partnerId && !requestId && school && <PartnerDetail key={partnerId} id={partnerId} refresh={refresh} busy={action.busy}
      onCreate={createRequest} openRequest={openRequest} back={back} />}
    {requestId && <LoadState result={detail}>{(data) => <RequestDetail key={requestId} role={role} detail={data}
      refresh={refresh} mutate={mutate} busy={action.busy} goBack={back} />}</LoadState>}
  </main>;
}
