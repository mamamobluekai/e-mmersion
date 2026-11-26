import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addSupportReportReply,
  getSupportReport,
  getSupportReportStats,
  getSupportReports,
  updateSupportReport,
} from '../../../api/adminApi';
import {
  ChevronRight,
  FileImage,
  X,
} from 'lucide-react';
import styles from './SupportManagement.module.css';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const ROLE_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: 'student', label: 'Student' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'admin', label: 'Admin' },
];

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  { value: 'Login or Account Access', label: 'Login or Account Access' },
  { value: 'Forgot Password / Password Reset', label: 'Forgot Password / Password Reset' },
  { value: 'Technical Issue or System Error', label: 'Technical Issue or System Error' },
  { value: 'Page Not Loading', label: 'Page Not Loading' },
  { value: 'Incorrect or Missing Information', label: 'Incorrect or Missing Information' },
  { value: 'Feature Not Working Properly', label: 'Feature Not Working Properly' },
  { value: 'Account Information Concern', label: 'Account Information Concern' },
  { value: 'General Inquiry', label: 'General Inquiry' },
  { value: 'Complaint or Feedback', label: 'Complaint or Feedback' },
  { value: 'Other', label: 'Other' },
];

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All Priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const STATUS_COLORS = {
  pending: '#b45309',
  in_progress: '#2563eb',
  resolved: '#166534',
  closed: '#4b5563',
};

const PRIORITY_COLORS = {
  low: '#6b7280',
  medium: '#2563eb',
  high: '#b45309',
  critical: '#dc2626',
};

const ROLE_LABELS = {
  student: 'Student',
  teacher: 'Teacher',
  supervisor: 'Supervisor',
  coordinator: 'Coordinator',
  admin: 'Admin',
};

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

