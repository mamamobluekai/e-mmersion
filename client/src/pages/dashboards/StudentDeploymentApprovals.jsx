import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UsersRound } from 'lucide-react';
import { partnerDeploymentApi } from '../../api/partnerDeploymentApi';
import styles from './PartnerDeployments.module.css';

const labels = { pending: 'Pending approval', accepted: 'Accepted', rejected: 'Not accepted' };
const deploymentPath = '/dashboard/coordinator/deployment';
const person = (student) => `${student.first_name} ${student.last_name}`;
const formatDate = (date) => date && new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
}).format(new Date(date));

function StudentSummary({ student }) {
  return <span className={styles.studentSummary}>
    <strong>{person(student)}</strong>
    <small>{[student.student_number, student.track_strand, student.section].filter(Boolean).join(' · ')}</small>
    <small>{student.preferred_partner_name ? `Prefers ${student.preferred_partner_name}` : 'No preferred institution'}</small>
    {student.preferred_match && <span className={styles.badge} data-state="approved">Preferred Company Match</span>}
  </span>;
}

function AssignmentDialog({ title, children, busy, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    if (!dialogRef.current.open) dialogRef.current.showModal();
  }, []);
  const close = () => {
    if (busy) return;
    dialogRef.current.close();
    onClose();
  };
  return <dialog ref={dialogRef} aria-labelledby="student-deployment-dialog-title" className={styles.proposalDialog}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className={styles.proposalDialogHeader}>
      <h2 id="student-deployment-dialog-title">{title}</h2>
    </header>
    <div className={styles.proposalDialogBody}>{children}</div>
    <footer className={styles.requestDialogFooter}>
      <button type="button" className={styles.secondary} onClick={close} disabled={busy}>Close</button>
    </footer>
  </dialog>;
}

export function AssignStudentsStartDialog({ partner, onClose }) {
  const remaining = partner.confirmed_schedule.capacity - (partner.assigned_students ?? 0) - (partner.pending_students ?? 0);
  return <AssignmentDialog title="Assign Students" onClose={onClose}>
    <p><strong>{partner.name}</strong> · {remaining} places available</p>
    <div className={styles.actions}>
      <Link className={styles.primary} to={`${deploymentPath}/${partner.active_request_id}/students`}>Choose Students</Link>
    </div>
  </AssignmentDialog>;
}

export function ChooseStudentsPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  return <StudentAssignmentForm key={requestId} requestId={requestId} standalone
    onDone={() => navigate(`${deploymentPath}?stage=students_submitted`, {
      replace: true, state: { studentAssignmentSubmitted: true },
    })} />;
}

function focusAssignmentHeading(heading) {
  heading?.focus();
}

