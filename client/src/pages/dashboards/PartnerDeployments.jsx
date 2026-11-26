import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, CalendarDays, ChevronRight, Handshake, History, RefreshCw, Settings, X } from 'lucide-react';
import { partnerDeploymentApi } from '../../api/partnerDeploymentApi';
import { AcceptedStudentsDialog, AssignStudentsStartDialog, StudentApprovalPanel } from './StudentDeploymentApprovals';
import styles from './PartnerDeployments.module.css';

const statusLabels = {
  draft: 'Draft', pending: 'Pending supervisor review', approved: 'Approved', changes_requested: 'Changes requested',
  pending_coordinator_agreement: 'Pending coordinator agreement',
  rejected: 'Rejected', cancelled: 'Cancelled', not_scheduled: 'Not scheduled',
  upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed',
  not_started: 'Not started', partially_filled: 'Partially filled', fully_filled: 'Fully filled',
};
const reviewStatuses = ['draft', 'pending', 'changes_requested', 'pending_coordinator_agreement', 'approved', 'ongoing', 'completed', 'rejected', 'cancelled'];
const approvedRequestStatuses = ['approved', 'ongoing', 'completed'];
const supervisorInstitutionsPath = '/dashboard/supervisor/partner-institutions';
const partnerRequestLabels = {
  pending: 'Request pending',
  draft: 'Draft request',
  pending_coordinator_agreement: 'Awaiting coordinator agreement',
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
const deploymentStages = [
  ['no_request', 'No request'],
  ['requesting', 'Requesting'],
  ['approved', 'Request approval'],
  ['students_submitted', 'Student Deployment'],
  ['completed', 'Completed Requirements / Ready for Deployment'],
];
const studentDeploymentStages = [
  ['students_submitted', 'Pending Student Approval'],
  ['students_rejected', 'Students Not Accepted'],
];
const requestingStages = [
  ['in_progress', 'Request in progress'],
  ['changes_requested', 'Changes requested by supervisor'],
];
const openRequestStatuses = ['draft', 'pending', 'changes_requested', 'pending_coordinator_agreement'];
const defaultWindows = {
  time_in_open: '08:00', time_in_close: '08:30', time_out_open: '17:00', time_out_close: '17:30',
};

function query(values) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString();
}

function newCreationKey() {
  return globalThis.crypto?.randomUUID?.() ||
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte, index) =>
      `${[4, 6, 8, 10].includes(index) ? '-' : ''}${byte.toString(16).padStart(2, '0')}`).join('');
}

function formatDate(value) {
  if (!value) return '—';
  const date = value.length === 10 ? `${value}T00:00:00+08:00` : value;
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(date));
}

function formatTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
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

function useDeploymentRefresh() {
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') setRefresh((value) => value + 1);
    };
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
    };
  }, []);
  return [refresh, setRefresh];
}

function useDeploymentAction(role, setRefresh, initialMessage = '') {
  const [action, setAction] = useState({ busy: false, error: '', message: initialMessage });
  const clearAction = () => setAction({ busy: false, error: '', message: '' });
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
  return { action, setAction, clearAction, mutate };
}

function DeploymentActionFeedback({ action, onRefresh }) {
  return <>
    {action.error && <div className={styles.notice} role="alert">{action.error}{' '}
      <button className={styles.secondary} type="button" onClick={onRefresh}>Refresh</button></div>}
    {action.message && <p role="status" className={styles.notice}>{action.message}</p>}
  </>;
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

function StandardSchedule({ schedule }) {
  const standard = {
    required_hours: schedule?.required_hours || 80,
    daily_hours: schedule?.daily_hours || 8,
    windows: { ...defaultWindows, ...schedule?.windows },
  };
  return <>
    <dl>
      <div><dt>Total required</dt><dd>{standard.required_hours} hours</dd></div>
      <div><dt>Creditable per workday</dt><dd>{standard.daily_hours} hours</dd></div>
      <div><dt>Time in</dt><dd>{formatTime(standard.windows.time_in_open)}–{formatTime(standard.windows.time_in_close)}</dd></div>
      <div><dt>Time out</dt><dd>{formatTime(standard.windows.time_out_open)}–{formatTime(standard.windows.time_out_close)}</dd></div>
    </dl>
    <p>These are the standard attendance hours for every partner institution.</p>
  </>;
}

function StandardScheduleNotice({ schedule }) {
  return <details className={styles.standardSchedule}>
    <summary>View standard work immersion hours</summary>
    <StandardSchedule schedule={schedule} />
  </details>;
}

function DeploymentSettings({ role, schedule, refresh, requestId, detail }) {
  const dialogRef = useRef(null);
  const [section, setSection] = useState(null);
  const showHours = section === 'hours';
  const showHistory = section === 'history';
  const result = useDeploymentData(role, showHours && !schedule ? '/options' : null, refresh);
  const toggleSection = (name) => setSection((current) => current === name ? null : name);

  return <>
    <button className={styles.dialogClose} type="button" aria-label="Deployment settings" title="Deployment settings"
      aria-haspopup="dialog" onClick={() => dialogRef.current.showModal()}>
      <Settings size={20} aria-hidden="true" />
    </button>
    <dialog className={`${styles.proposalDialog} ${styles.settingsDialog}`} ref={dialogRef}
      aria-labelledby="deployment-settings-title" onClose={() => setSection(null)}>
      <header className={styles.proposalDialogHeader}>
        <h2 id="deployment-settings-title">Deployment settings</h2>
        <button className={styles.dialogClose} type="button" aria-label="Close deployment settings"
          onClick={() => dialogRef.current.close()}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.proposalDialogBody}>
        <div className={styles.actions}>
          {role !== 'supervisor' && <button className={styles.secondary} type="button" aria-expanded={showHours}
            aria-controls="deployment-standard-hours" onClick={() => toggleSection('hours')}>
            View standard work immersion hours
          </button>}
          {(requestId || role === 'supervisor') && <button className={styles.secondary} type="button" aria-expanded={showHistory}
            aria-controls="deployment-activity-history" onClick={() => toggleSection('history')}>
            <History size={16} aria-hidden="true" /> Activity history
          </button>}
        </div>
        <div id="deployment-activity-history" hidden={!showHistory} className={styles.historyPanel}>
          {showHistory && (requestId ? <LoadState result={detail}>{({ request, history }) => <>
            <h3>{request.reference}</h3>
            {history.length ? <HistoryEntries history={history} /> : <p>No activity yet.</p>}
        </>}</LoadState> : <p>Open a request to view its activity.</p>)}
        </div>
        <div id="deployment-standard-hours" hidden={!showHours} className={styles.standardSchedule}>
          {showHours && (schedule ? <StandardSchedule schedule={schedule} /> :
            <LoadState result={result}>{(data) => <StandardSchedule schedule={data.standard_schedule} />}</LoadState>)}
        </div>
      </div>
    </dialog>
  </>;
}

function revealRequest(button) {
  button?.scrollIntoView({ block: 'nearest' });
}

function RequestList({ requests, onOpen, empty }) {
  if (!requests.length) return <p className={styles.hint}>{empty}</p>;
  return <ul className={styles.rows}>
    {requests.map((request) => <li key={request.id}>
        <button className={styles.requestRow} type="button" onClick={() => onOpen(request.id)}>
          <span>
            <strong>{request.partner_name}</strong>
            <small>{request.reference} · {formatDate(request.proposal.start)}</small>
          </span>
          <span className={styles.badges}><Badge value={request.status} /><Badge value={request.schedule_status} /></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </li>)}
  </ul>;
}

function proposalFields(proposal) {
  const teachers = (proposal.teacher_ids ?? [proposal.teacher_id]).filter(Boolean);
  return [
    { key: 'start', label: 'Proposed start date', value: proposal.start, text: formatDate(proposal.start) },
    { key: 'capacity', label: 'Maximum students', value: proposal.capacity, text: proposal.capacity ?? 'Not set' },
    { key: 'teacher_ids', label: 'Assigned immersion teachers', value: [...teachers].sort().join(','),
      text: proposal.teacher_name || teachers.map((id) => `Teacher #${id}`).join(', ') || 'Unassigned' },
    { key: 'strands', label: 'Accepted strands', value: [...(proposal.strands || [])].sort().join(','),
      text: proposal.strands?.join(', ') || 'All strands' },
    { key: 'notes', label: 'Special requirements or instructions', value: proposal.notes || '', text: proposal.notes || 'None' },
  ];
}

