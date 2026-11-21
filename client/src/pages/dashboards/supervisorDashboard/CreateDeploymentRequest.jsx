import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getSupervisorDeploymentRequests,
  getDeploymentRequestStudents,
} from '../../../api/coordinatorApi';
import {
  Users,
  Clock3,
  CheckCircle2,
  Search,
  X,
  Inbox,
  FileText,
  ChevronLeft,
} from 'lucide-react';
import styles from './Deployment.module.css';

const AWAITING_LABEL = 'Awaiting coordinator';

const statusBadge = (status) => {
  const map = {
    pending: styles.badgePending,
    approved: styles.badgeApproved,
    rejected: styles.badgeRejected,
    fulfilled: styles.badgeFulfilled,
  };
  return map[String(status || '').toLowerCase()] || styles.badgePending;
};

const fmtDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

function CreateDeploymentRequest() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [toasts, setToasts] = useState([]);

  const [viewing, setViewing] = useState(null);
  const [viewStudents, setViewStudents] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  // "My Requests" lives in a centered modal, opened from the form action row.
  const [showRequests, setShowRequests] = useState(false);

  const showToast = (type, message) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };
  const showError = (m) => showToast('error', m);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => {
      const label = r.batch_label === AWAITING_LABEL ? 'awaiting coordinator' : String(r.batch_label || '').toLowerCase();
      const coordinator = `${r.coordinator_first_name || ''} ${r.coordinator_last_name || ''}`.toLowerCase();
      const strand = String(r.strand || '').toLowerCase();
      return label.includes(q) || coordinator.includes(q) || strand.includes(q);
    });
  }, [requests, search]);

  const handleView = async (id) => {
    setViewLoading(true);
    try {
      const data = await getDeploymentRequestStudents(id);
      setViewStudents(data.students || []);
      setViewing(id);
    } catch (err) {
      showError(err.message);
    } finally {
      setViewLoading(false);
    }
  };

  const closeView = () => {
    setViewing(null);
    setViewStudents([]);
  };

  // Opens the centered "My Requests" modal and refreshes the list on open.
  const openRequests = async () => {
    setSearch('');
    setShowRequests(true);
    setLoading(true);
    try {
      const r = await getSupervisorDeploymentRequests();
      setRequests(r.deployment_requests || []);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const closeRequests = () => {
    setShowRequests(false);
    closeView();
  };

  const activeRequest = requests.find((r) => String(r.id) === String(viewing));

  return (
    <div className={styles.page}>
      {/* TOASTS */}
      <div className={styles.toastContainer}>
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${t.type === 'success' ? styles.toastSuccess : styles.toastError}`} role="status">
            <span className={styles.toastIcon}>{t.type === 'success' ? <CheckCircle2 size={17} /> : <X size={17} />}</span>
            <span className={styles.toastMessage}>{t.message}</span>
            <button type="button" className={styles.toastClose} onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* PAGE HEADER */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <div>
            <h1>Earlier Deployment Requests</h1>
            <p>Review requests and batches created through the earlier deployment workflow.</p>
          </div>
        </div>
      </div>

      <div className={styles.formActions}>
        <button type="button" className={styles.primaryButton} onClick={openRequests}>
          <Inbox size={15} />
          View earlier requests
        </button>
        <Link className={styles.secondaryButton} to="/dashboard/supervisor/deployment-requests">
          Deployment Requests
        </Link>
      </div>

      {/* MY REQUESTS — centered modal */}
      {showRequests && (
        <div className={styles.overlay} onClick={closeRequests}>
          <div
            className={`${styles.reviewPanel} ${styles.widePanel}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.panelHeader}>
              <div className={styles.panelStudent}>
                <div className={styles.largeAvatar}>
                  <Inbox size={19} />
                </div>
                <div>
                  <h2>My Requests</h2>
                  <p>Track each request from awaiting action through to an assigned batch.</p>
                </div>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={closeRequests}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.toolbar}>
              <div className={styles.searchBox}>
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Search by batch, strand or coordinator…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className={styles.searchClear}
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.panelBody}>

        {loading ? (
          <div className={styles.loading}>
            <span className={styles.spinner} />
            Loading requests…
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <Inbox size={34} />
            <h3>{requests.length === 0 ? 'No requests yet' : 'No matching requests'}</h3>
            <p>
              {requests.length === 0
                ? 'Send your first student request using the form above.'
                : 'Try a different search term.'}
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Coordinator</th>
                  <th>Students</th>
                  <th>Notes</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isAwaiting = r.batch_label === AWAITING_LABEL;
                  return (
                    <tr key={r.id}>
                      <td>
                        {isAwaiting ? (
                          <span className={styles.awaitingLabel}>
                            <Clock3 size={12} />
                            Awaiting coordinator
                          </span>
                        ) : (
                          <strong className={styles.labelStrong}>{r.batch_label}</strong>
                        )}
                        {r.strand && <span className={styles.cellMeta}>{r.strand}</span>}
                      </td>
                      <td>
                        {r.coordinator_first_name || r.coordinator_last_name
                          ? `${r.coordinator_first_name} ${r.coordinator_last_name}`
                          : '—'}
                      </td>
                      <td>
                        <span className={styles.documentCount}>
                          <Users size={13} />
                          {r.num_students}
                        </span>
                        {Number(r.student_count) > 0 && (
                          <span className={styles.cellMeta}>{r.student_count} assigned</span>
                        )}
                      </td>
                      <td className={styles.cellNotes}>{r.notes || '—'}</td>
                      <td>{fmtDate(r.created_at)}</td>
                      <td>
                        <span className={`${styles.badge} ${statusBadge(r.status)}`}>{r.status}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.reviewButton}
                          onClick={() => handleView(r.id)}
                          disabled={viewLoading}
                        >
                          <Users size={14} />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            )}
            </div>

            <div className={styles.panelFooter}>
              <span className={styles.footerCount}>
                {requests.length} request{requests.length === 1 ? '' : 's'}
                {search.trim() ? ` · ${filtered.length} shown` : ''}
              </span>
              <button type="button" className={styles.secondaryButton} onClick={closeRequests}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ASSIGNED STUDENTS PANEL — stacks above the list modal */}
      {showRequests && viewing && (
        <div className={`${styles.overlay} ${styles.overlayHigh}`} onClick={closeView}>
          <div
            className={styles.reviewPanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.panelHeader}>
              <div className={styles.panelStudent}>
                <div className={styles.largeAvatar}>
                  <Users size={19} />
                </div>
                <div>
                  <h2>
                    {activeRequest?.batch_label === AWAITING_LABEL
                      ? 'Awaiting coordinator'
                      : activeRequest?.batch_label}
                  </h2>
                  <p>
                    {activeRequest?.num_students} student
                    {Number(activeRequest?.num_students) === 1 ? '' : 's'} requested
                    {activeRequest?.strand ? ` · ${activeRequest.strand}` : ''}
                  </p>
                </div>
              </div>
              <button type="button" className={styles.closeButton} onClick={closeView} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className={styles.panelBody}>
              <div className={styles.reviewSection}>
                <div className={styles.sectionHeading}>
                  <h3>Students in this request</h3>
                  <span className={`${styles.documentTotal} ${styles.totalComplete}`}>
                    {viewStudents.length}/{activeRequest?.num_students ?? 0}
                  </span>
                </div>

                {viewStudents.length === 0 ? (
                  <div className={styles.empty}>
                    <Users size={30} />
                    <h3>No students assigned yet</h3>
                    <p>Your coordinator will assign students once the batch is labelled.</p>
                  </div>
                ) : (
                  <div className={styles.documentList}>
                    {viewStudents.map((s) => (
                      <div key={s.id} className={styles.documentRow}>
                        <div className={styles.fileIcon}>
                          <FileText size={16} />
                        </div>
                        <div className={styles.documentInfo}>
                          <strong>
                            {s.first_name} {s.last_name}
                          </strong>
                          <span>{s.email}</span>
                        </div>
                        <span className={styles.docTag}>{s.strand || '—'}</span>
                        <span className={styles.gradeTag}>
                          {s.grade_level ? `Grade ${s.grade_level}` : 'Student'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.panelFooter}>
              <button type="button" className={styles.secondaryButton} onClick={closeView}>
                <ChevronLeft size={15} />
                Back to requests
              </button>
              <button type="button" className={styles.primaryButton} onClick={closeRequests}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CreateDeploymentRequest;