function StudentAssignmentForm({ requestId, rejected = [], onDone, onClose, standalone = false }) {
  const [details, setDetails] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [loadingError, setLoadingError] = useState('');
  const [selected, setSelected] = useState(() => rejected.map((student) => ({ ...student, id: student.student_id })));
  const [search, setSearch] = useState('');
  const [strand, setStrand] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revising = rejected.length > 0;

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      partnerDeploymentApi('coordinator', `/${requestId}`),
      partnerDeploymentApi('coordinator', `/${requestId}/assignment-candidates`),
    ]).then(([request, available]) => {
      if (!alive) return;
      if (request.status === 'fulfilled') setDetails(request.value);
      if (available.status === 'fulfilled') setCandidates(available.value);
      const failure = request.status === 'rejected' ? request : available.status === 'rejected' ? available : null;
      if (failure) setLoadingError(failure.reason.message);
    });
    return () => { alive = false; };
  }, [requestId]);

  const released = rejected.filter(({ student_id }) => !selected.some(({ id }) => id === student_id));
  const students = candidates?.students || [];
  const strands = [...new Set(students.map(({ track_strand }) => track_strand).filter(Boolean))].sort();
  const available = students.filter((student) =>
    (!strand || student.track_strand === strand) &&
    [person(student), student.student_number, student.track_strand, student.section].some((value) =>
      String(value || '').toLowerCase().includes(search.trim().toLowerCase())));
  const ready = details && (selected.length || released.length) &&
    (!selected.length || (candidates && selected.length <= candidates.remaining));
  const actionLabel = selected.length === 0 && released.length ? 'Release rejected students' :
    revising ? 'Resubmit Students' : 'Save and Submit Students';

  function selectStudent(student, checked) {
    setSelected((current) => {
      if (!checked) return current.filter(({ id }) => id !== student.id);
      return current.length < candidates.remaining && !current.some(({ id }) => id === student.id) ? [...current, student] : current;
    });
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await partnerDeploymentApi('coordinator', `/${requestId}/submit-students`, {
        revision: details.request.revision,
        student_ids: selected.map(({ id }) => id),
        release_ids: released.map(({ student_id }) => student_id),
      }, 'PUT');
      onDone(selected.length > 0);
    } catch (failure) {
      setError(failure.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const content = <>
    {!standalone && details && <p><strong>{details.request.partner_name}</strong> · {details.request.reference}</p>}
    {!details && !loadingError && <p role="status">Loading assignment details…</p>}
    {loadingError && <p className={styles.error} role="alert">{loadingError}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {revising && <div className={styles.proposalChanges}>
      <strong>Supervisor feedback</strong>
      <ul className={styles.roster}>{rejected.map((student) => <li key={student.student_id}>
        <StudentSummary student={student} />
        <span>{student.rejection_reason}<small>{formatDate(student.decided_at)}</small></span>
      </li>)}</ul>
      {details?.history.some(({ action }) => action === 'students_reviewed') && <details>
        <summary>Previous reviews</summary>
        <ul className={styles.roster}>{details.history.filter(({ action }) => action === 'students_reviewed').map((entry) =>
          <li key={entry.id}><span>{entry.actor_name || 'Supervisor'} · {formatDate(entry.created_at)}</span>
            <span>{entry.after_state?.decisions?.map(({ student_id, student_name, status, reason }) =>
              <small key={student_id}>{student_name || `Student #${student_id}`} · {labels[status]}{reason && ` · ${reason}`}</small>)}</span>
          </li>)}</ul>
      </details>}
    </div>}
    {confirming ? <>
      <p>{released.length ? `Confirm sending ${selected.length} student(s) for review and releasing ${released.length} rejected student(s).` :
        `Send ${selected.length} student(s) to the supervisor for approval?`}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Confirm submission'}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirming(false)}>Back to selection</button>
      </div>
    </> : details && <>
      {candidates && <p className={styles.hint}>{selected.length} selected · {candidates.remaining} places available</p>}
      {selected.length > 0 && <details><summary>Selected students ({selected.length})</summary>
        <ul className={styles.roster} aria-label="Selected students">{selected.map((student) =>
        <li key={student.id}><StudentSummary student={student} />
          <button type="button" className={styles.secondary} aria-label={`Remove ${person(student)}`}
            onClick={() => setSelected((current) => current.filter(({ id }) => id !== student.id))}>Remove</button>
        </li>)}</ul>
      </details>}
      {candidates && <div className={styles.form}>
        <div className={styles.formGrid}>
          <label>Search eligible students<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Strand<select value={strand} onChange={(event) => setStrand(event.target.value)}>
            <option value="">All strands</option>
            {strands.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
        </div>
        {available.length ? <ul className={`${styles.roster} ${standalone ? styles.studentChoices : styles.assignmentCandidates}`} aria-label="Eligible students">
          {available.map((student) => {
            const checked = selected.some(({ id }) => id === student.id);
            return <li key={student.id}>
              <label className={styles.studentChoice}>
                <input type="checkbox" checked={checked} disabled={!checked && selected.length >= candidates.remaining}
                  onChange={(event) => selectStudent(student, event.target.checked)} />
                <StudentSummary student={student} />
              </label>
            </li>;
          })}
        </ul> : <p className={styles.hint}>{students.length ? 'No students match these filters.' :
          'No students meet the eligibility requirements for this deployment.'}</p>}
      </div>}
      {released.length > 0 && <p className={styles.hint}>{released.length} rejected student(s) will become available for reassignment.</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!ready} onClick={() => setConfirming(true)}>{actionLabel}</button>
      </div>
    </>}
  </>;
  if (!standalone) return <AssignmentDialog title="Edit Student Assignment" busy={busy} onClose={onClose}>{content}</AssignmentDialog>;

  return <main className={styles.page}>
    <header className={`${styles.header} ${styles.studentSelectionHeader}`}>
      <div><h1 tabIndex={-1} ref={focusAssignmentHeading}>Choose Students</h1>
        {details && <p><strong>{details.request.partner_name}</strong> · {details.request.reference}</p>}
      </div>
      <Link className={styles.secondary} to={`${deploymentPath}?stage=approved`}>Back to Request approval</Link>
    </header>
    <section className={styles.panel} aria-label="Student selection">{content}</section>
  </main>;
}

function StudentReviewDialog({ students, onDone, onClose }) {
  const [choices, setChoices] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = students[0];
  const decisions = Object.entries(choices).filter(([, choice]) => choice.status)
    .map(([student_id, choice]) => ({ student_id, ...choice }));
  const updateChoice = (id, changes) => setChoices((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await partnerDeploymentApi('supervisor', `/${request.deployment_request_id}/review-students`,
        { revision: request.revision, decisions }, 'PUT');
      onDone();
    } catch (failure) {
      setError(failure.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }
  return <AssignmentDialog title="Review student assignments" busy={busy} onClose={onClose}>
    <p><strong>{request.partner_name}</strong> · {request.coordinator_name}</p>
    <AssignedStaff assignment={request} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {confirming ? <>
      <p>Confirm {decisions.filter(({ status }) => status === 'accepted').length} acceptance(s) and {decisions.filter(({ status }) => status === 'rejected').length} rejection(s).</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Confirm decisions'}</button>
        <button type="button" className={styles.secondary} onClick={() => setConfirming(false)} disabled={busy}>Back to review</button>
      </div>
    </> : <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      if (decisions.some(({ status, reason }) => status === 'rejected' && !reason?.trim())) {
        setError('Enter a reason for each rejected student.');
        return;
      }
      if (decisions.length) {
        setError('');
        setConfirming(true);
      }
    }}>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={!students.some(({ eligible }) => eligible)}
          onClick={() => setChoices((current) => ({ ...current, ...Object.fromEntries(students.filter(({ eligible }) => eligible)
            .map(({ student_id }) => [student_id, { status: 'accepted' }])) }))}>Accept all eligible students</button>
      </div>
      {students.map((student) => {
        const id = student.student_id;
        const choice = choices[id] || {};
        return <div className={styles.proposalChanges} key={id}>
          <StudentSummary student={student} />
          {!student.eligible && <p className={styles.hint}>This student's requirements are no longer eligible for approval.</p>}
          <label>Decision for {person(student)}
            <select value={choice.status || ''} onChange={(event) => updateChoice(id, { status: event.target.value })}>
              <option value="">Leave pending</option>
              <option value="accepted" disabled={!student.eligible}>Accept</option>
              <option value="rejected">Reject</option>
            </select>
          </label>
          {choice.status === 'rejected' && <label>Rejection reason
            <textarea required value={choice.reason || ''} maxLength={2000} onChange={(event) => updateChoice(id, { reason: event.target.value })} />
          </label>}
        </div>;
      })}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={!decisions.length}>Review decisions</button>
      </div>
    </form>}
  </AssignmentDialog>;
}

function groupAssignments(assignments) {
  const groups = new Map();
  for (const assignment of assignments) {
    const id = assignment.deployment_request_id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(assignment);
  }
  return groups;
}

function revealGroup(element) {
  element?.scrollIntoView({ block: 'nearest' });
}

function AssignmentRoster({ students }) {
  return <ul className={styles.roster}>{students.map((student) => <li key={student.student_id}>
    <StudentSummary student={student} />
    <span>
      <span className={styles.badge} data-state={student.status === 'accepted' ? 'approved' : student.status}>{labels[student.status]}</span>
      <small>Submitted {formatDate(student.submitted_at)} · Attempt {student.attempt}</small>
      {student.decided_at && <small>{student.status === 'accepted' ? 'Approved' : 'Rejected'} {formatDate(student.decided_at)}</small>}
      {student.rejection_reason && <small>{student.rejection_reason}</small>}
    </span>
  </li>)}</ul>;
}

function AssignedStaff({ assignment }) {
  return <p>{assignment.teacher_name || 'Unassigned teacher'} · {assignment.supervisor_name || 'Unassigned supervisor'}</p>;
}

export function AcceptedStudentsDialog({ partner, result, onClose }) {
  const requestId = partner.deployment_request_id ?? partner.active_request_id ?? partner.latest_request_id;
  const students = (result.data?.assignments || []).filter(({ deployment_request_id, status }) =>
    deployment_request_id === requestId && status === 'accepted');
  const assignment = students[0];
  const title = assignment ? `${assignment.partner_name} · ${assignment.request_reference}` : partner.name;

  return <AssignmentDialog title={title} onClose={onClose}>
    <AssignedStaff assignment={assignment ?? partner} />
    {result.loading && <p role="status">Loading student assignments…</p>}
    {result.error && <p className={styles.error} role="alert">{result.error}</p>}
    {result.data && (students.length ? <AssignmentRoster students={students} /> :
      <p className={styles.hint}>No accepted students for this deployment.</p>)}
  </AssignmentDialog>;
}

export function StudentApprovalPanel({ result, mode, onChanged, linkedRequestId, renderPendingCard }) {
  const [opened, setOpened] = useState(null);
  const [notice, setNotice] = useState('');
  const supervisor = mode === 'supervisor';
  const submitted = mode === 'submitted';
  const assignments = result.data?.assignments || [];
  const rows = supervisor || submitted ? assignments.filter(({ status }) => status === 'pending') :
    mode === 'rejected' ? assignments.filter(({ status }) => status === 'rejected') : assignments;
  const groups = groupAssignments(rows);
  const pendingRequest = submitted ? opened?.[0] : null;
  const pendingStudents = groups.get(pendingRequest?.deployment_request_id) || [];
  const empty = supervisor ? 'No student assignments awaiting review.' : mode === 'rejected' ?
    'No students were rejected.' : 'No student assignments awaiting approval.';
  return <section className={styles.supervisorCards} aria-label="Student deployment approvals">
    {supervisor && <h2>Student Deployment Approval</h2>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {result.loading && <p role="status">Loading student assignments…</p>}
    {result.error && <p className={styles.error} role="alert">{result.error}</p>}
    {result.data && groups.size === 0 && <p className={supervisor ? styles.supervisorEmpty : styles.hint}>{empty}</p>}
    {submitted && groups.size > 0 && <div className={styles.cards}>
      {[...groups].map(([id, students]) => {
        const partner = result.data.deployment_summaries?.[id];
        return partner && <Fragment key={id}>{renderPendingCard(partner, () => setOpened(students))}</Fragment>;
      })}
    </div>}
    {!submitted && [...groups].map(([id, students]) => {
      const first = students[0];
      return <article className={supervisor ? styles.supervisorFeatureCard : styles.panel}
        key={id} ref={String(id) === linkedRequestId ? revealGroup : undefined}>
        {supervisor ? <div className={styles.supervisorCardHeading}>
          <span className={styles.supervisorCardIcon}><UsersRound size={21} aria-hidden="true" /></span>
          <div><h3>{first.partner_name}</h3><p>{first.request_reference} · {first.coordinator_name}</p></div>
        </div> : <h3>{first.partner_name} · {first.request_reference}</h3>}
        <AssignedStaff assignment={first} />
        {supervisor ? <span className={styles.badge} data-state="pending">
          {students.length} {students.length === 1 ? 'student' : 'students'} awaiting review
        </span> : <AssignmentRoster students={students} />}
        {(supervisor || mode === 'rejected') && <button className={styles.primary} type="button" aria-haspopup="dialog"
          onClick={() => { setNotice(''); setOpened(students); }}>
          {supervisor ? 'Review students' : 'Edit Student Assignment'}
        </button>}
      </article>;
    })}
    {pendingRequest && <AssignmentDialog title={`${pendingRequest.partner_name} · ${pendingRequest.request_reference}`}
      onClose={() => setOpened(null)}>
      <AssignedStaff assignment={pendingRequest} />
      {pendingStudents.length ? <AssignmentRoster students={pendingStudents} /> :
        <p className={styles.hint}>No students are awaiting approval for this deployment.</p>}
    </AssignmentDialog>}
    {opened && !submitted && (supervisor ? <StudentReviewDialog students={opened} onClose={() => setOpened(null)} onDone={() => {
      setOpened(null);
      setNotice('Student decisions saved.');
      onChanged();
    }} /> : <StudentAssignmentForm requestId={opened[0].deployment_request_id} rejected={opened}
      onClose={() => setOpened(null)} onDone={(submitted) => {
        setOpened(null);
        setNotice(submitted ? 'Students resubmitted for supervisor approval.' : 'Rejected students released for reassignment.');
        onChanged(submitted);
      }} />)}
  </section>;
}