function RequestChangesSummary({ proposal, changes }) {
  if (!changes) return <p className={styles.hint}>Review the existing proposal before resubmitting it.</p>;
  const previous = proposalFields(proposal);
  const requested = proposalFields(changes).filter((field, index) =>
    field.key !== 'notes' && Object.hasOwn(changes, field.key) && field.value !== previous[index].value);
  return <div className={styles.proposalChanges}>
    <strong>Supervisor’s requested changes</strong>
    {requested.length > 0 && <dl>{requested.map(({ key, label, text }) => <div key={key}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>}
    {changes.reason && <p>{changes.reason}</p>}
  </div>;
}

function PendingRequestNotice({ card = false, onCancel }) {
  return <div className={`${styles.requestPendingNotice} ${card ? styles.cardPendingNotice : ''}`}>
    <p role="status">Finish the open deployment request before creating another for this partner.</p>
    <button className={`${styles.secondary} ${card ? styles.cardAction : ''}`} type="button"
      disabled={!onCancel} aria-haspopup={onCancel ? 'dialog' : undefined} onClick={onCancel}>
      {onCancel ? 'Cancel request' : 'Request in progress'}
    </button>
  </div>;
}

function PartnerCard({ partner, stage, onOpen, onCreate, onCancelRequest, onEditRequest, onAssignStudents, onViewStudents,
  deploymentSelection, revision, busy }) {
  const headingId = useId();
  const openRequestId = partner.open_request_id ??
    (openRequestStatuses.includes(partner.status) ? partner.latest_request_id : null);
  const canCancel = onCancelRequest && openRequestId;
  const canEdit = onEditRequest && openRequestId;
  const canStartRequest = onCreate && partner.is_active && !partner.active_request_id;
  const location = partner.address?.trim() || 'Location not set';
  const partnerInfo = [partner.industry?.trim(), location].filter(Boolean).join(' · ');
  const cancelledRequest = stage === 'no_request' && partner.status === 'cancelled';
  const pendingReview = stage === 'students_submitted';
  const readyForDeployment = stage === 'completed';
  const requestState = pendingReview ? 'pending' :
    partner.request_count === 0 || cancelledRequest ? 'no_requests' : partner.status;
  const requestLabel = readyForDeployment ? (partner.schedule_published ? 'Ready to Rebatch' : 'Ready for Deployment') :
    pendingReview ? 'Students pending' :
    cancelledRequest ? 'No open request' : requestState === 'no_requests' ? 'No requests' : partnerRequestLabels[requestState];
  const scheduleLabel = cancelledRequest ? null : partnerScheduleLabels[partner.schedule_status];
  const schedule = partner.confirmed_schedule;
  const capacity = schedule?.capacity;
  const assigned = partner.assigned_students ?? 0;
  const remaining = capacity - assigned - (partner.pending_students ?? 0);
  const details = [
    ['Assigned Teacher', partner.teacher_name?.trim() || 'Unassigned'],
    ['Assigned Supervisor', partner.supervisor_name?.trim() || 'Unassigned'],
    ['Deployment Requests', partner.request_count ?? 'Not set'],
    ['Student Capacity', capacity ?? partner.num_students ?? 'Not set'],
    ...((stage === 'approved' || pendingReview || readyForDeployment) && schedule ? [
      [readyForDeployment ? 'Students Accepted' : 'Students Assigned', assigned],
      ['Deployment Schedule', `${formatDate(schedule.start)} – ${formatDate(schedule.end)}`],
    ] : []),
  ];

  return <article className={`${styles.partnerCard}${onViewStudents ? ` ${styles.interactivePartnerCard}` : ''}`} aria-labelledby={headingId}>
    <header className={styles.partnerCardHeader}>
      <span className={styles.partnerIcon}><Building2 size={21} aria-hidden="true" /></span>
      <h2 id={headingId} className={styles.partnerName}>
        {stage && !onViewStudents ? <Link className={styles.partnerTitleLink}
          to={`/dashboard/coordinator/partner-institutions?${query({ institution: partner.id })}`}>
          {partner.name}
        </Link> : partner.name}
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
      {canEdit && <>
        <RequestChangesSummary proposal={{ ...partner.proposal, teacher_name: partner.teacher_name }} changes={partner.requested_changes} />
        <button className={`${styles.primary} ${styles.cardAction}`} type="button" disabled={busy}
          aria-haspopup="dialog" onClick={() => onEditRequest(openRequestId)}>Edit Proposal</button>
      </>}
      {onAssignStudents && partner.active_request_id && remaining > 0 &&
        <button type="button" className={`${styles.primary} ${styles.cardAction}`} disabled={busy}
          aria-haspopup="dialog" onClick={() => onAssignStudents(partner)}>Assign Students</button>}
      {canCancel && <PendingRequestNotice card onCancel={() => onCancelRequest(openRequestId)} />}
      {!canCancel && canStartRequest && (partner.has_unresolved_request ? <PendingRequestNotice card /> :
        <CreateDeploymentButton partner={partner} revision={revision} busy={busy} onCreate={onCreate} card />)}
      {onOpen && <button className={`${styles.secondary} ${styles.cardAction}`} type="button"
        onClick={() => onOpen(partner.id)} aria-label={`View partner: ${partner.name}`}>
        View Partner <ChevronRight size={16} aria-hidden="true" />
      </button>}
      {deploymentSelection && <label className={styles.deploymentSelection}>
        <input type="checkbox" checked={deploymentSelection.checked} onChange={deploymentSelection.onChange}
          aria-label={`Select ${partner.name} for deployment`} />
        <span>Select for deployment</span>
      </label>}
    </div>
    {onViewStudents && <button type="button" className={styles.partnerCardTrigger} aria-haspopup="dialog"
      aria-label={pendingReview ? `View students pending approval for ${partner.name}` : `View accepted students for ${partner.name}`}
      onClick={onViewStudents} />}
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

function Partners({ result, filters, setFilter, stage, supervisors, onOpen, onCreate, onCancelRequest, onEditRequest, onAssignStudents, revision, busy }) {
  const hasFilters = filters.search?.trim() || filters.teacher || filters.supervisor || filters.status;
  const activity = filters.active === 'all' ? '' : filters.active === 'inactive' ? ' inactive' : ' active';
  return <>
    {!stage && <div className={`${styles.filterPanel} ${styles.filters} ${styles.partnerFilters}`}>
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
    </div>}
    {result.loading ? <PartnerLoading /> : <LoadState result={result}>{({ partners, page, pages }) => <>
      {partners.length ? <div className={styles.cards}>
        {partners.map((partner) => <PartnerCard key={partner.id} partner={partner} stage={stage} onOpen={onOpen}
          onCreate={onCreate} onCancelRequest={onCancelRequest} onEditRequest={onEditRequest}
          onAssignStudents={onAssignStudents} revision={revision} busy={busy} />)}
      </div> : <section className={styles.partnerEmpty}>
        <span className={styles.partnerIcon}><Building2 size={21} aria-hidden="true" /></span>
        <h2>{stage ? 'No partners in this stage' : hasFilters ? 'No matching partner establishments' : `No${activity} partner establishments`}</h2>
        {!stage && (hasFilters || activity) && <p>{hasFilters ? 'Try a different search or change the filters.' :
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

function BatchCreationDialog({ partners, onClose, onCreated }) {
  const [creationKey] = useState(newCreationKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasPublishedSchedules = partners.some(({ schedule_published }) => schedule_published);
  const hasNewSchedules = partners.some(({ schedule_published }) => !schedule_published);

  async function createBatch() {
    setBusy(true);
    setError('');
    try {
      const { batch } = await partnerDeploymentApi('coordinator', '/batches', {
        request_ids: partners.map(({ deployment_request_id }) => deployment_request_id),
        creation_key: creationKey,
      }, 'POST');
      onCreated(batch.id);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return <DeploymentDialog title="Create Deployment Batch" busy={busy} onClose={onClose} cancelLabel="Cancel"
    confirmButton={<button type="button" className={styles.primary} onClick={createBatch} disabled={busy}>
      {busy ? 'Creating batch…' : 'Confirm and Deploy'}
    </button>}>
    {hasNewSchedules && <p>Confirm to publish the new schedules and unlock Immersion Proper for the accepted students.</p>}
    {hasPublishedSchedules && <p>Published deployments will move into the new batch with their current schedules and student placements.</p>}
    <ul className={styles.roster} aria-label="Partner institutions in this batch">
      {partners.map((partner) => <li key={partner.deployment_request_id}>
        <span><strong>{partner.name}</strong><small>{partner.teacher_name} · {partner.supervisor_name}</small></span>
        <span>{partner.assigned_students} accepted
          <small>{formatDate(partner.confirmed_schedule.start)} – {formatDate(partner.confirmed_schedule.end)}</small>
          {partner.schedule_published && <small>Schedule already published</small>}
        </span>
      </li>)}
    </ul>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </DeploymentDialog>;
}

function ReadyDeploymentPartners({ result, studentApprovals }) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [rosterPartner, setRosterPartner] = useState(null);
  const [reviewPartners, setReviewPartners] = useState(null);
  const partners = result.data?.partners || [];
  const selected = partners.filter(({ deployment_request_id }) => selectedIds.has(deployment_request_id));
  const allSelected = partners.length > 0 && selected.length === partners.length;

  function selectPartner(requestId, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(requestId);
      else next.delete(requestId);
      return next;
    });
  }

  return <>
    <div className={styles.batchToolbar}>
      {partners.length > 0 && <label className={styles.deploymentSelection}>
        <input type="checkbox" checked={allSelected}
          ref={(input) => { if (input) input.indeterminate = selected.length > 0 && !allSelected; }}
          onChange={(event) => setSelectedIds(new Set(event.target.checked ? partners.map(({ deployment_request_id }) => deployment_request_id) : []))} />
        <span>Select all</span>
      </label>}
      <div className={styles.actions}>
        <Link className={styles.secondary} to="/dashboard/coordinator/batches">View Batches</Link>
        <button type="button" className={styles.primary} aria-haspopup="dialog" disabled={!selected.length}
          onClick={() => setReviewPartners(selected)}>Create Batch{selected.length > 0 && ` (${selected.length})`}</button>
      </div>
    </div>
    {result.loading ? <PartnerLoading /> : <LoadState result={result}>{() => partners.length ?
      <div className={styles.cards}>
        {partners.map((partner) => <PartnerCard key={partner.deployment_request_id} partner={partner} stage="completed"
          deploymentSelection={{ checked: selectedIds.has(partner.deployment_request_id),
            onChange: (event) => selectPartner(partner.deployment_request_id, event.target.checked) }}
          onViewStudents={() => setRosterPartner(partner)} />)}
      </div> : <section className={styles.partnerEmpty}>
        <span className={styles.partnerIcon}><Building2 size={21} aria-hidden="true" /></span>
        <h2>No partner institutions ready for deployment</h2>
      </section>}</LoadState>}
    {rosterPartner && <AcceptedStudentsDialog partner={rosterPartner} result={studentApprovals}
      onClose={() => setRosterPartner(null)} />}
    {reviewPartners && <BatchCreationDialog partners={reviewPartners} onClose={() => setReviewPartners(null)}
      onCreated={(id) => navigate(`/dashboard/coordinator/batches?batch=${id}`)} />}
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

function StudentSelection({ start, seats, strands, students, setStudents, refresh }) {
  const [search, setSearch] = useState('');
  const ready = Boolean(start);
  const result = useDeploymentData('coordinator', ready ? `/proposal-candidates?${query({ start, search, strands: strands?.join(',') })}` : null, refresh);
  const available = result.data?.students.filter(({ id }) => !students.some((student) => student.id === id)) || [];
  return <div className={styles.form}>
    <h3>Proposed students</h3>
    <p className={styles.hint}>{students.length} selected{seats ? ` of ${seats} places` : ''}.</p>
    {students.length > Number(seats) && <p className={styles.error} role="alert">Remove students to fit the proposed capacity.</p>}
    {students.length > 0 && <ul className={styles.roster}>{students.map((student) => <li key={student.id}>
      <span>{person(student)} · {student.track_strand || 'Unspecified strand'}</span>
      <button className={styles.secondary} type="button" onClick={() => setStudents(students.filter(({ id }) => id !== student.id))}
        aria-label={`Remove ${person(student)} from proposal`}>Remove</button>
    </li>)}</ul>}
    {!ready ? <p className={styles.hint}>Choose a proposed start date to find eligible students.</p> : <>
      <Field label="Search eligible students" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      <LoadState result={result}>{() => <Select label="Add eligible student" value="" disabled={students.length >= Number(seats)}
        onChange={(event) => {
          const student = available.find(({ id }) => String(id) === event.target.value);
          if (student) setStudents([...students, student]);
        }}>
        <option value="">{available.length ? 'Select a student' : 'No matching eligible students'}</option>
        {available.map((student) => <option key={student.id} value={student.id}>{person(student)} · {student.track_strand}</option>)}
      </Select>}</LoadState>
    </>}
  </div>;
}

function TeacherSelection({ teachers, setTeachers, options, busy }) {
  const availableTeachers = options.filter(({ id }) => !teachers.includes(id));
  const selectedTeachers = teachers.map((id) => ({
    id, name: options.find((teacher) => teacher.id === id)?.name || `Teacher #${id}`,
  }));
  return <>
    <Select label="Assigned immersion teacher(s)" value="" disabled={busy || !availableTeachers.length}
      onChange={(event) => {
        const id = Number(event.target.value);
        setTeachers((selected) => [...selected, id]);
      }}>
      <option value="" disabled>-- Select teachers --</option>
      {availableTeachers.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </Select>
    {selectedTeachers.length > 0 && <ul className={styles.roster} aria-label="Selected immersion teachers">
      {selectedTeachers.map(({ id, name }) => <li key={id}>
        <span>{name}</span>
        <button className={styles.secondary} type="button" disabled={busy} aria-label={`Remove ${name}`}
          onClick={() => setTeachers((selected) => selected.filter((teacherId) => teacherId !== id))}>Remove</button>
      </li>)}
    </ul>}
  </>;
}

function ProposalForm({ partner, initial, revision, onSave, onCancel, busy }) {
  const [teachers, setTeachers] = useState(initial?.teacher_ids?.filter(Boolean) || []);
  const [selection, setSelection] = useState(initial?.proposal.strands ?? null);
  const [creationKey] = useState(newCreationKey);
  const [addressRefresh, setAddressRefresh] = useState(0);
  const options = useDeploymentData('coordinator', `/options?${query({ partner: partner.id })}`, revision);
  const profile = useDeploymentData('coordinator', `/partners/${partner.id}`, addressRefresh);
  const supervisor = options.data?.authorised.find(({ id, primary }) => initial ? id === initial.supervisor_id : primary);
  const awaitingActivation = supervisor?.account_status === 'pending_activation';
  const supervisorReady = awaitingActivation || ['active', 'approved'].includes(supervisor?.account_status);
  const partnerAddress = profile.data ? profile.data.partner.address : partner.address;
  const worksite = initial?.proposal?.worksite?.trim() || partnerAddress?.trim() || '';
  useEffect(() => {
    if (worksite) return undefined;
    const refreshAddress = () => setAddressRefresh((value) => value + 1);
    window.addEventListener('focus', refreshAddress);
    return () => window.removeEventListener('focus', refreshAddress);
  }, [worksite]);
  const canSave = !busy && supervisorReady && teachers.length > 0 && selection?.length !== 0;
  const initialStart = initial?.proposal.start;
  const { today, earliest } = options.data || {};
  const minStart = initialStart >= today && initialStart < earliest ? initialStart : earliest;
  const collectProposal = (form) => {
    const fields = Object.fromEntries(new FormData(form));
    return {
      ...fields, partner_id: partner.id, strands: selection, teacher_ids: teachers,
      creation_key: creationKey,
    };
  };
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
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      if (canSave && worksite) onSave(collectProposal(event.currentTarget));
    }}>
      <div className={styles.formGrid}>
        <Field label="Worksite address" value={worksite} placeholder="No address on file" readOnly />
        <Field label="Proposed start date" name="start" type="date" min={minStart} defaultValue={initialStart || ''} required />
        <Field label="Maximum students" name="capacity" type="number" min="1" defaultValue={initial?.proposal.capacity ?? ''} required />
      </div>
      {!worksite && <p className={styles.hint}>
        A worksite address is required.{' '}
        <Link to={`/dashboard/coordinator/partner-institutions?${query({ institution: partner.id, edit: 'address' })}`}
          target="_blank" rel="noopener noreferrer">Add worksite address in a new tab</Link>
        {' '}and return here to submit your proposal.
      </p>}
      <TeacherSelection teachers={teachers} setTeachers={setTeachers} options={options.data?.teachers || []} busy={busy} />
      <StrandFields catalog={options.data?.strands || []} selection={selection} setSelection={setSelection} />
      <Notes label="Special requirements or instructions (optional)" name="notes" defaultValue={initial?.proposal.notes} />
      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={!canSave || !worksite}>
          {busy ? 'Saving…' : initial && initial.status !== 'draft' ? 'Resubmit Proposal' : 'Submit proposal'}
        </button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={onCancel}>Close form</button>
      </div>
    </form>
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
          const saved = await onCreate(data, setError);
          if (saved && dialogRef.current?.open) {
            dialogRef.current.close();
            onClose();
          }
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

function AmendmentForm({ request, strands, busy, onSave, onCancel }) {
  const source = request.confirmed_schedule;
  const [selection, setSelection] = useState(source.strands ?? null);
  const [caps, setCaps] = useState(source.caps || {});
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    onSave({ ...data, strands: selection, caps: Object.fromEntries(Object.entries(caps).filter(([key, value]) =>
      value && selection?.some((strand) => strand.trim().toLowerCase() === key))),
    excluded_dates: data.excluded_dates.split(/[\s,]+/).filter(Boolean) });
  }}>
    <div className={styles.formGrid}>
      <Field label="Proposed start date" name="start" type="date" defaultValue={source.start} required />
      <Field label="Proposed capacity" name="capacity" type="number" min="1" defaultValue={source.capacity} required />
    </div>
    <StandardScheduleNotice schedule={source} />
    <Field label="Additional excluded workdays (optional, YYYY-MM-DD separated by commas)" name="excluded_dates"
      defaultValue={source.excluded_dates?.join(', ')} />
    <StrandFields catalog={strands} selection={selection} setSelection={setSelection} caps={caps} setCaps={setCaps} />
    <Notes label="Schedule instructions (optional)" name="notes" defaultValue={source.notes} />
    <Notes label="Reason for the change" name="reason" required />
    <div className={styles.actions}>
      <button className={styles.primary} disabled={busy || selection?.length === 0}>{busy ? 'Saving…' : 'Submit proposed amendment'}</button>
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
      {schedule.end && <div><dt>Calculated completion date</dt><dd>{formatDate(schedule.end)}</dd></div>}
      <div><dt>Student capacity</dt><dd>{schedule.capacity ? `${schedule.capacity} students` : 'Not set'}</dd></div>
      <div><dt>Required immersion hours</dt><dd>{schedule.required_hours || 80} hours</dd></div>
      <div><dt>Requested strands</dt><dd>{schedule.strands?.join(', ') || 'All strands'}</dd></div>
      {showWorksite && schedule.worksite && <div><dt>Worksite</dt><dd>{[request?.partner_name, schedule.worksite].filter(Boolean).join(' · ')}</dd></div>}
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
    {schedule.dates?.length > 0 && <details>
      <summary>{schedule.dates.length} workdays · {schedule.daily_hours} h per day · {schedule.required_hours || schedule.dates.length * schedule.daily_hours} h scheduled</summary>
      <p>Time in {schedule.windows.time_in_open}–{schedule.windows.time_in_close} · Time out {schedule.windows.time_out_open}–{schedule.windows.time_out_close}</p>
      <ul className={styles.dateList}>{schedule.dates.map((date) => <li key={date}>{formatDate(date)}</li>)}</ul>
    </details>}
  </section>;
}

function SupervisorChangesForm({ request, options, onSave, busy }) {
  const { proposal, teacher_ids } = request;
  const [teachers, setTeachers] = useState(teacher_ids?.filter(Boolean) || []);
  const [strands, setStrands] = useState(proposal.strands ?? null);
  const ready = !busy && teachers.length > 0 && strands?.length !== 0;
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    if (ready) onSave({ ...Object.fromEntries(new FormData(event.currentTarget)), teacher_ids: teachers, strands });
  }}>
    <div className={styles.formGrid}>
      <Field label="Proposed start date" name="start" type="date" defaultValue={proposal.start} required />
      <Field label="Maximum students" name="capacity" type="number" min="1" defaultValue={proposal.capacity} required />
    </div>
    <TeacherSelection teachers={teachers} setTeachers={setTeachers} options={options.teachers} busy={busy} />
    <StrandFields catalog={options.strands} selection={strands} setSelection={setStrands} />
    <Notes label="Special requirements or instructions (optional)" name="reason" />
    <div className={styles.actions}>
      <button className={styles.primary} type="submit" disabled={!ready}>{busy ? 'Saving…' : 'Submit Change Request'}</button>
    </div>
  </form>;
}

function AgreementRosterForm({ detail, schedule, action, busy, close, save, refresh }) {
  const [students, setStudents] = useState(detail.proposed_students || []);
  const finalizing = action === 'finalize';
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    save(action, { decision: 'accept', student_ids: finalizing ? students.map(({ id }) => id) : [] });
  }}>
    {finalizing && <StudentSelection start={schedule.start}
      seats={schedule.capacity} strands={schedule.strands} students={students} setStudents={setStudents} refresh={refresh} />}
    <div className={styles.actions}>
      <button className={styles.primary} disabled={busy || (finalizing && (students.length > schedule.capacity || students.length === 0))}>
        {busy ? 'Saving…' : finalizing ? 'Finalize deployment' : 'Accept changes'}
      </button>
      <button className={styles.secondary} type="button" onClick={close}>Close form</button>
    </div>
  </form>;
}

function ReasonForm({ title, busy, onSave, close }) {
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    if (!busy) onSave(new FormData(event.currentTarget).get('reason'));
  }}>
    <Notes label="Reason" name="reason" required />
    <div className={styles.actions}><button className={styles.primary} disabled={busy}>{busy ? 'Saving…' : title}</button>
      <button className={styles.secondary} type="button" disabled={busy} onClick={close}>Close form</button></div>
  </form>;
}

function CancelRequestDialog({ requestId, refresh, busy, mutate, onClose, onCancelled }) {
  const dialogRef = useRef(null);
  const [error, setError] = useState('');
  const detail = useDeploymentData('coordinator', `/${requestId}`, refresh);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  function close() {
    dialogRef.current.close();
    onClose();
  }

  return <dialog className={styles.proposalDialog} ref={dialogRef} aria-labelledby="cancel-request-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <header className={styles.proposalDialogHeader}>
      <h2 id="cancel-request-title">Cancel deployment request</h2>
      <button className={styles.dialogClose} type="button" disabled={busy} aria-label="Close cancellation form" onClick={close}>
        <X size={20} aria-hidden="true" />
      </button>
    </header>
    <div className={styles.proposalDialogBody}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <LoadState result={detail}>{({ request }) => <>
        <p><strong>{request.partner_name}</strong> · {request.reference}</p>
        {openRequestStatuses.includes(request.status) ?
          <ReasonForm title="Confirm cancellation" busy={busy} close={close} onSave={async (reason) => {
            setError('');
            const saved = await mutate(`/${request.id}/cancel`, { revision: request.revision, reason }, 'PUT', setError);
            if (saved) {
              close();
              onCancelled();
            }
          }} /> : <p>This request has changed. Close this form to check its current status.</p>}
      </>}</LoadState>
    </div>
  </dialog>;
}

function Roster({ detail, busy, save, refresh, editable }) {
  const { request, roster } = detail;
  const [search, setSearch] = useState('');
  const [find, setFind] = useState(false);
  const [remove, setRemove] = useState('');
  const [add, setAdd] = useState('');
  const current = roster.filter((student) => !student.deployment_ended_on);
  const open = editable && ['approved', 'ongoing'].includes(request.status);
  const result = useDeploymentData('coordinator', open && find ? `/${request.id}/candidates?${query({ search })}` : null, refresh);
  return <section className={styles.panel}>
    <h3>Student allocation</h3>
    <p className={styles.badges}><Badge value={detail.allocation_status} />
      {request.confirmed_schedule && <span>{detail.active} assigned · {detail.remaining} remaining</span>}</p>
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

function ApprovalConfirmationDialog({ request, busy, error, onApprove, onCancel }) {
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
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}>
      <button className={styles.primary} type="button" disabled={busy} onClick={onApprove}>
        {busy ? 'Approving…' : 'Yes, approve request'}
      </button>
      <button className={styles.secondary} type="button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </dialog>;
}

function HistoryEntries({ history }) {
  return <ul className={styles.roster}>{history.map((entry) => {
    const schedule = entry.after_state?.schedule || entry.after_state;
    return <li key={entry.id}>
      <span><strong className={styles.actionName}>{entry.action.replaceAll('_', ' ')}</strong>{entry.reason && ` · ${entry.reason}`}
        {schedule?.start && schedule.end && <small>{formatDate(schedule.start)} – {formatDate(schedule.end)} · {schedule.capacity} students</small>}
      </span>
      <small>{entry.actor_name || entry.actor_role || 'School system'} · <time dateTime={entry.created_at}>
        {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(entry.created_at))}
      </time></small>
    </li>;
  })}</ul>;
}

export function DeploymentDialog({ title, children, settings, busy, onClose, cancelLabel = 'Close', confirmButton, className = '' }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  function close() {
    if (busy) return;
    dialogRef.current.close();
    onClose();
  }

  return <dialog className={`${styles.proposalDialog} ${className}`} ref={dialogRef} aria-labelledby="deployment-dialog-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className={styles.proposalDialogHeader}>
      <h2 id="deployment-dialog-title">{title}</h2>
      {settings}
    </header>
    <div className={styles.proposalDialogBody}>{children}</div>
    <footer className={styles.requestDialogFooter}>
      <button className={styles.secondary} type="button" disabled={busy} onClick={close}>{cancelLabel}</button>
      {confirmButton}
    </footer>
  </dialog>;
}

function ReturnedProposalEditor({ request, history, refresh, busy, mutate, onClose, onResubmitted }) {
  const [original] = useState(request);
  const [error, setError] = useState('');
  const partner = { id: original.partner_institution_id, name: original.partner_name, address: original.partner_address };
  return <>
    <p><strong>{partner.name}</strong> · {original.reference}</p>
    <RequestChangesSummary proposal={{ ...original.proposal, teacher_name: original.teacher_name }} changes={original.counterproposal} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <ProposalForm partner={partner} initial={original} revision={refresh} busy={busy} onCancel={onClose}
      onSave={async (proposal) => {
        setError('');
        const saved = await mutate(`/${original.id}/resubmit`, { ...proposal, revision: original.revision }, 'PUT', setError);
        if (saved) onResubmitted();
      }} />
    {history.length > 0 && <details className={styles.historyPanel}>
      <summary>Proposal activity</summary>
      <HistoryEntries history={history} />
    </details>}
  </>;
}

function EditProposalDialog({ id, refresh, busy, mutate, onClose, onResubmitted }) {
  const detail = useDeploymentData('coordinator', `/${id}`, refresh);
  return <DeploymentDialog title="Edit Proposal" busy={busy} onClose={onClose}>
    <LoadState result={detail}>{({ request, history }) => request.requesting_stage === 'changes_requested' ?
      <ReturnedProposalEditor request={request} history={history} refresh={refresh} busy={busy} mutate={mutate}
        onClose={onClose} onResubmitted={onResubmitted} /> : <p>This proposal has already moved to another stage.</p>}
    </LoadState>
  </DeploymentDialog>;
}

function SupervisorProposalCard({ request, linked, onOpen, onReview, busy }) {
  const proposal = { ...request.proposal, teacher_ids: request.teacher_ids, teacher_name: request.teacher_name };
  const previous = request.previous_proposal && proposalFields(request.previous_proposal);
  const approved = approvedRequestStatuses.includes(request.status);
  const schedule = request.confirmed_schedule || proposal;
  return <article className={styles.supervisorFeatureCard} ref={linked && !approved ? revealRequest : undefined}>
    <div className={styles.supervisorCardHeading}>
      <span className={styles.supervisorCardIcon}><Building2 size={21} aria-hidden="true" /></span>
      <div>
        <h3>{request.partner_name}</h3>
        <p>{request.reference} · {request.coordinator_name || 'School coordinator'}</p>
        {[request.coordinator_school, request.coordinator_department].some(Boolean) &&
          <p>{[request.coordinator_school, request.coordinator_department].filter(Boolean).join(' · ')}</p>}
      </div>
    </div>
    <div className={styles.badges}>
      <Badge value={request.status} />
      {approved && request.schedule_status === 'upcoming' && <Badge value="upcoming" />}
      {previous && <Badge value="resubmitted" label="Revised proposal" />}
    </div>
    {approved ? <dl className={styles.partnerDetails}>
      <div><dt>Deployment schedule</dt><dd>{formatDate(schedule.start)}{schedule.end && ` – ${formatDate(schedule.end)}`}</dd></div>
      <div><dt>Student capacity</dt><dd>{schedule.capacity ?? 'Not set'}</dd></div>
      <div><dt>Assigned teachers</dt><dd>{request.teacher_name || 'Unassigned'}</dd></div>
      <div><dt>Date submitted</dt><dd>{formatDate(request.submitted_at || request.created_at)}</dd></div>
    </dl> : <dl className={`${styles.scheduleDetails} ${styles.supervisorProposalFields}`}>
      <div><dt>Date submitted</dt><dd>{formatDate(request.submitted_at || request.created_at)}</dd></div>
      {proposalFields(proposal).map((field, index) => {
        const changed = previous && field.value !== previous[index].value;
        return <div key={field.key} className={`${changed ? styles.revisedField : ''} ${field.key === 'notes' ? styles.scheduleDetailsWide : ''}`}>
          <dt>{field.label}{changed && ' · Changed'}</dt>
          <dd>{field.text}{changed && <small>Previously: {previous[index].text}</small>}</dd>
        </div>;
      })}
    </dl>}
    {request.requesting_stage === 'changes_requested' &&
      <RequestChangesSummary proposal={proposal} changes={request.counterproposal} />}
    {request.status === 'pending' && <div className={`${styles.actions} ${styles.supervisorCardActions}`}>
      <button className={styles.primary} type="button" disabled={busy} aria-haspopup="dialog"
        onClick={() => onReview(request, 'approved')}>
        <Handshake className={styles.approveHand} size={19} aria-hidden="true" /> Approve
      </button>
      <button className={styles.secondary} type="button" disabled={busy} aria-haspopup="dialog"
        onClick={() => onReview(request, 'changes_requested')}>Request Changes</button>
    </div>}
    {approved && <div className={styles.supervisorCardActions}>
      <button className={styles.secondary} type="button" disabled={busy} aria-haspopup="dialog"
        onClick={() => onOpen(request.id)}>View deployment <ChevronRight size={16} aria-hidden="true" /></button>
    </div>}
  </article>;
}

function SupervisorChangeRequestDialog({ request, busy, refresh, onSave, onClose, error }) {
  const options = useDeploymentData('supervisor', `/${request.id}/review-options`, refresh);
  return <DeploymentDialog title="Request Changes" busy={busy} onClose={onClose}>
    <p><strong>{request.coordinator_name || 'School coordinator'}</strong> · {request.reference}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <LoadState result={options}>{(data) => <SupervisorChangesForm request={request} options={data} busy={busy} onSave={onSave} />}</LoadState>
  </DeploymentDialog>;
}

function SupervisorRequests({ result, selected, requestId, mutate, refresh, busy, onReviewed, children }) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const close = () => {
    setReview(null);
    setError('');
  };
  const save = async (fields) => {
    if (busy) return;
    setError('');
    const { request, status } = review;
    const saved = await mutate(`/${request.id}/review`, { ...fields, status, revision: request.revision }, 'PUT', setError);
    if (saved) {
      close();
      onReviewed(status);
    }
  };
  const requests = [...(result.data?.requests || [])].sort((first, second) => Date.parse(second.submitted_at) - Date.parse(first.submitted_at));
  const pending = requests.filter(({ requesting_stage }) => requesting_stage);
  const otherLinked = selected && !selected.requesting_stage && !approvedRequestStatuses.includes(selected.status);
  const cards = (items) => items.map((request) => <SupervisorProposalCard key={request.id} request={request}
    linked={String(request.id) === requestId} busy={busy}
    onReview={(target, status) => setReview({ request: target, status })} />);

  return <>
    <div className={styles.supervisorQueues}>
      {children}
      <section className={styles.supervisorCards} aria-label="Submitted proposals">
        <h2>Submitted proposals</h2>
        <LoadState result={result}>{() => pending.length ? cards(pending) :
          <p className={styles.supervisorEmpty}>No proposals awaiting review or revision.</p>}</LoadState>
        {otherLinked && cards([selected])}
      </section>
    </div>
    {review?.status === 'approved' && <ApprovalConfirmationDialog request={review.request} busy={busy} error={error}
      onApprove={() => save({})} onCancel={close} />}
    {review?.status === 'changes_requested' && <SupervisorChangeRequestDialog request={review.request} busy={busy}
      refresh={refresh} error={error} onSave={save} onClose={close} />}
  </>;
}

