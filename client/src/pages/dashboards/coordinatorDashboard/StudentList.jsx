import { useEffect, useRef, useState } from 'react';
import {
  getCoordinatorProfile,
  getAllStudents,
  getStudentStrands,
  getArchivedStudents,
  createStudentAccountReport,
  resendStudentApprovalEmail,
  updateStudentEmail,
  restoreStudent,
  permanentDeleteStudent,
} from '../../../api/coordinatorApi';
import {
  Mail,
  MoreHorizontal,
  Search,
  Trash2,
  UserCheck,
  X,
  Archive,
  Flag,
} from 'lucide-react';
import styles from './StudentApprovals.module.css';

const getStatusLabel = (activityStatus, activityLabel) => {
  if (activityStatus === 'pending') return 'Pending Activation';
  return activityLabel || activityStatus || 'Unknown';
};

const getStatusBadge = (activityStatus) => {
  const map = {
    active: styles.badgeActive,
    idle: styles.badgeIdle,
    inactive: styles.badgeInactive,
    dormant: styles.badgeDormant,
    pending: styles.badgePending,
    approved: styles.badgeApproved,
    rejected: styles.badgeRejected,
    disapproved: styles.badgeRejected,
    'needs revision': styles.badgeNeeds,
  };
  return map[activityStatus] || styles.badgePending;
};

const getDeploymentBadge = (deploymentStatus) => {
  const map = {
    deployed: styles.badgeApproved,
    not_deployed: styles.badgeRejected,
  };
  return map[deploymentStatus] || styles.badgePending;
};

const getDeploymentLabel = (deploymentStatus) => {
  const map = {
    deployed: 'Deployed',
    not_deployed: 'Not Deployed',
  };
  return map[deploymentStatus] || 'Unknown';
};

const REPORT_REASONS = [
  { value: 'remove_account', label: 'Request account removal' },
  { value: 'duplicate_account', label: 'Duplicate account' },
  { value: 'incorrect_information', label: 'Incorrect student information' },
  { value: 'access_problem', label: 'Account access problem' },
  { value: 'other', label: 'Other concern' },
];