function formatDateShort(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

export default function SupportManagement() {
  const [filters, setFilters] = useState({
    status: 'all',
    role: 'all',
    category: 'all',
    priority: 'all',
    search: '',
    dateFrom: '',
    dateTo: '',
    sort: 'newest',
  });
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, pages: 0 });
  const [stats, setStats] = useState({ total: 0, pending: 0, in_progress: 0, resolved: 0, closed: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [detailDialog, setDetailDialog] = useState(false);
  const detailDialogRef = useRef(null);
  const [currentReport, setCurrentReport] = useState(null);
  const [reportReplies, setReportReplies] = useState([]);
  const [reportActivity, setReportActivity] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [isInternalReply, setIsInternalReply] = useState(false);
  const [statusValue, setStatusValue] = useState('');
  const [priorityValue, setPriorityValue] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSupportReports({
        status: filters.status,
        role: filters.role,
        category: filters.category,
        priority: filters.priority,
        search: filters.search,
        sort: filters.sort,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        page: String(page),
        limit: '20',
      });
      setReports(data.reports || []);
      setPagination(data.pagination || { total: 0, page: 1, limit: 20, pages: 0 });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    fetchReports();
    fetchStats();
  }, [fetchReports]);

  async function fetchStats() {
    try {
      const data = await getSupportReportStats();
      setStats(data);
    } catch {
      // stats are non-fatal, don't block report list
    }
  }

  function setFilter(key, value) {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function openReport(reportId) {
    setDetailDialog(true);
    setDetailLoading(true);
    setUpdateError('');
    setReplyError('');
    setReplyMessage('');
    setIsInternalReply(false);
    setStatusValue('');
    setPriorityValue('');
    setAssignedTo('');

    try {
      const data = await getSupportReport(reportId);
      setCurrentReport(data.report || null);
      setReportReplies(data.replies || []);
      setReportActivity(data.activity || []);
      if (data.report) {
        setStatusValue(data.report.status);
        setPriorityValue(data.report.priority);
        setAssignedTo(String(data.report.assigned_to || ''));
      }
    } catch (err) {
      setUpdateError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    detailDialogRef.current.close();
    setDetailDialog(false);
    setCurrentReport(null);
    setReportReplies([]);
    setReportActivity([]);
  }

  useEffect(() => {
    if (!detailDialogRef.current) return;
    if (detailDialog) detailDialogRef.current.showModal();
    else detailDialogRef.current.close();
  }, [detailDialog]);

  async function handleUpdate() {
    setUpdateError('');
    const body = {};
    if (statusValue !== currentReport?.status) body.status = statusValue;
    if (priorityValue !== currentReport?.priority) body.priority = priorityValue;
    if (assignedTo !== String(currentReport?.assigned_to || '')) {
      body.assigned_to = assignedTo ? Number(assignedTo) : null;
    }
    if (Object.keys(body).length === 0) return;

    setUpdateBusy(true);
    try {
      await updateSupportReport(currentReport.id, body);
      fetchReports();
      fetchStats();
      openReport(currentReport.id);
    } catch (err) {
      setUpdateError(err.message);
    } finally {
      setUpdateBusy(false);
    }
  }

  async function handleReply() {
    setReplyError('');
    if (!replyMessage.trim()) return;
    setReplyBusy(true);
    try {
      await addSupportReportReply(currentReport.id, {
        message: replyMessage.trim(),
        is_internal: isInternalReply,
      });
      setReplyMessage('');
      setIsInternalReply(false);
      openReport(currentReport.id);
    } catch (err) {
      setReplyError(err.message);
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Support Management</h1>
          <p>View and manage reports and concerns submitted by students, teachers, supervisors, and coordinators.</p>
        </div>
      </header>

      {error && <p className={styles.errorMsg} role="alert">{error}</p>}

      <section className={styles.statsRow}>
        <div className={styles.statCard} onClick={() => setFilter('status', 'pending')}>
          <div className={styles.statValue}>{stats.pending}</div>
          <div className={styles.statLabel}>Pending</div>
        </div>
        <div className={styles.statCard} onClick={() => setFilter('status', 'in_progress')}>
          <div className={styles.statValue}>{stats.in_progress}</div>
          <div className={styles.statLabel}>In Progress</div>
        </div>
        <div className={styles.statCard} onClick={() => setFilter('status', 'resolved')}>
          <div className={styles.statValue}>{stats.resolved}</div>
          <div className={styles.statLabel}>Resolved</div>
        </div>
        <div className={styles.statCard} onClick={() => setFilter('status', 'closed')}>
          <div className={styles.statValue}>{stats.closed}</div>
          <div className={styles.statLabel}>Closed</div>
        </div>
        <div className={styles.statCard} onClick={() => setFilter('status', 'all')}>
          <div className={styles.statValue}>{stats.total}</div>
          <div className={styles.statLabel}>Total Reports</div>
        </div>
      </section>

      <section className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Search</label>
          <input
            className={styles.filterInput}
            placeholder="Reference ID, role ID, subject, or name"
            value={filters.search}
            onChange={(event) => setFilter('search', event.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Role</label>
          <select className={styles.filterSelect} value={filters.role} onChange={(event) => setFilter('role', event.target.value)}>
            {ROLE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Category</label>
          <select className={styles.filterSelect} value={filters.category} onChange={(event) => setFilter('category', event.target.value)}>
            {CATEGORY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Status</label>
          <select className={styles.filterSelect} value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
            {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Priority</label>
          <select className={styles.filterSelect} value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)}>
            {PRIORITY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Date From</label>
          <input className={styles.filterInput} type="date" value={filters.dateFrom} onChange={(event) => setFilter('dateFrom', event.target.value)} />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Date To</label>
          <input className={styles.filterInput} type="date" value={filters.dateTo} onChange={(event) => setFilter('dateTo', event.target.value)} />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Sort</label>
          <select className={styles.filterSelect} value={filters.sort} onChange={(event) => setFilter('sort', event.target.value)}>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </section>

      <section className={styles.tableSection}>
        <div className={styles.tableWrap}>
          {loading ? (
            <p className={styles.loadingMsg}>Loading reports…</p>
          ) : reports.length === 0 ? (
            <p className={styles.emptyMsg}>No reports found.</p>
          ) : (
            <table className={styles.reportTable}>
              <thead>
                <tr>
                  <th>Reference ID</th>
                  <th>Subject</th>
                  <th>Category</th>
                  <th>Submitted By</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Role ID</th>
                  <th>Date Submitted</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id} className={styles.reportRow}>
                    <td className={styles.refCell}>
                      <span className={styles.refId}>{report.reference_id}</span>
                    </td>
                    <td className={styles.subjectCell}>{report.subject}</td>
                    <td className={styles.catCell}>{report.category}{report.category_other ? ` (${report.category_other})` : ''}</td>
                    <td className={styles.nameCell}>{report.submitted_name}</td>
                    <td className={styles.emailCell}>{report.submitted_email}</td>
                    <td className={styles.roleCell}>{ROLE_LABELS[report.role] || report.role}</td>
                    <td className={styles.roleIdCell}>{report.submitted_role_id || '—'}</td>
                    <td className={styles.dateCell}>{formatDateShort(report.created_at)}</td>
                    <td className={styles.priorityCell}>
                      <span className={styles.priorityBadge} style={{ color: PRIORITY_COLORS[report.priority] || '#6b7280' }}>
                        {report.priority.charAt(0).toUpperCase() + report.priority.slice(1)}
                      </span>
                    </td>
                    <td className={styles.statusCell}>
                      <span className={styles.statusBadge} style={{ color: STATUS_COLORS[report.status] || '#4b5563' }}>
                        {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
                      </span>
                    </td>
                    <td className={styles.actionCell}>
                      <button className={styles.viewBtn} type="button" onClick={() => openReport(report.id)}>
                        View Details <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {pagination.pages > 1 && (
          <div className={styles.pagination}>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button
              className={styles.pageBtn}
              disabled={page <= 1 || loading}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className={styles.pageBtn}
              disabled={page >= pagination.pages || loading}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>

      {detailDialog && (
        <dialog
          className={styles.detailDialog}
          ref={detailDialogRef}
          onCancel={(event) => { event.preventDefault(); closeDetail(); }}
        >
          <div className={styles.detailOverlay} onClick={closeDetail} />
          <div className={styles.detailModal} onClick={(event) => event.stopPropagation()}>
            <header className={styles.detailHeader}>
              <div>
                <h2>Report Details</h2>
                <p className={styles.detailRef}>Reference: {currentReport?.reference_id}</p>
              </div>
              <button className={styles.detailCloseBtn} type="button" aria-label="Close" onClick={closeDetail}>
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            {detailLoading ? (
              <p className={styles.loadingMsg}>Loading report details…</p>
            ) : currentReport ? (
              <>
                <section className={styles.detailSection}>
                  <h3>Report Information</h3>
                  <dl className={styles.detailGrid}>
                    <div>
                      <dt>Subject</dt>
                      <dd>{currentReport.subject}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>
                        {currentReport.category}
                        {currentReport.category_other ? ` (${currentReport.category_other})` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Submitted By</dt>
                      <dd>{currentReport.submitted_name}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{currentReport.submitted_email}</dd>
                    </div>
                    <div>
                      <dt>Role</dt>
                      <dd>{ROLE_LABELS[currentReport.role] || currentReport.role}</dd>
                    </div>
                    <div>
                      <dt>Role ID</dt>
                      <dd>{currentReport.submitted_role_id || '—'}</dd>
                    </div>
                    <div>
                      <dt>Date Submitted</dt>
                      <dd>{formatDate(currentReport.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Priority</dt>
                      <dd>
                        <span className={styles.priorityBadge} style={{ color: PRIORITY_COLORS[currentReport.priority] || '#6b7280' }}>
                          {currentReport.priority.charAt(0).toUpperCase() + currentReport.priority.slice(1)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span className={styles.statusBadge} style={{ color: STATUS_COLORS[currentReport.status] || '#4b5563' }}>
                          {currentReport.status.charAt(0).toUpperCase() + currentReport.status.slice(1)}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className={styles.detailSection}>
                  <h3>Description</h3>
                  <p className={styles.detailDesc}>{currentReport.description}</p>
                </section>

                {currentReport.attachment_url && (
                  <section className={styles.detailSection}>
                    <h3>Attachment</h3>
                    <div className={styles.attachItem}>
                      <FileImage size={20} className={styles.attachIcon} />
                      <a
                        href={currentReport.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.attachLink}
                      >
                        {currentReport.attachment_name || 'Attachment'}
                      </a>
                    </div>
                  </section>
                )}

                <section className={styles.detailSection}>
                  <h3>Manage Report</h3>
                  {updateError && <p className={styles.errorMsg} role="alert">{updateError}</p>}
                  <form className={styles.manageForm} onSubmit={(event) => { event.preventDefault(); handleUpdate(); }}>
                    <div className={styles.formRow}>
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Status</label>
                        <select
                          className={styles.formSelect}
                          value={statusValue}
                          onChange={(event) => setStatusValue(event.target.value)}
                          disabled={updateBusy}
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      </div>
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Priority</label>
                        <select
                          className={styles.formSelect}
                          value={priorityValue}
                          onChange={(event) => setPriorityValue(event.target.value)}
                          disabled={updateBusy}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Assign To (Admin ID)</label>
                        <input
                          className={styles.formInput}
                          type="number"
                          value={assignedTo}
                          onChange={(event) => setAssignedTo(event.target.value)}
                          placeholder="e.g. 1"
                          disabled={updateBusy}
                        />
                      </div>
                    </div>
                    <button type="submit" className={styles.updateBtn} disabled={updateBusy}>
                      {updateBusy ? 'Updating…' : 'Save Changes'}
                    </button>
                  </form>
                </section>

                <section className={styles.detailSection}>
                  <h3>Send Response</h3>
                  {replyError && <p className={styles.errorMsg} role="alert">{replyError}</p>}
                  <form className={styles.replyForm} onSubmit={(event) => { event.preventDefault(); handleReply(); }}>
                    <div className={styles.replyOptions}>
                      <label className={styles.replyOptionLabel}>
                        <input
                          type="checkbox"
                          checked={isInternalReply}
                          onChange={(event) => setIsInternalReply(event.target.checked)}
                          disabled={replyBusy}
                        />
                        Internal note (administrator only)
                      </label>
                    </div>
                    <textarea
                      className={styles.replyTextarea}
                      placeholder="Type your response or internal note…"
                      value={replyMessage}
                      onChange={(event) => setReplyMessage(event.target.value)}
                      disabled={replyBusy}
                      rows={3}
                    ></textarea>
                    <button type="submit" className={styles.replyBtn} disabled={replyBusy || !replyMessage.trim()}>
                      {replyBusy ? 'Sending…' : isInternalReply ? 'Add Internal Note' : 'Send Response'}
                    </button>
                  </form>
                </section>

                {reportReplies.length > 0 && (
                  <section className={styles.detailSection}>
                    <h3>Conversation History</h3>
                    <div className={styles.replyList}>
                      {reportReplies.map((reply) => (
                        <div key={reply.id} className={styles.replyItem}>
                          <div className={styles.replyMeta}>
                            <span className={styles.replySender}>
                              {reply.sender_type === 'admin' ? (reply.sender_name || 'Administrator') : 'System'}
                            </span>
                            <span className={styles.replyType}>
                              {reply.is_internal ? 'Internal Note' : 'Response'}
                            </span>
                            <span className={styles.replyTime}>{formatDate(reply.created_at)}</span>
                          </div>
                          <p className={styles.replyText}>{reply.message}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {reportActivity.length > 0 && (
                  <section className={styles.detailSection}>
                    <h3>Activity History</h3>
                    <div className={styles.activityList}>
                      {reportActivity.map((log) => (
                        <div key={log.id} className={styles.activityItem}>
                          <span className={styles.activityAction}>{log.action.replaceAll('_', ' ')}</span>
                          <span className={styles.activityField}>
                            {log.field && `${log.field}: `}
                            {log.old_value !== undefined && log.new_value !== undefined
                              ? `${log.old_value} → ${log.new_value}`
                              : log.new_value || ''}
                          </span>
                          <span className={styles.activityTime}>{formatDate(log.created_at)}</span>
                          <span className={styles.activityActor}>
                            {log.actor_type === 'admin' ? (log.actor_email || 'Administrator') : 'System'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <p className={styles.emptyMsg}>Report not found.</p>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
