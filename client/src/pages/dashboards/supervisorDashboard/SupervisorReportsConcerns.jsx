// Supervisor → "My Reports & Concerns".
//
// The supervisor is the REPORTER: they file concerns from this page, and the
// assigned teacher resolves them. The create form opens in a side modal; the
// history of what they filed stays on the page.
//
// Design system: Lexend + the maroon palette from TeacherReportsConcerns.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import {
  createSupervisorReportConcern,
  deleteSupervisorReportConcern,
  getSupervisorPartnerInstitutions,
  getSupervisorPartnerInstitutionStudents,
  getSupervisorReportsConcerns,
} from '../../../api/supervisorApi';
import { getStudentName } from '../../../components/shared/studentFields';
import styles from './SupervisorReportsConcerns.module.css';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_LABELS = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

const getPriorityKey = (priority) => (priority || '').toLowerCase();
const getPriorityBadgeClass = (priority) => `priority_${getPriorityKey(priority)}`;
const getBadgeClass = (status) => `badge_${(status || '').toLowerCase()}`;
const getPriorityLabel = (report) => PRIORITY_LABELS[getPriorityKey(report.priority)] || 'Normal';
const getConcernType = (report) => report.category || 'Uncategorized';

function sortByPriority(reports) {
  return [...reports].sort((a, b) => {
    const pa = PRIORITY_ORDER[getPriorityKey(a.priority)] ?? 99;
    const pb = PRIORITY_ORDER[getPriorityKey(b.priority)] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

function SupervisorReportsConcerns() {
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [notice, setNotice] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  // Create form state. The form itself lives in the side modal.
  const [formOpen, setFormOpen] = useState(false);
  const [institutionResult, setInstitutionResult] = useState({ loading: true, institutions: [] });
  const [studentRoster, setStudentRoster] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    institutionId: '',
    studentId: '',
    category: 'Concern',
    priority: 'normal',
    message: '',
  });

  const loadReports = useCallback(async () => {
    setHistoryError('');
    try {
      const data = await getSupervisorReportsConcerns();
      setReports(data.reports || []);
    } catch (err) {
      setHistoryError(err.message || 'Failed to load reports and concerns.');
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
    window.addEventListener('focus', loadReports);
    return () => window.removeEventListener('focus', loadReports);
  }, [loadReports]);

  const institutions = institutionResult.institutions;
  const assignedInstitution = institutions.length === 1 ? institutions[0] : null;
  const selectedInstitutionId = assignedInstitution ? String(assignedInstitution.id) : form.institutionId;

  useEffect(() => {
    let active = true;
    getSupervisorPartnerInstitutions().then(
      ({ institutions: assigned }) => { if (active) setInstitutionResult({ institutions: assigned || [] }); },
      (error) => { if (active) setInstitutionResult({ error: error.message, institutions: [] }); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!formOpen || !selectedInstitutionId) return;
    let active = true;
    getSupervisorPartnerInstitutionStudents(selectedInstitutionId).then(
      ({ students: assigned }) => {
        if (!active) return;
        const unique = new Map((assigned || []).map((student) => [student.student_id, student]));
        setStudentRoster({ institutionId: selectedInstitutionId, students: [...unique.values()] });
      },
      (error) => {
        if (active) setStudentRoster({ institutionId: selectedInstitutionId, students: [], error: error.message });
      },
    );
    return () => { active = false; };
  }, [formOpen, selectedInstitutionId]);

  // Escape closes the create modal.
  useEffect(() => {
    if (!formOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !submitting) setFormOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [formOpen, submitting]);

  const roster = studentRoster?.institutionId === selectedInstitutionId ? studentRoster : null;
  const students = roster?.students || [];
  const selectedStudent = students.find(({ student_id }) => String(student_id) === form.studentId);
  const sortedReports = useMemo(() => sortByPriority(reports), [reports]);

  const openForm = () => {
    setStudentRoster(null);
    setFormError('');
    setFormOpen(true);
  };

  const toggleExpanded = (reportId) => {
    setExpandedId((current) => (current === reportId ? null : reportId));
  };

  const submitReport = async (event) => {
    event.preventDefault();
    if (!selectedStudent || !form.message.trim() || submitting) return;

    setSubmitting(true);
    setFormError('');
    try {
      await createSupervisorReportConcern({
        student_id: selectedStudent.student_id,
        partner_institution_id: Number(selectedInstitutionId),
        category: form.category,
        priority: form.priority,
        message: form.message.trim(),
      });
      setForm((current) => ({ ...current, studentId: '', message: '' }));
      setFormOpen(false);
      setNotice({ type: 'success', text: 'Report submitted to the assigned teacher.' });
      await loadReports();
    } catch (err) {
      setFormError(err.message || 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  // The supervisor owns what they filed, so they can withdraw a report.
  const handleDelete = async (reportId) => {
    if (deletingId) return;
    setDeletingId(reportId);
    setHistoryError('');
    try {
      await deleteSupervisorReportConcern(reportId);
      setReports((current) => current.filter((report) => report.id !== reportId));
    } catch (err) {
      setHistoryError(err.message || 'Failed to delete report.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>My Reports &amp; Concerns</h1>
          <p>File concerns for students at your partner institutions and track the assigned teacher’s response.</p>
        </div>
      </header>

      {notice && <div className={`${styles.notice} ${styles['notice_' + notice.type]}`} role="status">{notice.text}</div>}

      {historyError && <p className={styles.formError} role="alert">{historyError}</p>}

      <section className={styles.historySection}>
        <h3 className={styles.formTitle}>Reports &amp; Concerns You Created</h3>

        {loadingReports ? <p className={styles.empty} role="status">Loading reports and concerns…</p> :
          sortedReports.length === 0 ? (
          !historyError && <p className={styles.empty}>You have not filed any reports or concerns yet.</p>
        ) : (
          <div className={styles.concernList}>
            {sortedReports.map((report) => {
              const priorityLevel = getPriorityKey(report.priority);
              const itemClass = priorityLevel === 'urgent'
                ? styles.itemUrgent
                : priorityLevel === 'high'
                  ? styles.itemHigh
                  : '';
              const isExpanded = expandedId === report.id;

              return (
                <div
                  key={report.id}
                  className={`${styles.card} ${itemClass} ${isExpanded ? styles.cardExpanded : ''}`}
                >
                  <div
                    className={styles.cardTop}
                    onClick={() => toggleExpanded(report.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleExpanded(report.id);
                      }
                    }}
                  >
                    <div className={styles.studentInfo}>
                      <strong className={styles.studentName}>
                        {report.first_name} {report.last_name}
                      </strong>
                      <span className={styles.meta}>
                        {report.partner_institution_name && <>
                          <span>{report.partner_institution_name}</span>
                          <span className={styles.metaDot} aria-hidden="true">·</span>
                        </>}
                        <span>{getConcernType(report)}</span>
                        <span className={styles.metaDot} aria-hidden="true">·</span>
                        <span>{formatDate(report.created_at)}</span>
                      </span>
                    </div>

                    <div className={styles.cardTags}>
                      <span className={`${styles.priority} ${styles[getPriorityBadgeClass(report.priority)]}`}>
                        {getPriorityLabel(report)}
                      </span>
                      <span className={`${styles.badge} ${styles[getBadgeClass(report.status)]}`}>
                        {report.status}
                      </span>
                      <ChevronDown
                        size={16}
                        className={`${styles.expandIcon} ${isExpanded ? styles.expandIconOpen : ''}`}
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className={styles.cardDetails}>
                      <div className={styles.detailGrid}>
                        <div className={styles.detailItem}>
                          <span className={styles.detailLabel}>Partner institution</span>
                          {report.partner_institution_name || report.batch_label || 'Unavailable'}
                        </div>
                        <div className={styles.detailItem}>
                          <span className={styles.detailLabel}>Student ID</span>
                          {report.student_number || 'No ID'}
                        </div>
                        <div className={styles.detailItem}>
                          <span className={styles.detailLabel}>Concern type</span>
                          {getConcernType(report)}
                        </div>
                        <div className={styles.detailItem}>
                          <span className={styles.detailLabel}>Priority</span>
                          {getPriorityLabel(report)}
                        </div>
                        <div className={styles.detailItem}>
                          <span className={styles.detailLabel}>Status</span>
                          {report.status}
                        </div>
                        <div className={styles.detailItem}>
                          <span className={styles.detailLabel}>Reported on</span>
                          {formatDate(report.created_at)}
                        </div>
                      </div>

                      {report.message && (
                        <div className={styles.messageBox}>
                          <span className={styles.detailLabel}>Details</span>
                          <p className={styles.cardMessage}>{report.message}</p>
                        </div>
                      )}

                      <div className={styles.historyActions}>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(report.id)}
                          disabled={deletingId === report.id}
                        >
                          <Trash2 size={14} />
                          {deletingId === report.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.newReportBar}>
          <button type="button" className={styles.confirmBtn} aria-haspopup="dialog" onClick={openForm}>
            <Plus size={14} />
            Create Report or Concern
          </button>
        </div>
      </section>

      {/* Create report modal */}
      {formOpen && (
        <div
          className={styles.drawerOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (!submitting && event.target === event.currentTarget) setFormOpen(false);
          }}
        >
          <aside
            className={styles.halfDrawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-report-title"
          >
            <div className={styles.drawerHeader}>
              <div>
                <span className={styles.drawerEyebrow}>NEW REPORT</span>
                <h3 id="new-report-title">Create Report or Concern</h3>
                <p>{assignedInstitution ? assignedInstitution.name : 'The report goes to the student’s assigned teacher.'}</p>
              </div>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => setFormOpen(false)}
                disabled={submitting}
                aria-label="Close report form"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.drawerBody}>
              <form className={styles.reportForm} onSubmit={submitReport}>
                {(formError || institutionResult.error || roster?.error) &&
                  <p className={styles.formError} role="alert">{formError || institutionResult.error || roster?.error}</p>}
                {institutionResult.loading && <p role="status">Loading assigned partner institutions…</p>}
                {!institutionResult.loading && !institutionResult.error && institutions.length === 0 &&
                  <p>No assigned partner institutions.</p>}

                <div className={styles.reportFields}>
                  {institutions.length > 1 && <label>
                    Partner institution
                    <select value={selectedInstitutionId} disabled={submitting} required
                      onChange={(event) => {
                        setStudentRoster(null);
                        setFormError('');
                        setForm((current) => ({ ...current, institutionId: event.target.value, studentId: '' }));
                      }}>
                      <option value="" disabled>Select an institution</option>
                      {institutions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </label>}
                  <label>
                    Student
                    <select
                      value={form.studentId}
                      onChange={(event) => setForm((current) => ({ ...current, studentId: event.target.value }))}
                      disabled={submitting || !students.length}
                      required
                    >
                      <option value="">{selectedInstitutionId && !roster ? 'Loading students…' :
                        roster && !students.length ? 'No deployed students' : 'Select a student'}</option>
                      {students.map((student) => (
                        <option key={student.student_id} value={student.student_id}>
                          {getStudentName(student) || `Student ${student.student_id}`}
                          {student.student_number ? ` (${student.student_number})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Category
                    <select
                      value={form.category}
                      onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                    >
                      <option value="Concern">Concern</option>
                      <option value="Attendance">Attendance</option>
                      <option value="Performance">Performance</option>
                      <option value="Behavior">Behavior</option>
                      <option value="Safety">Safety</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>

                  <label>
                    Priority
                    <select
                      value={form.priority}
                      onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                </div>

                <label className={styles.reportMessage}>
                  Details
                  <textarea
                    rows={4}
                    value={form.message}
                    onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                    placeholder="Describe the problem or concern."
                    required
                  />
                </label>

                <div className={styles.reportActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setFormOpen(false)} disabled={submitting}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.confirmBtn}
                    disabled={submitting || !selectedStudent || !form.message.trim()}
                  >
                    {submitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export default SupervisorReportsConcerns;