function StudentList() {
  const [students, setStudents] = useState([]);
  const [archivedStudents, setArchivedStudents] = useState([]);
  const [coordinator, setCoordinator] = useState(null);
  const [strands, setStrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingStrands, setLoadingStrands] = useState(true);
  const [strandFilter, setStrandFilter] = useState('all');
  const [requirementsFilter, setRequirementsFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [deploymentFilter, setDeploymentFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const loadRequestId = useRef(0);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [archivedModalOpen, setArchivedModalOpen] = useState(false);
  const [reportingStudent, setReportingStudent] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reportComments, setReportComments] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Tracks which student's Resend button is in flight, so only that row spins.
  const [resendingId, setResendingId] = useState(null);

  // Edit email modal state
  const [editingEmailId, setEditingEmailId] = useState(null);
  const [editEmailValue, setEditEmailValue] = useState('');
  const [updatingEmailId, setUpdatingEmailId] = useState(null);

  // Dropdown menu state
  const [openDropdownId, setOpenDropdownId] = useState(null);

  const load = async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError('');

    try {
      const [studentsData, archivedData] = await Promise.all([
        getAllStudents({
          strand: strandFilter,
          activity: activityFilter,
          search: searchTerm,
          requirementsCompleted: requirementsFilter,
          deploymentStatus: deploymentFilter,
        }),
        getArchivedStudents(),
      ]);
      if (requestId !== loadRequestId.current) return;
      setStudents(studentsData.students || []);
      setArchivedStudents(archivedData.students || []);
    } catch (err) {
      if (requestId === loadRequestId.current) {
        setError(err.message);
      }
    } finally {
      if (requestId === loadRequestId.current) {
        setLoading(false);
      }
    }
  };

  const loadStrands = async () => {
    try {
      const data = await getStudentStrands();
      setStrands(data.strands || []);
    } catch (err) {
      console.error('Failed to load strands:', err);
    } finally {
      setLoadingStrands(false);
    }
  };

  useEffect(() => {
    loadStrands();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCoordinatorProfile()
      .then((data) => {
        if (!cancelled) setCoordinator(data.coordinator || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load assigned limits.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strandFilter, requirementsFilter, activityFilter, deploymentFilter, searchTerm]);

  // Auto-dismiss the floating toast so it pops up and clears itself.
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openDropdownId && !event.target.closest(`.dropdown-menu-${openDropdownId}`) && !event.target.closest(`.dropdown-toggle-${openDropdownId}`)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdownId]);

  const handleResendEmail = async (studentId) => {
    setResendingId(studentId);
    setMessage('');
    setError('');
    try {
      const data = await resendStudentApprovalEmail(studentId);
      setMessage(data.message || 'Set-password email resent successfully.');
      if (data.emailSent === false) {
        setError('Email could not be sent. Please check the email configuration.');
      }
      load();
    } catch (err) {
      setError(err.message || 'Failed to resend email.');
    } finally {
      setResendingId(null);
    }
  };

  const handleEditEmail = (student) => {
    setEditingEmailId(student.id);
    setEditEmailValue(student.email);
  };

  const handleSaveEmail = async () => {
    if (!editingEmailId || !editEmailValue) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(editEmailValue)) {
      setError('Invalid email format.');
      return;
    }

    setUpdatingEmailId(editingEmailId);
    setError('');
    setMessage('');
    try {
      await updateStudentEmail(editingEmailId, editEmailValue);
      setMessage('Student email updated successfully.');
      setEditingEmailId(null);
      setEditEmailValue('');
      load();
    } catch (err) {
      setError(err.message || 'Failed to update email.');
    } finally {
      setUpdatingEmailId(null);
    }
  };

  const handleCancelEditEmail = () => {
    setEditingEmailId(null);
    setEditEmailValue('');
  };

  const handleOpenReport = (student) => {
    setReportingStudent(student);
    setReportReason('');
    setReportComments('');
    setError('');
  };

  const handleSubmitReport = async () => {
    if (!reportingStudent || !reportReason || !reportComments.trim()) {
      setError('Choose a reason and add comments before sending the report.');
      return;
    }

    setSubmittingReport(true);
    setError('');
    try {
      await createStudentAccountReport(reportingStudent.id, {
        reason: reportReason,
        comments: reportComments.trim(),
      });
      setMessage('Report sent to the admin team.');
      setReportingStudent(null);
    } catch (err) {
      setError(err.message || 'Failed to send report.');
    } finally {
      setSubmittingReport(false);
    }
  };


  const handleRestore = async (id) => {
    try {
      await restoreStudent(id);
      setMessage('Student restored.');
      load();
    } catch (err) {
      setError(err.message || 'Failed to restore student.');
    }
  };

  const handlePermanentDelete = async (id) => {
    try {
      await permanentDeleteStudent(id);
      setMessage('Student permanently deleted.');
      load();
    } catch (err) {
      setError(err.message || 'Failed to permanently delete student.');
    }
  };

  const filteredStudents = students.filter((student) => {
    if (activityFilter !== 'all' && student.activity_status !== activityFilter) {
      return false;
    }
    if (deploymentFilter !== 'all' && student.deployment_status !== deploymentFilter) {
      return false;
    }
    if (!searchTerm) return true;
    const fullName = `${student.first_name || ''} ${student.last_name || ''}`.toLowerCase();
    const email = (student.email || '').toLowerCase();
    const studentNumber = (student.student_number || '').toLowerCase();
    const search = searchTerm.toLowerCase();
    return fullName.includes(search) || email.includes(search) || studentNumber.includes(search);
  });

  const totalStudents = students.length;
  const activeCount = students.filter((s) => s.activity_status === 'active').length;
  const idleCount = students.filter((s) => s.activity_status === 'idle').length;
  const inactiveCount = students.filter((s) => s.activity_status === 'inactive').length;
  const dormantCount = students.filter((s) => s.activity_status === 'dormant').length;
  const pendingCount = students.filter((s) => s.activity_status === 'pending').length;
  const deployedCount = students.filter((s) => s.deployment_status === 'deployed').length;
  const completedCount = students.filter((s) => s.requirements_completed).length;

  return (
    <div className={styles.page}>
      <div className={styles.toastStack} role="region" aria-live="polite" aria-label="Notifications">
        {message && (
          <div className={`${styles.alert} ${styles.alertSuccess}`} role="alert">
            <span className={styles.alertIcon}>✓</span>
            {message}
            <button onClick={() => setMessage('')} aria-label="Dismiss">×</button>
          </div>
        )}
        {error && (
          <div className={`${styles.alert} ${styles.alertError}`} role="alert">
            <span className={styles.alertIcon}>✕</span>
            {error}
            <button onClick={() => setError('')} aria-label="Dismiss">×</button>
          </div>
        )}
      </div>

      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Work Immersion</span>
          <h1>Student List</h1>
        </div>
        <div className={styles.headerIcon} aria-hidden="true">
          <span>👥</span>
        </div>
      </header>

      {coordinator && (
        <div className={styles.limitBannerInline}>
          <span className={styles.limitBannerLabel}>Your assigned limits</span>
          <span className={styles.limitBannerStrand}>
            <strong>Strand:</strong> {coordinator.strand || 'All Strands'}
          </span>
          <span className={styles.limitBannerCount}>
            <strong>Students:</strong> {coordinator.student_count} / {coordinator.student_limit}
          </span>
        </div>
      )}

      {/* Summary Stats */}
      <div className={styles.limitBanner}>
        <div className={styles.limitBannerContent}>
          <span className={styles.limitBannerLabel}>Student Summary</span>
          <div className={styles.limitBannerStrand}><span>Total:</span> <strong>{totalStudents}</strong></div>
          <div className={styles.limitBannerCount}><span>Deployed:</span> <strong>{deployedCount}</strong></div>
          <div className={styles.limitBannerCount}><span>Completed:</span> <strong>{completedCount}</strong></div>
          <div className={styles.limitBannerCount}><span>Pending:</span> <strong>{pendingCount}</strong></div>
          <div className={styles.limitBannerCount}><span>Active:</span> <strong>{activeCount}</strong></div>
          <div className={styles.limitBannerCount}><span>Idle:</span> <strong>{idleCount}</strong></div>
          <div className={styles.limitBannerCount}><span>Inactive:</span> <strong>{inactiveCount}</strong></div>
          <div className={styles.limitBannerCount}><span>Dormant:</span> <strong>{dormantCount}</strong></div>
        </div>
      </div>

      <section className={styles.studentsCard}>
        <div className={styles.studentsHeader}>
          <h3>All Students</h3>

          <div className={styles.searchBox}>
            <Search className={styles.searchIcon} size={18} aria-hidden="true" />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by name, email, or student ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className={styles.searchClear} onClick={() => setSearchTerm('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>

          <div className={styles.filterGroup}>
            <span className={`${styles.filterLabel} ${styles.filterLabelNoIcon}`}>
              Strand
            </span>
            <select
              className={styles.filterSelect}
              value={strandFilter}
              onChange={(e) => setStrandFilter(e.target.value)}
              disabled={loadingStrands}
            >
              <option value="all">All Strands</option>
              {strands.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className={styles.filterGroup}>
            <span className={`${styles.filterLabel} ${styles.filterLabelNoIcon}`}>
              Requirements Completed
            </span>
            <select
              className={styles.filterSelect}
              value={requirementsFilter}
              onChange={(e) => setRequirementsFilter(e.target.value)}
              aria-label="Filter by requirements completion"
            >
              <option value="all">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <span className={`${styles.filterLabel} ${styles.filterLabelNoIcon}`}>
              Activity
            </span>
            <select
              className={styles.filterSelect}
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
            >
              <option value="all">All Activity</option>
              <option value="active">Active</option>
              <option value="idle">Idle</option>
              <option value="inactive">Inactive</option>
              <option value="dormant">Dormant</option>
              <option value="pending">Pending Activation</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <span className={`${styles.filterLabel} ${styles.filterLabelNoIcon}`}>
              Deployment Status
            </span>
            <select
              className={styles.filterSelect}
              value={deploymentFilter}
              onChange={(e) => setDeploymentFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="deployed">Deployed</option>
              <option value="not_deployed">Not Deployed</option>
            </select>
          </div>
        </div>

        <div className={`${styles.tableContainer} ${styles.studentListTableContainer}`}>
          {loading ? (
            <div className={styles.loading}>
              <span className={styles.spinnerDark}></span>
              <p>Loading students…</p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>👥</div>
              <h4>No students found</h4>
              <p>Try adjusting your filters or search term.</p>
            </div>
          ) : (
            <table className={`${styles.table} ${styles.studentListTable}`}>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Email</th>
                  <th>Student ID</th>
                  <th>Strand</th>
                  <th>Requirements Completed</th>
                  <th>Activity Status</th>
                  <th>Deployment Status</th>
                  <th>Date Created</th>
                  <th className={styles.actionHeader}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <tr key={student.id}>
                    <td data-label="Student">
                      <div className={styles.studentCell}>
                        <UserCheck size={32} color="var(--about-maroon)" aria-hidden="true" />
                        <div>
                          <strong>{student.first_name} {student.last_name}</strong>
                          {student.grade_level && <span>Grade {student.grade_level}</span>}
                          {student.section && <span>Section {student.section}</span>}
                        </div>
                      </div>
                    </td>
                    <td className={styles.email} data-label="Email">{student.email}</td>
                    <td className={styles.studentId} data-label="Student ID">{student.student_number}</td>
                    <td className={styles.trackStrand} data-label="Strand">{student.track_strand || '—'}</td>
                    <td data-label="Requirements Completed">
                      <span className={`${styles.badge} ${student.requirements_completed ? styles.badgeApproved : styles.badgePending}`}>
                        <span className={styles.statusDot} />
                        {student.requirements_completed ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td data-label="Activity Status">
                      <span className={`${styles.badge} ${getStatusBadge(student.activity_status)}`}>
                        <span className={styles.statusDot} />
                        {getStatusLabel(student.activity_status, student.activity_label)}
                        {student.days_since_login !== null && (
                          <span className={styles.daysSinceLogin}>{student.days_since_login}d ago</span>
                        )}
                      </span>
                    </td>
                    <td data-label="Deployment Status">
                      <span className={`${styles.badge} ${getDeploymentBadge(student.deployment_status)}`}>
                        {getDeploymentLabel(student.deployment_status)}
                      </span>
                    </td>
                    <td className={styles.registeredDate} data-label="Date Created">
                      {new Date(student.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className={styles.actions} data-label="Actions">
                      <div className={styles.dropdownContainer}>
                        <button
                          className={`${styles.dropdownToggle} dropdown-toggle-${student.id}`}
                          onClick={() => setOpenDropdownId(openDropdownId === student.id ? null : student.id)}
                          aria-label="More actions"
                          title="More actions"
                        >
                          <MoreHorizontal size={18} />
                        </button>
                        {openDropdownId === student.id && (
                          <div className={`${styles.dropdownMenu} dropdown-menu-${student.id}`} role="menu">
                            {student.activity_status !== 'active' && (
                              <>
                                {student.needs_password_setup && (
                                  <button
                                    className={styles.dropdownItem}
                                    onClick={() => { handleResendEmail(student.id); setOpenDropdownId(null); }}
                                    disabled={resendingId === student.id}
                                    role="menuitem"
                                  >
                                    <Mail size={14} />
                                    {student.status === 'pending_activation'
                                      ? 'Resend temporary credentials'
                                      : 'Resend set-password email'}
                                  </button>
                                )}
                                <button
                                  className={styles.dropdownItem}
                                  onClick={() => { handleEditEmail(student); setOpenDropdownId(null); }}
                                  disabled={updatingEmailId === student.id}
                                  role="menuitem"
                                >
                                  <Mail size={14} /> Edit email
                                </button>
                              </>
                            )}
                            <button
                              className={styles.dropdownItem}
                              onClick={() => { handleOpenReport(student); setOpenDropdownId(null); }}
                              role="menuitem"
                            >
                              <Flag size={14} /> Report account issue
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Archived Students Modal */}
      <button
        className={styles.archiveToggleBtn}
        onClick={() => setArchivedModalOpen(true)}
        aria-label="View archived students"
        title="Archived Students"
      >
        <Archive size={20} />
      </button>

      <div className={`${styles.modalOverlay} ${archivedModalOpen ? styles.modalOpen : ''}`} onClick={() => setArchivedModalOpen(false)} role="dialog" aria-modal="true" aria-labelledby="archived-title">
        <div className={styles.archivedModal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 id="archived-title">Archived Students</h2>
            <button className={styles.modalCloseBtn} onClick={() => setArchivedModalOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className={styles.modalBody}>
            <div className={styles.tableContainer} style={{ maxHeight: '50vh' }}>
              {archivedStudents.length === 0 ? (
                <div className={styles.empty} style={{ minHeight: '200px' }}>
                  <div className={styles.emptyIcon}>📦</div>
                  <h4>No archived students</h4>
                  <p>Archived students will appear here.</p>
                </div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Student ID</th>
                      <th>Strand</th>
                      <th>Archived At</th>
                      <th className={styles.actionHeader}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archivedStudents.map((student) => (
                      <tr key={student.id}>
                        <td>
                          <div className={styles.studentCell}>
                            <UserCheck size={32} color="var(--about-muted)" aria-hidden="true" />
                            <div>
                              <strong>{student.first_name} {student.last_name}</strong>
                            </div>
                          </div>
                        </td>
                        <td className={styles.email}>{student.email}</td>
                        <td className={styles.studentId}>{student.student_number}</td>
                        <td className={styles.trackStrand}>{student.track_strand || '—'}</td>
                        <td className={styles.registeredDate}>
                          {student.archived_at ? new Date(student.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td className={styles.actions}>
                          <div className={styles.actions}>
                            <button
                              className={styles.approveBtn}
                              onClick={() => handleRestore(student.id)}
                              title="Restore"
                              aria-label="Restore student"
                            >
                              <Archive size={15} />
                            </button>
                            <button
                              className={styles.deleteBtn}
                              onClick={() => handlePermanentDelete(student.id)}
                              title="Delete permanently"
                              aria-label="Delete student permanently"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Email Modal */}
      {editingEmailId && (
        <div className={`${styles.editEmailOverlay}`} onClick={handleCancelEditEmail} role="dialog" aria-modal="true" aria-labelledby="edit-email-title">
          <div className={styles.editEmailModal} onClick={(e) => e.stopPropagation()}>
            <h2 id="edit-email-title">Edit Student Email</h2>
            <input
              type="email"
              className={styles.editEmailInput}
              value={editEmailValue}
              onChange={(e) => setEditEmailValue(e.target.value)}
              placeholder="Enter new email address"
              autoFocus
            />
            <div className={styles.editEmailActions}>
              <button
                className={styles.editEmailCancelBtn}
                onClick={handleCancelEditEmail}
                disabled={updatingEmailId}
              >
                Cancel
              </button>
              <button
                className={styles.editEmailSaveBtn}
                onClick={handleSaveEmail}
                disabled={updatingEmailId}
              >
                {updatingEmailId ? <span className={styles.spinnerDark} /> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reportingStudent && (
        <div
          className={styles.editEmailOverlay}
          onClick={() => !submittingReport && setReportingStudent(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-report-title"
        >
          <div className={styles.editEmailModal} onClick={(e) => e.stopPropagation()}>
            <h2 id="student-report-title">Report student account issue</h2>
            <p>
              The admin team will review this report. An account will only be archived after an admin reviews a removal request.
            </p>
            <label htmlFor="student-report-reason">Reason</label>
            <select
              id="student-report-reason"
              className={styles.editEmailInput}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              required
            >
              <option value="">Select a reason</option>
              {REPORT_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
            <label htmlFor="student-report-comments">Comments</label>
            <textarea
              id="student-report-comments"
              className={styles.editEmailInput}
              value={reportComments}
              onChange={(e) => setReportComments(e.target.value)}
              placeholder="Explain the issue for the admin team..."
              maxLength={2000}
              rows={5}
              required
            />
            <div className={styles.editEmailActions}>
              <button
                className={styles.editEmailCancelBtn}
                onClick={() => setReportingStudent(null)}
                disabled={submittingReport}
              >
                Cancel
              </button>
              <button
                className={styles.editEmailSaveBtn}
                onClick={handleSubmitReport}
                disabled={submittingReport}
              >
                {submittingReport ? <span className={styles.spinnerDark} /> : 'Send report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentList;