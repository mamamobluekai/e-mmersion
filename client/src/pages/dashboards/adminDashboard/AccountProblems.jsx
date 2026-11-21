import { useEffect, useState } from 'react';
import { Archive, Check, Flag, RefreshCw } from 'lucide-react';
import {
  archiveReportedStudent,
  getAccountProblemReports,
  resolveAccountProblemReport,
} from '../../../api/adminApi';
import { useToast } from '../../../components/admin/toastContext';
import styles from './AccountProblems.module.css';

const REASON_LABELS = {
  remove_account: 'Request account removal',
  duplicate_account: 'Duplicate account',
  incorrect_information: 'Incorrect student information',
  access_problem: 'Account access problem',
  other: 'Other concern',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function AccountProblems() {
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyReportId, setBusyReportId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAccountProblemReports(statusFilter)
      .then((data) => {
        if (active) setReports(data.reports || []);
      })
      .catch((err) => {
        if (active) showToast(err.message || 'Could not load account reports.', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [statusFilter, refreshKey, showToast]);

  const handleResolve = async (report) => {
    setBusyReportId(report.id);
    try {
      await resolveAccountProblemReport(report.id, resolutionNotes[report.id] || '');
      showToast('Report marked as resolved.', 'success');
      setRefreshKey((key) => key + 1);
    } catch (err) {
      showToast(err.message || 'Could not resolve the report.', 'error');
    } finally {
      setBusyReportId(null);
    }
  };

  const handleArchive = async (report) => {
    const studentName = `${report.first_name || ''} ${report.last_name || ''}`.trim() || 'this student';
    if (!window.confirm(`Archive ${studentName}'s account and resolve this report? The account can be restored later.`)) {
      return;
    }

    setBusyReportId(report.id);
    try {
      await archiveReportedStudent(report.id, resolutionNotes[report.id] || '');
      showToast('Student account archived and report resolved.', 'success');
      setRefreshKey((key) => key + 1);
    } catch (err) {
      showToast(err.message || 'Could not archive the student account.', 'error');
    } finally {
      setBusyReportId(null);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Student account support</span>
          <h1>Account Problems</h1>
          <p>Review coordinator reports, resolve account concerns, or archive accounts when removal is appropriate.</p>
        </div>
        <div className={styles.headerIcon} aria-hidden="true"><Flag size={22} /></div>
      </header>

      <section className={styles.panel} aria-labelledby="account-reports-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="account-reports-title">Coordinator reports</h2>
            <p>{reports.length} {statusFilter === 'all' ? 'report(s)' : `${statusFilter} report(s)`}</p>
          </div>
          <div className={styles.controls}>
            <label htmlFor="account-report-status">Show</label>
            <select
              id="account-report-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All reports</option>
            </select>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => setRefreshKey((key) => key + 1)}
              disabled={loading}
              aria-label="Refresh reports"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className={styles.stateMessage}>Loading account reports…</div>
        ) : reports.length === 0 ? (
          <div className={styles.stateMessage}>No {statusFilter === 'all' ? '' : `${statusFilter} `}reports to display.</div>
        ) : (
          <div className={styles.reportList}>
            {reports.map((report) => {
              const isBusy = busyReportId === report.id;
              const studentName = `${report.first_name || ''} ${report.last_name || ''}`.trim() || 'Student account unavailable';
              return (
                <article className={styles.reportCard} key={report.id}>
                  <div className={styles.reportTop}>
                    <div>
                      <span className={`${styles.status} ${report.status === 'open' ? styles.statusOpen : styles.statusResolved}`}>
                        {report.status === 'open' ? 'Open' : 'Resolved'}
                      </span>
                      <h3>{studentName}</h3>
                      <p className={styles.identity}>
                        {report.email || report.student_email || 'No email'}{report.student_number ? ` · ${report.student_number}` : ''}
                        {report.track_strand ? ` · ${report.track_strand}` : ''}
                      </p>
                    </div>
                    <div className={styles.reportMeta}>
                      <span>Reported by {report.reported_by}</span>
                      <time dateTime={report.created_at}>{formatDate(report.created_at)}</time>
                    </div>
                  </div>

                  <div className={styles.reportContent}>
                    <div>
                      <span className={styles.fieldLabel}>Reason</span>
                      <strong>{REASON_LABELS[report.reason] || report.reason}</strong>
                    </div>
                    <div>
                      <span className={styles.fieldLabel}>Coordinator comments</span>
                      <p className={styles.comments}>{report.comments}</p>
                    </div>
                  </div>

                  {report.status === 'open' ? (
                    <>
                      <label className={styles.noteLabel} htmlFor={`resolution-note-${report.id}`}>
                        Admin resolution note <span>(optional)</span>
                      </label>
                      <textarea
                        id={`resolution-note-${report.id}`}
                        value={resolutionNotes[report.id] || ''}
                        onChange={(event) => setResolutionNotes((notes) => ({
                          ...notes,
                          [report.id]: event.target.value,
                        }))}
                        maxLength={2000}
                        rows={2}
                        placeholder="Add what was done or why the report was closed..."
                        disabled={isBusy}
                      />
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.resolveButton}
                          onClick={() => handleResolve(report)}
                          disabled={isBusy}
                        >
                          <Check size={16} /> Mark resolved
                        </button>
                        {report.reason === 'remove_account' && (
                          <button
                            type="button"
                            className={styles.archiveButton}
                            onClick={() => handleArchive(report)}
                            disabled={isBusy}
                          >
                            <Archive size={16} /> Archive account & resolve
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className={styles.resolution}>
                      <span className={styles.fieldLabel}>Admin resolution</span>
                      <p>{report.resolution_note || 'Resolved without a note.'}</p>
                      <time dateTime={report.resolved_at}>{formatDate(report.resolved_at)}</time>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
