import { useEffect, useState } from 'react';
import { getMySubmissionStatus, getMyPlacementInfo } from '../../../api/studentApi';
import styles from './PlacementStatus.module.css';

function fullName(person) {
  if (!person) return '';
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
}

// Written-out dates (e.g. "September 28, 2026") rather than numeric ones.
const LONG_DATE = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' };

function formatLongDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', LONG_DATE);
}

function initials(person) {
  if (!person) return '?';
  const first = (person.first_name || '').trim();
  const last = (person.last_name || '').trim();
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '?';
}

function PersonCard({ roleLabel, person, fallback, accent, onClick }) {
  const name = fullName(person) || fallback;
  const clickable = !!person;
  return (
    <button
      type="button"
      className={`${styles.personCard} ${styles[accent] || ''} ${clickable ? styles.clickable : ''}`}
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      title={clickable ? `View ${roleLabel.toLowerCase()} details` : fallback}
    >
      <div className={styles.personAvatar}>
        {person ? <span>{initials(person)}</span> : <span className={styles.avatarDash}>—</span>}
      </div>
      <div className={styles.personInfo}>
        <span className={styles.personRole}>{roleLabel}</span>
        <strong className={styles.personName}>{name}</strong>
        {person?.department && <span className={styles.personMeta}>{person.department}</span>}
        {person?.email && (
          <span className={styles.personMeta}>{person.email}</span>
        )}
        {clickable && <span className={styles.viewHint}>View details</span>}
      </div>
    </button>
  );
}