export function SupervisorApprovedDeployments({ search = '' }) {
  const [params, setParams] = useSearchParams();
  const [refresh, setRefresh] = useDeploymentRefresh();
  const { action, clearAction, mutate } = useDeploymentAction('supervisor', setRefresh);
  const requestId = params.get('request');
  const list = useDeploymentData('supervisor', '', refresh);
  const detail = useDeploymentData('supervisor', requestId ? `/${encodeURIComponent(requestId)}` : null, refresh);
  const term = search.trim().toLowerCase();
  const approved = (list.data?.requests || []).filter((request) => approvedRequestStatuses.includes(request.status) &&
    [request.partner_name, request.industry, request.reference].some((value) => value?.toLowerCase().includes(term)))
    .sort((first, second) => Date.parse(second.submitted_at) - Date.parse(first.submitted_at));
  const request = detail.data?.request || approved.find(({ id }) => String(id) === requestId);

  function selectRequest(id) {
    clearAction();
    const next = new URLSearchParams(params);
    if (id) next.set('request', id);
    else next.delete('request');
    setParams(next, { replace: true, preventScrollReset: true });
  }

  return <section className={`${styles.page} ${styles.supervisorPage} ${styles.supervisorCards}`} aria-label="Approved deployments">
    <h2>Approved deployments</h2>
    <LoadState result={list}>{() => approved.length ? <div className={styles.supervisorApprovedGrid}>
      {approved.map((item) => <SupervisorProposalCard key={item.id} request={item} onOpen={selectRequest} busy={action.busy} />)}
    </div> : <p className={styles.supervisorEmpty}>{term ? 'No approved deployments match your search.' : 'No approved deployments yet.'}</p>}</LoadState>
    {requestId && <DeploymentDialog key={requestId} className={styles.supervisorDetailDialog}
      title={request ? `${request.partner_name} · ${request.reference}` : 'Deployment details'}
      busy={action.busy} onClose={() => selectRequest(null)}>
      <DeploymentActionFeedback action={action} onRefresh={() => { clearAction(); setRefresh((value) => value + 1); }} />
      <LoadState result={detail}>{(data) => <>
        <RequestDetail role="supervisor" detail={data} refresh={refresh} mutate={mutate} busy={action.busy} />
        {data.history?.length > 0 && <details className={styles.historyPanel}>
          <summary>Activity history</summary>
          <HistoryEntries history={data.history} />
        </details>}
      </>}</LoadState>
    </DeploymentDialog>}
  </section>;
}