function PlacementStatus() {
  const [submission, setSubmission] = useState(null);
  const [placements, setPlacements] = useState([]);
  const [assignment, setAssignment] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [infoModal, setInfoModal] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function init(initialLoad = false) {
      if (initialLoad) setLoading(true);
      try {
        const [statusResult, placementResult] = await Promise.all([
          getMySubmissionStatus(),
          getMyPlacementInfo(),
        ]);
        if (!cancelled) {
          setError('');
          setSubmission(statusResult.submission || {});
          setPlacements(placementResult.placements || []);
          setAssignment(placementResult.assignment || null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init(true);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') init(); }, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const statusMap = {
    Pending: { label: 'Pending', cls: styles.badgePending },
    'Pending Review': { label: 'Pending Review', cls: styles.badgeReview },
    'Under Review': { label: 'Under Review', cls: styles.badgeReview },
    Approved: { label: 'Approved', cls: styles.badgeApproved },
    Rejected: { label: 'Rejected', cls: styles.badgeRejected },
    'Needs Revision': { label: 'Needs Revision', cls: styles.badgeNeeds },
    Hold: { label: 'On Hold', cls: styles.badgeNeeds },
  };

  const statusInfo = statusMap[submission?.status] || { label: submission?.status || 'Not started', cls: styles.badgePending };

  const placement = placements.find(({ deployment_id }) => String(deployment_id) === selectedId) || placements[0];

  return (
    <div className={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap');
      `}</style>

      <div className={styles.greeting}>
        <div>
          <h2>Deployment Status</h2>
          <p>
            {placement
              ? `You are assigned to ${placement.company_name}.`
              : 'Track your deployment and placement status here.'}
          </p>
        </div>
        {placement && (
          <div className={styles.batchPill}>
            <span>{placement.approval_date ? 'Accepted' : placement.status}</span>
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {placement && (
        <>
          {placements.length > 1 && <label>Select a deployment
            <select value={placement.deployment_id} onChange={(event) => setSelectedId(event.target.value)}>
              {placements.map(({ deployment_id, batch_label }) => <option key={deployment_id} value={deployment_id}>{batch_label}</option>)}
            </select>
          </label>}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Partner workplace and schedule</div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Partner company</span>
              <span className={styles.infoValue}>{placement.company_name || 'Awaiting company details'}</span>
              {placement.company_address && <span className={styles.infoValue}>{placement.company_address}</span>}
            </div>
            {placement.approval_date && <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Supervisor approval</span>
              <span className={styles.infoValue}>Accepted · {formatLongDate(placement.approval_date)}</span>
            </div>}
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Deployment schedule</span>
              <span className={styles.infoValue}>
                {formatLongDate(placement.start_date)} – {formatLongDate(placement.end_date)}
              </span>
            </div>
            <details className={styles.infoRow}>
              <summary>Official attendance schedule · {placement.attendance_dates.length} workdays</summary>
              {placement.attendance_windows && <p>Time in {placement.attendance_windows.time_in_open}–{placement.attendance_windows.time_in_close} · Time out {placement.attendance_windows.time_out_open}–{placement.attendance_windows.time_out_close}</p>}
              <ul>{placement.attendance_dates.map((date) => <li key={date}>{formatLongDate(date)}</li>)}</ul>
            </details>
            {placement.instructions && <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Deployment instructions</span>
              <p>{placement.instructions}</p>
            </div>}
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              My Deployment Team
            </div>
            <div className={styles.peopleGrid}>
              {placement.teachers.map((teacher) => <PersonCard
                key={teacher.id}
                roleLabel="Teacher"
                person={teacher}
                accent="accentTeacher"
                onClick={() =>
                  setInfoModal({ role: 'Teacher', person: teacher })
                }
              />)}
              <PersonCard
                roleLabel="Supervisor"
                person={placement.supervisor}
                fallback="Not assigned yet"
                accent="accentSupervisor"
                onClick={() =>
                  setInfoModal({ role: 'Supervisor', person: placement.supervisor })
                }
              />
              <PersonCard
                roleLabel="Coordinator"
                person={placement.coordinator}
                fallback="Not assigned yet"
                accent="accentCoordinator"
                onClick={() =>
                  setInfoModal({ role: 'Coordinator', person: placement.coordinator })
                }
              />
            </div>
          </div>

        </>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Requirement Status
        </div>
        {loading ? (
          <p className={styles.empty}>Loading...</p>
        ) : (
          <>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Status</span>
              <span className={`${styles.badge} ${statusInfo.cls}`}>{statusInfo.label}</span>
            </div>
            {submission.submitted_at && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Submitted On</span>
                <span className={styles.infoValue}>{formatLongDate(submission.submitted_at)}</span>
              </div>
            )}
            {submission.reviewed_at && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Reviewed On</span>
                <span className={styles.infoValue}>{formatLongDate(submission.reviewed_at)}</span>
              </div>
            )}
            {submission.coordinator_feedback && (
              <div className={styles.feedbackRow}>
                <span className={styles.infoLabel}>Coordinator Feedback</span>
                <p className={styles.feedbackText}>{submission.coordinator_feedback}</p>
              </div>
            )}
          </>
        )}
      </div>

      {!loading && !placement && (
        <div className={styles.section}>
          <div className={styles.pendingNote}>
            <div>
              <strong>{assignment?.status === 'pending' ? 'Pending supervisor approval' :
                assignment?.status === 'rejected' ? 'Assignment not accepted' :
                  assignment?.status === 'accepted' ? 'Accepted · Awaiting batch deployment' : 'Awaiting deployment assignment'}</strong>
              <p>{assignment ? assignment.partner_name :
                'Your placement and schedule will appear here when your coordinator deploys your batch.'}</p>
              {assignment?.rejection_reason && <p>{assignment.rejection_reason}</p>}
            </div>
          </div>
        </div>
      )}

      {infoModal && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setInfoModal(null)}
        >
          <div
            className={styles.infoModal}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.infoModalHeader}>
              <div className={styles.infoModalAvatar}>
                {initials(infoModal.person)}
              </div>
              <div>
                <span className={styles.infoModalRole}>{infoModal.role}</span>
                <h3 className={styles.infoModalName}>
                  {fullName(infoModal.person) || 'Student'}
                </h3>
              </div>
              <button
                type="button"
                className={styles.infoModalClose}
                onClick={() => setInfoModal(null)}
                aria-label="Close details"
              >
                ×
              </button>
            </div>

            <div className={styles.infoModalBody}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Role</span>
                <span className={styles.infoValue}>{infoModal.role}</span>
              </div>
              {infoModal.person.department && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Department</span>
                  <span className={styles.infoValue}>
                    {infoModal.person.department}
                  </span>
                </div>
              )}
              {infoModal.person.email && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Email</span>
                  <span className={styles.infoValue}>
                    {infoModal.person.email}
                  </span>
                </div>
              )}
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Deployment</span>
                <span className={styles.infoValue}>
                  {placement?.batch_label || '—'}
                </span>
              </div>
            </div>

            <div className={styles.infoModalFooter}>
              <button
                type="button"
                className={styles.infoModalBtn}
                onClick={() => setInfoModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlacementStatus;