function CancelledRequestHistory({ refresh, onClose }) {
  const result = useDeploymentData('coordinator', '?status=cancelled', refresh);
  return <DeploymentDialog title="Request history" onClose={onClose}>
    <LoadState result={result}>{({ requests }) => requests.length ? <ul className={styles.roster}>
      {[...requests].sort((first, second) => Date.parse(second.updated_at) - Date.parse(first.updated_at)).map((request) => <li key={request.id}>
        <span><strong>{request.partner_name}</strong><small>{request.reference}</small></span>
        <span><Badge value="cancelled" /><small><time dateTime={request.updated_at}>{formatDate(request.updated_at)}</time></small></span>
      </li>)}
    </ul> : <p>No cancelled requests yet.</p>}</LoadState>
  </DeploymentDialog>;
}

function RequestDetail({ role, detail, refresh, mutate, busy, goBack }) {
  const { request, strands } = detail;
  const school = role !== 'supervisor';
  const coordinator = role === 'coordinator';
  const negotiating = coordinator && request.status === 'pending_coordinator_agreement';
  const agreed = ['approved', 'ongoing'].includes(request.status);
  const amendment = request.schedule_amendment;
  const canProposeAmendment = agreed && !amendment && (coordinator || (!school && !request.has_created_batch));
  const canFinalize = coordinator && agreed && request.agreement && !request.teacher_batch_id && !amendment;
  const [form, setForm] = useState('');
  const decidingAmendment = agreed && amendment && (!school || coordinator) &&
    amendment.proposed_by !== (coordinator ? request.coordinator_id : request.supervisor_id);
  const cancellable = coordinator && !['rejected', 'cancelled', 'completed'].includes(request.status);
  const save = async (action, data) => {
    const success = await mutate(`/${request.id}/${action}`, { ...data, revision: request.revision });
    if (success) setForm('');
    return success;
  };
  const close = () => setForm('');
  const partner = { id: request.partner_institution_id, name: request.partner_name, address: request.partner_address };
  const finalizeForm = form === 'finalize' && canFinalize &&
    <AgreementRosterForm detail={detail} schedule={request.confirmed_schedule} action="finalize" busy={busy}
      close={close} save={save} refresh={refresh} />;

  return <>
    {school && goBack && <button className={styles.back} type="button" onClick={goBack}><ArrowLeft size={17} /> Back to deployments</button>}
    <section className={styles.panel}>
      <div className={styles.headingRow}>
        <div>
          {role === 'supervisor' && <span className={styles.headingLabel}>Coordinator</span>}
          <h2>{role === 'supervisor' ? request.coordinator_name || 'School coordinator' : request.partner_name}</h2>
          <p>{request.reference} · {request.confirmed_schedule?.required_hours || 80} h required</p>
        </div>
        <div className={styles.badges}><Badge value={request.status} /><Badge value={request.schedule_status} /></div>
      </div>
      <dl className={styles.stats}>
        <div><dt>Teacher</dt><dd>{request.teacher_name || 'Unassigned'}</dd></div>
        <div><dt>Supervisor</dt><dd>{request.supervisor_name}</dd></div>
        {role !== 'supervisor' && <div><dt>Coordinator</dt><dd>{request.coordinator_name || 'School coordinator'}</dd></div>}
        <div><dt>Created</dt><dd>{formatDate(request.created_at)}</dd></div>
      </dl>
      {agreed && !request.teacher_batch_id && <p className={styles.notice}>Waiting for the coordinator to finalize student assignments.</p>}
      <div className={styles.actions}>
        {negotiating && <>
          <button className={styles.primary} type="button" onClick={() => setForm('accept-counter')}>Accept changes</button>
          <button className={styles.secondary} type="button" onClick={() => setForm('reject-counter')}>Reject changes</button>
        </>}
        {coordinator && ['draft', 'changes_requested', 'pending_coordinator_agreement'].includes(request.status) &&
          <button className={styles.secondary} type="button" onClick={() => setForm('resubmit')}>{request.status === 'draft' ? 'Edit draft' : 'Revise proposal'}</button>}
        {canFinalize &&
          <button className={styles.primary} type="button" onClick={() => setForm('finalize')}>Finalize student assignments</button>}
        {canProposeAmendment && <button className={styles.secondary} type="button" onClick={() => setForm('amendment')}>Propose schedule amendment</button>}
        {decidingAmendment && <>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => save('amendment-decision', { decision: 'accept' })}>Accept amendment</button>
          <button className={styles.secondary} type="button" onClick={() => setForm('reject-amendment')}>Reject amendment</button>
        </>}
        {cancellable && <button className={styles.secondary} type="button" onClick={() => setForm('cancel')}>Cancel deployment</button>}
      </div>
      {form === 'resubmit' && <ProposalForm partner={partner} initial={request} revision={refresh} onSave={(data) => save('resubmit', data)} onCancel={close} busy={busy} />}
      {form === 'accept-counter' && <AgreementRosterForm detail={detail} schedule={request.counterproposal} action="counterproposal-decision" busy={busy} close={close} save={save} refresh={refresh} />}
      {form === 'reject-counter' && <ReasonForm title="Reject changes" onSave={(reason) => save('counterproposal-decision', { decision: 'reject', reason })} busy={busy} close={close} />}
      {finalizeForm}
      {form === 'amendment' && canProposeAmendment && <AmendmentForm request={request} strands={strands} busy={busy} onSave={(data) => save('amendment', data)} onCancel={close} />}
      {form === 'reject-amendment' && <ReasonForm title="Reject amendment" onSave={(reason) => save('amendment-decision', { decision: 'reject', reason })} busy={busy} close={close} />}
      {form === 'cancel' && <ReasonForm title="Confirm cancellation" onSave={(reason) => save('cancel', { reason })} busy={busy} close={close} />}
    </section>
    <div className={styles.compare}>
      <ScheduleSummary title="Coordinator proposal" schedule={request.proposal} request={request} detailed />
      <ScheduleSummary title="Supervisor counterproposal" schedule={request.counterproposal} />
      <ScheduleSummary title="Agreed deployment schedule" schedule={request.confirmed_schedule} />
    </div>
    <ScheduleSummary title="Proposed schedule amendment" schedule={request.schedule_amendment} showWorksite={role !== 'supervisor'} />
    {agreed && !request.teacher_batch_id && detail.proposed_students?.length > 0 && <section className={styles.panel}>
      <h3>Proposed students</h3>
      <ul className={styles.roster}>{detail.proposed_students.map((student) => <li key={student.id}>{person(student)}</li>)}</ul>
    </section>}
    {request.teacher_batch_id && <Roster detail={detail} busy={busy} save={save} refresh={refresh} editable={coordinator} />}
  </>;
}

function PartnerDetail({ id, refresh, openRequest, back }) {
  const list = useDeploymentData('coordinator', `?partner=${id}`, refresh);
  const partnerData = useDeploymentData('coordinator', `/partners/${id}`, refresh);
  return <>
    {back && <button className={styles.back} type="button" onClick={back}><ArrowLeft size={17} /> All partners</button>}
    <LoadState result={partnerData}>{({ partner }) => <section className={styles.panel}>
      <h2>{partner.name}</h2>
      <p>{[partner.industry, partner.address, partner.is_active ? 'Active partner' : 'Inactive partner'].filter(Boolean).join(' · ')}</p>
      {partner.description && <p>{partner.description}</p>}
    </section>}</LoadState>
    <section className={styles.panel}>
      <h3>Deployment history</h3>
      <LoadState result={list}>{({ requests }) => <RequestList requests={requests} onOpen={openRequest} empty="This partner has no deployment requests yet." />}</LoadState>
    </section>
  </>;
}

function PartnerDetailDialog({ role, id, refresh, openRequest }) {
  const list = useDeploymentData(role, `?partner=${id}`, refresh);
  const partnerData = useDeploymentData(role, `/partners/${id}`, refresh);
  return <>
    <LoadState result={partnerData}>{({ partner }) => <section className={styles.panel}>
      <h2>{partner.name}</h2>
      <p>{[partner.industry, partner.address, partner.is_active ? 'Active partner' : 'Inactive partner'].filter(Boolean).join(' · ')}</p>
      {partner.description && <p>{partner.description}</p>}
    </section>}</LoadState>
    <section className={styles.panel}>
      <h3>Deployment history</h3>
      <LoadState result={list}>{({ requests }) => <RequestList requests={requests} onOpen={openRequest} empty="This partner has no deployment requests yet." />}</LoadState>
    </section>
  </>;
}

export default function PartnerDeployments({ role = 'coordinator' }) {
  const [params, setParams] = useSearchParams();
  const { state: navigation } = useLocation();
  const [section, setSection] = useState('partners');
  const [filters, setFilters] = useState({});
  const [requestingStage, setRequestingStage] = useState('in_progress');
  const [status, setStatus] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState('');
  const [refresh, setRefresh] = useDeploymentRefresh();
  const { action, setAction, clearAction, mutate } = useDeploymentAction(role, setRefresh,
    navigation?.studentAssignmentSubmitted ? 'Students submitted for supervisor approval.' : '');
  const [monitoredRequestId, setMonitoredRequestId] = useState(null);
  const [cancellationRequestId, setCancellationRequestId] = useState(null);
  const [editingRequestId, setEditingRequestId] = useState(null);
  const [assignmentPartner, setAssignmentPartner] = useState(null);
  const [viewPartnerId, setViewPartnerId] = useState(null);
  const [showRequestHistory, setShowRequestHistory] = useState(false);
  const school = role !== 'supervisor';
  const coordinator = role === 'coordinator';
  const linkedStudentReview = !school && params.get('students') === '1';
  const routeRequestId = coordinator || linkedStudentReview ? null : params.get('request');
  const partnerId = coordinator ? null : params.get('partner');
  const schoolIndex = school && !coordinator && !routeRequestId && !partnerId;
  const browse = coordinator || (schoolIndex && section === 'partners');
  const monitor = schoolIndex && section === 'monitor';
  const stage = coordinator ? filters.stage || deploymentStages[0][0] : null;
  const requesting = stage === 'requesting';
  const studentDeployment = stage === 'students_submitted' || stage === 'students_rejected';
  const topLevelStage = studentDeployment ? 'students_submitted' : stage;
  const assignmentMode = stage === 'students_submitted' ? 'submitted' : stage === 'students_rejected' ? 'rejected' : null;
  const browsePartners = browse && !assignmentMode;
  const showMonitoredRequest = monitor && Boolean(monitoredRequestId);
  const requestId = showMonitoredRequest ? monitoredRequestId : routeRequestId;
  const options = useDeploymentData(role, browse && !coordinator ? '/options' : null, refresh);
  const partnerQuery = stage ? {
    stage, active: 'all', page: filters.page, requesting_stage: requesting ? requestingStage : null,
  } : filters;
  const partners = useDeploymentData(role, browsePartners ? `/partners?${query(partnerQuery)}` : null, refresh);
  const studentApprovals = useDeploymentData(role, !school || assignmentMode || stage === 'completed' ? '/student-approvals' : null, refresh);
  const detail = useDeploymentData(role, requestId ? `/${encodeURIComponent(requestId)}` : null, refresh);
  const selected = detail.data?.request;
  const list = useDeploymentData(role, !school ? '' : monitor ? `?${query({ status })}` : null, refresh);
  const supervisorRequest = !school && requestId &&
    (selected || list.data?.requests.find(({ id }) => String(id) === requestId));
  const moveToInstitutions = approvedRequestStatuses.includes(supervisorRequest?.status);
  useEffect(() => {
    if (linkedStudentReview) setRefresh((value) => value + 1);
  }, [linkedStudentReview, params, setRefresh]);
  useEffect(() => {
    if (!coordinator) return;
    const linkedStage = params.get('stage');
    if (linkedStage === 'changes_requested') {
      setFilters((previous) => ({ ...previous, page: 1, stage: 'requesting' }));
      setRequestingStage('changes_requested');
    }
    if (linkedStage === 'approved') setFilters((previous) => ({ ...previous, page: 1, stage: 'approved' }));
    if (['students_submitted', 'students_rejected', 'completed'].includes(linkedStage)) {
      setFilters((previous) => ({ ...previous, page: 1, stage: linkedStage }));
    }
  }, [coordinator, params]);
  const changeFilter = (key, value) => setFilters((previous) => ({ ...previous, page: 1, [key]: value }));
  const selectRequestingStage = (value) => {
    setRequestingStage(value);
    changeFilter('page', 1);
  };
  const openRequest = (id) => {
    clearAction();
    setParams(partnerId ? { partner: partnerId, request: id } : { request: id });
  };
  const back = () => {
    clearAction();
    setParams(requestId && partnerId ? { partner: partnerId } : {});
  };
  const selectMonitoredRequest = (id) => {
    clearAction();
    setMonitoredRequestId(id == null ? null : String(id));
  };
  const createRequest = coordinator ? async (data, showError) => {
    const result = await mutate('', data, 'POST', showError);
    if (!result) return false;
    changeFilter('stage', 'requesting');
    setRequestingStage('in_progress');
    setAction({ busy: false, error: '', message: 'Proposal submitted for supervisor review.' });
    return true;
  } : undefined;
  const selectedDetail = requestId && <LoadState result={detail}>{(data) => <RequestDetail key={requestId} role={role} detail={data}
    refresh={refresh} mutate={mutate} busy={action.busy} goBack={showMonitoredRequest ? undefined : back} />}</LoadState>;
  const selectedPartner = partnerId && !requestId && school &&
    <PartnerDetail key={partnerId} id={partnerId} refresh={refresh} openRequest={openRequest} back={back} />;
  const settings = <DeploymentSettings key={requestId} role={role} schedule={options.data?.standard_schedule}
    refresh={refresh} requestId={requestId} detail={detail} />;
  const actionFeedback = <DeploymentActionFeedback action={action}
    onRefresh={() => { clearAction(); setRefresh((value) => value + 1); }} />;

  if (moveToInstitutions) return <Navigate to={`${supervisorInstitutionsPath}?${query({ request: requestId })}`} replace />;
  const pageLayout = school ? (role === 'coordinator' ? styles.coordinatorPage : '') : styles.supervisorPage;
  return <main className={`${styles.page} ${pageLayout}`}>
    {school ? <header className={styles.header}>
      <div>
        {coordinator && <p className={styles.headerEyebrow}>Work Immersion placements</p>}
        <h1>Deployment</h1>
        <p>Coordinate work immersion with partner institutions and manage student placements.</p>
      </div>
    </header> : <header className={styles.supervisorHeader}>
      <div>
        <h1>Deployment Request</h1>
        <p>Review school proposals and student assignments.</p>
      </div>
      {settings}
    </header>}
    {!showMonitoredRequest && actionFeedback}
    {!school && detail.error && <p className={styles.error} role="alert">{detail.error}</p>}
    {schoolIndex && <nav className={styles.tabs} aria-label="Deployment sections">
      <div className={styles.tabGroup}>
        <button type="button" aria-pressed={browse} onClick={() => setSection('partners')}>Partner institutions</button>
        <button type="button" aria-pressed={monitor} onClick={() => setSection('monitor')}>Request monitoring</button>
      </div>
      {!showMonitoredRequest && settings}
    </nav>}
    {browse && coordinator && <nav className={styles.tabs} aria-label="Deployment stages">
      {deploymentStages.map(([value, label], index) => <div key={value} className={styles.deploymentStage}>
        {index > 0 && <ArrowRight size={16} className={styles.stageArrow} aria-hidden="true" />}
        <button type="button" aria-pressed={topLevelStage === value}
          onClick={() => changeFilter('stage', value)}>{label}</button>
      </div>)}
    </nav>}
    {studentDeployment && <nav className={styles.tabs} aria-label="Student Deployment stages">
      {studentDeploymentStages.map(([value, label]) => <button key={value} type="button"
        aria-pressed={stage === value} onClick={() => changeFilter('stage', value)}>{label}</button>)}
    </nav>}
    {requesting && <div className={styles.requestingNavigation}>
      <nav className={styles.tabs} aria-label="Requesting stages">
        {requestingStages.map(([value, label]) => <button key={value} type="button" disabled={action.busy}
          aria-pressed={requestingStage === value}
          onClick={() => selectRequestingStage(value)}>{label}</button>)}
      </nav>
      <button className={styles.secondary} type="button" disabled={action.busy}
        aria-haspopup="dialog" onClick={() => setShowRequestHistory(true)}>
        <History size={16} aria-hidden="true" /> Request history
      </button>
    </div>}
    {showRequestHistory && <CancelledRequestHistory refresh={refresh} onClose={() => setShowRequestHistory(false)} />}
    {browsePartners && (stage === 'completed' ? <ReadyDeploymentPartners result={partners} studentApprovals={studentApprovals} /> :
      <Partners key={stage} result={partners} filters={filters} setFilter={changeFilter} stage={stage}
      supervisors={options.data?.supervisors || []} onOpen={coordinator ? undefined : setViewPartnerId}
      onCreate={createRequest} onCancelRequest={requesting ? setCancellationRequestId : undefined}
      onEditRequest={requesting && requestingStage === 'changes_requested' ? setEditingRequestId : undefined}
      onAssignStudents={stage === 'approved' ? setAssignmentPartner : undefined}
      revision={refresh} busy={action.busy} />)}
    {assignmentMode && <StudentApprovalPanel key={assignmentMode} result={studentApprovals} mode={assignmentMode}
      renderPendingCard={(partner, onViewStudents) => <PartnerCard partner={partner} stage={stage} onViewStudents={onViewStudents} />}
      onChanged={(submitted) => {
        setRefresh((value) => value + 1);
        if (submitted) {
          changeFilter('stage', 'students_submitted');
          setAction({ busy: false, error: '', message: 'Students resubmitted for supervisor approval.' });
        }
      }} />}
    {assignmentPartner && <AssignStudentsStartDialog partner={assignmentPartner} onClose={() => setAssignmentPartner(null)} />}
    {editingRequestId && <EditProposalDialog id={editingRequestId} refresh={refresh} mutate={mutate} busy={action.busy}
      onClose={() => setEditingRequestId(null)} onResubmitted={() => {
        setEditingRequestId(null);
        selectRequestingStage('in_progress');
        setAction({ busy: false, error: '', message: 'Proposal resubmitted for supervisor review.' });
      }} />}
    {cancellationRequestId && <CancelRequestDialog requestId={cancellationRequestId} refresh={refresh}
      busy={action.busy} mutate={mutate} onClose={() => setCancellationRequestId(null)}
      onCancelled={() => {
        changeFilter('stage', 'no_request');
        setAction({ busy: false, error: '', message: 'Request cancelled.' });
      }} />}
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
        return <div className={styles.panel}><RequestList requests={visible} onOpen={selectMonitoredRequest} empty="No deployment requests match these filters." /></div>;
      }}</LoadState>
    </div>}
    {!school && <SupervisorRequests result={list} selected={selected} requestId={requestId}
      mutate={mutate} refresh={refresh} busy={action.busy}
      onReviewed={(decision) => setAction({ busy: false, error: '',
        message: decision === 'approved' ? 'Proposal approved.' : 'Requested changes sent to the coordinator.' })}>
      <StudentApprovalPanel result={studentApprovals} mode="supervisor"
        linkedRequestId={linkedStudentReview ? params.get('request') : null} onChanged={() => setRefresh((value) => value + 1)} />
    </SupervisorRequests>}
    {viewPartnerId && <DeploymentDialog title="View Partner" onClose={() => setViewPartnerId(null)}>
      <PartnerDetailDialog role={role} id={viewPartnerId} refresh={refresh} openRequest={openRequest} />
    </DeploymentDialog>}
    {showMonitoredRequest ? <DeploymentDialog title="Deployment request" settings={settings} busy={action.busy} onClose={() => selectMonitoredRequest(null)}>
      {actionFeedback}
      {selectedDetail}
    </DeploymentDialog> : school && (selectedDetail || selectedPartner)}
  </main>;
}
