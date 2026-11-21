import { useEffect, useState } from 'react';
import {
  getCoordinatorProfile,
  getPendingStudents,
  getStudentStrands,
  getArchivedStudents,
  approveStudent,
  resendStudentApprovalEmail,
  updateStudentEmail,
  deleteStudent,
  restoreStudent,
  permanentDeleteStudent,
  bulkArchiveStudents,
  bulkRestoreStudents,
  bulkPermanentDeleteStudents,
  uploadStudentsExcel,
} from '../../../api/coordinatorApi';
import {
  Check,
  CheckSquare,
  Mail,
  MoreHorizontal,
  Search,
  Square,
  Trash2,
  UserCheck,
  X,
  Archive,
} from 'lucide-react';
import ConfirmModal from '../../../components/admin/ConfirmModal';
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

function StudentApprovals() {
const [students, setStudents] = useState([]);
const [archivedStudents, setArchivedStudents] = useState([]);
const [coordinator, setCoordinator] = useState(null);
const [strands, setStrands] = useState([]);
const [loading, setLoading] = useState(true);
const [loadingStrands, setLoadingStrands] = useState(true);
  const [strandFilter, setStrandFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  // Delete confirmation state
const [deleteConfirmId, setDeleteConfirmId] = useState(null);
const [deleting, setDeleting] = useState(false);
const [archivedModalOpen, setArchivedModalOpen] = useState(false);

  // Bulk selection & actions
  const [selectedIds, setSelectedIds] = useState([]);
  const [archivedSelectedIds, setArchivedSelectedIds] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Tracks which student's Resend button is in flight, so only that row spins.
  const [resendingId, setResendingId] = useState(null);

  // Edit email modal state
  const [editingEmailId, setEditingEmailId] = useState(null);
  const [editEmailValue, setEditEmailValue] = useState('');
  const [updatingEmailId, setUpdatingEmailId] = useState(null);

  // Dropdown menu state
  const [openDropdownId, setOpenDropdownId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      const [studentsData, profileData, archivedData] = await Promise.all([
        getPendingStudents(strandFilter, activityFilter),
        getCoordinatorProfile(),
        getArchivedStudents(),
      ]);
      setStudents(studentsData.students || []);
      setCoordinator(profileData.coordinator || null);
      setArchivedStudents(archivedData.students || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadStrands = async () => {
    setLoadingStrands(true);
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
    setSelectedIds([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strandFilter, activityFilter]);

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

  const filteredStudents = students.filter((student) => {
    if (activityFilter !== 'all' && student.activity_status !== activityFilter) {
      return false;
    }
    if (!searchTerm) return true;
    const fullName = `${student.first_name || ''} ${student.last_name || ''}`.toLowerCase();
    const email = (student.email || '').toLowerCase();
    const studentNumber = (student.student_number || '').toLowerCase();
    const search = searchTerm.toLowerCase();
    return fullName.includes(search) || email.includes(search) || studentNumber.includes(search);
  });

  const handleUpload = async () => {
    if (!file) {
      setUploadResult({ kind: 'error', message: 'Please select an Excel file first.' });
      return;
    }

    setUploading(true);
    setUploadResult(null);
    setMessage('');
    setError('');

    try {
      const data = await uploadStudentsExcel(file);
      const r = data.results || {};

      setUploadResult({
        kind: r.failed ? 'warning' : 'success',
        message: data.message || 'Upload complete.',
      });
      setFile(null);

      await load();
    } catch (err) {
      setUploadResult({ kind: 'error', message: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      const data = await approveStudent(id);

      // A student who self-registered already has a password, so their approval mail
      // is a notice with no link. One added by Excel upload has none, so they get
      // a set-password link - which is why `linkSent` drives the wording.
      const emailFailed = data?.emailSent === false;
      setMessage(
        emailFailed
          ? 'Student approved, but the email failed to send. Use Resend email on their row.'
          : data?.message
            || (data?.linkSent
              ? 'Student approved. An email with their password setup link was sent.'
              : 'Student approved. They can now sign in with the password they registered with.'),
      );
      if (emailFailed) {
        setError(data.emailError || 'Approval email failed to send.');
      }

      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // Resends the appropriate activation message: temporary credentials for a
  // newly uploaded student, or a one-time set-password link for legacy accounts.
  const handleResendEmail = async (id) => {
    setResendingId(id);
    setError('');
    setMessage('');
    try {
      const data = await resendStudentApprovalEmail(id);
      if (data?.emailSent === false) {
        setError(data.emailError || 'The activation email failed to send. Please try again.');
      } else {
        setMessage(data?.message || 'Activation email sent.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setResendingId(null);
    }
  };

  const handleBulkResendEmail = async () => {
    if (selectedStudentsNeedingPasswordSetup.length === 0) return;

    setBulkLoading(true);
    setError('');
    setMessage('');
    let sentCount = 0;
    const failures = [];

    try {
      for (const student of selectedStudentsNeedingPasswordSetup) {
        try {
          const data = await resendStudentApprovalEmail(student.id);
          if (data?.emailSent === false) {
            failures.push(`${student.email}: ${data.emailError || data.message || 'Email failed to send.'}`);
          } else {
            sentCount += 1;
          }
        } catch (err) {
          failures.push(`${student.email}: ${err.message || 'Email failed to send.'}`);
        }
      }

      setSelectedIds([]);
      if (sentCount > 0) {
        setMessage(`Activation email sent to ${sentCount} student(s).`);
      }
      if (failures.length > 0) {
        const remainingFailures = failures.length > 1 ? ` (+${failures.length - 1} more)` : '';
        setError(`${failures[0]}${remainingFailures}`);
      }
    } finally {
      setBulkLoading(false);
    }
  };

  const handleEditEmail = (student) => {
    setEditingEmailId(student.id);
    setEditEmailValue(student.email || '');
  };

  const handleSaveEmail = async (id) => {
    const email = editEmailValue.trim();
    if (!email) {
      setError('Email is required.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Invalid email format.');
      return;
    }
    setUpdatingEmailId(id);
    setError('');
    setMessage('');
    try {
      const data = await updateStudentEmail(id, email);
      setMessage(data.message || 'Student email updated successfully.');
      setEditingEmailId(null);
      setEditEmailValue('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingEmailId(null);
    }
  };

  const handleCancelEditEmail = () => {
    setEditingEmailId(null);
    setEditEmailValue('');
  };

  const handleArchiveConfirm = (id) => {
    setDeleteConfirmId(id);
  };

  const handleArchive = async (id) => {
    setDeleting(true);
    try {
      await deleteStudent(id);
      setMessage('Student removed to archive.');
      setDeleteConfirmId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const handleRestore = async (id) => {
    setDeleting(true);
    setError('');
    setMessage('');
    try {
      await restoreStudent(id);
      setMessage('Student restored from archive.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handlePermanentDelete = async (id) => {
    setDeleting(true);
    setError('');
    setMessage('');
    try {
      await permanentDeleteStudent(id);
      setMessage('Student permanently deleted.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelArchive = () => {
    setDeleteConfirmId(null);
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredStudents.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredStudents.map((s) => s.id));
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : [...prev, id],
    );
  };

  const selectedStudentsNeedingPasswordSetup = students.filter(
    (student) => selectedIds.includes(student.id) && student.needs_password_setup,
  );

  const handleSelectAllArchived = () => {
    if (archivedSelectedIds.length === archivedStudents.length) {
      setArchivedSelectedIds([]);
    } else {
      setArchivedSelectedIds(archivedStudents.map((s) => s.id));
    }
  };

  const handleSelectOneArchived = (id) => {
    setArchivedSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : [...prev, id],
    );
  };

  const handleBulkArchive = async () => {
    if (selectedIds.length === 0) return;
    setDeleteConfirmId('bulk');
  };

  const handleBulkArchiveConfirm = async () => {
    setDeleting(true);
    setError('');
    setMessage('');
    try {
      const data = await bulkArchiveStudents(selectedIds);
      setMessage(data.message || `${selectedIds.length} student(s) removed to archive.`);
      setSelectedIds([]);
      setDeleteConfirmId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const handleBulkRestore = async () => {
    if (archivedSelectedIds.length === 0) return;
    setBulkLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await bulkRestoreStudents(archivedSelectedIds);
      setMessage(data.message || `${archivedSelectedIds.length} student(s) restored from archive.`);
      setArchivedSelectedIds([]);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkPermanentDelete = async () => {
    if (archivedSelectedIds.length === 0) return;
    setBulkLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await bulkPermanentDeleteStudents(archivedSelectedIds);
      setMessage(data.message || `${archivedSelectedIds.length} student(s) permanently deleted.`);
      setArchivedSelectedIds([]);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* HEADER */}
      <div className={styles.pageHeader}>
        <div>
          <h1>Student Approvals</h1>

          <p>
            Review accounts awaiting activation, approve student access, and manage uploaded
            student records. Students already deployed to a batch are moved out
            of this list and appear under Batches instead.
          </p>
        </div>
      </div>

      {/* TOASTS (floating – does not shift the layout) */}
      <div className={styles.toastStack} aria-live="polite">
        {message && (
          <div className={`${styles.alert} ${styles.alertSuccess}`} role="status">
            <span className={styles.alertIcon}>✓</span>
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage('')}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {error && (
          <div className={`${styles.alert} ${styles.alertError}`} role="alert">
            <span className={styles.alertIcon}>!</span>
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>

      {/* BULK UPLOAD */}
      <section className={styles.uploadCard}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Upload Students</h3>
            <p>
              Import multiple student accounts using an Excel spreadsheet.
            </p>
          </div>
        </div>

        <div className={styles.uploadContent}>
          <div className={styles.uploadBox}>
            <div className={styles.uploadSymbol}>↑</div>

            <div className={styles.uploadText}>
              <strong>
                {file ? file.name : 'Choose an Excel file'}
              </strong>

              <span>
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                  : 'Supported formats: .xlsx and .xls'}
              </span>
            </div>

            <label className={styles.chooseBtn}>
              Browse
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setUploadResult(null);
                }}
              />
            </label>
          </div>

          <button
            className={styles.uploadBtn}
            onClick={handleUpload}
            disabled={uploading || !file}
          >
            {uploading ? (
              <>
                <span className={styles.spinner}></span>
                Uploading...
              </>
            ) : (
              <>
                Upload Students
              </>
            )}
          </button>
        </div>

        <details className={styles.uploadExample}>
          <summary className={styles.uploadExampleHeader}>
            <strong>Excel format example</strong>
            <span>* Required column</span>
          </summary>
          <div className={styles.uploadExampleTableWrap}>
            <table className={styles.uploadExampleTable} aria-label="Example student upload spreadsheet">
              <thead>
                <tr>
                  <th data-required="true">Student ID</th>
                  <th data-required="true">First Name</th>
                  <th>Middle Name</th>
                  <th data-required="true">Last Name</th>
                  <th data-required="true">Email</th>
                  <th>Section</th>
                  <th>Strand</th>
                  <th>Contact Number</th>
                  <th>Gender</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>2026-001</td>
                  <td>Alex</td>
                  <td>Jordan</td>
                  <td>Reyes</td>
                  <td>alex.reyes@example.com</td>
                  <td>12-A</td>
                  <td>STEM</td>
                  <td>09123456789</td>
                  <td>Female</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>

      </section>

      {/* STUDENTS */}
      <section className={styles.studentsCard}>
        <div className={styles.studentsHeader}>

          <div className={styles.studentCount}>
            <strong>{filteredStudents.length}</strong>
            <span>Students</span>
          </div>

          <div className={styles.searchBox}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by name, email, or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search students"
            />
            {searchTerm && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearchTerm('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {coordinator && (
            <div className={styles.limitBannerInline}>
              <span className={styles.limitBannerLabel}>Your assigned limits</span>
              <span className={styles.limitBannerStrand}>
                <strong>Strand:</strong> {coordinator.strand ? coordinator.strand : 'All Strands'}
              </span>
              <span className={styles.limitBannerCount}>
                <strong>Students:</strong> {coordinator.student_count} / {coordinator.student_limit}
              </span>
              {coordinator.student_count >= coordinator.student_limit && (
                <span className={styles.limitBannerLimit}>
                  ⚠ Student limit reached — you cannot approve more students until
                  an admin raises your limit.
                </span>
              )}
            </div>
          )}

          <div className={`${styles.filterGroup} ${styles.filterStrand}`}>
            <label className={`${styles.filterLabel} ${styles.filterLabelNoIcon}`}>Strand</label>
            <select
              className={styles.filterSelect}
              value={strandFilter}
              onChange={(e) => setStrandFilter(e.target.value)}
              disabled={loadingStrands}
            >
              <option value="all">All Strands</option>
              {strands.map((strand) => (
                <option key={strand} value={strand}>
                  {strand}
                </option>
              ))}
            </select>
          </div>

          <div className={`${styles.filterGroup} ${styles.filterActivity}`}>
            <label className={`${styles.filterLabel} ${styles.filterLabelNoIcon}`}>Activity</label>
            <select
              className={styles.filterSelect}
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
            >
              <option value="all">All Activity</option>
              <option value="active">Active</option>
              <option value="idle">Idle (4-7 days)</option>
              <option value="inactive">Inactive (8-14 days)</option>
              <option value="dormant">Dormant (15+ days)</option>
              <option value="pending">Pending Activation</option>
            </select>
          </div>
        </div>

        {/* BULK ACTIONS */}
        {selectedIds.length > 0 && (
          <div className={styles.bulkBar}>
            <div className={styles.bulkActions}>
              <button
                className={styles.bulkApproveBtn}
                onClick={handleBulkResendEmail}
                disabled={bulkLoading || selectedStudentsNeedingPasswordSetup.length === 0}
                title="Resend activation emails to selected eligible students"
              >
                <Mail size={14} />
                Resend Activation Emails ({selectedStudentsNeedingPasswordSetup.length})
              </button>
              <button
                className={styles.bulkDeleteBtn}
                onClick={handleBulkArchive}
                disabled={bulkLoading}
              >
                <Trash2 size={14} />
                Remove Selected
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className={styles.loading}>
            <span className={styles.spinnerDark}></span>
            <p>Loading students...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>✓</div>

            <h4>No students found</h4>

            <p>
              No students match the current filter.
            </p>
          </div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.checkboxHeader}>
                    <button
                      className={styles.checkbox}
                      type="button"
                      onClick={handleSelectAll}
                      aria-label="Select all"
                    >
                      {selectedIds.length === filteredStudents.length &&
                      filteredStudents.length > 0 ? (
                        <CheckSquare size={16} />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </th>
                  <th>STUDENT</th>
                  <th>EMAIL</th>
                  <th>STUDENT ID</th>
                  <th>STRAND</th>
                  <th>STATUS</th>
                  <th>DATE CREATED</th>
                  <th className={styles.actionHeader}>ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {filteredStudents.map((student) => {
                  const fullName =
                    `${student.first_name || ''} ${student.last_name || ''}`.trim();

                   return (
                     <tr key={student.id}>
                       <td className={styles.checkboxCell}>
                         <button
                           className={styles.checkbox}
                           type="button"
                           onClick={() => handleSelectOne(student.id)}
                           aria-label={`Select ${student.first_name}`}
                         >
                           {selectedIds.includes(student.id) ? (
                             <CheckSquare size={16} />
                           ) : (
                             <Square size={16} />
                           )}
                         </button>
                       </td>

                       <td>
                         <div className={styles.studentCell}>
                           <div>
                             <strong>
                               {fullName || 'Unnamed Student'}
                             </strong>
                           </div>
                         </div>
                       </td>

                       <td>
                         <span className={styles.email}>
                           {student.email || '-'}
                         </span>
                       </td>

                       <td>
                         <span className={styles.studentId}>
                           {student.student_number || '-'}
                         </span>
                       </td>

<td>
                          <span className={styles.trackStrand}>
                            {student.track_strand || '-'}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`${styles.badge} ${getStatusBadge(student.activity_status)}`}
                          >
                            <span className={styles.statusDot}></span>
                            {getStatusLabel(student.activity_status, student.activity_label)}
                            {student.days_since_login !== null && student.days_since_login !== undefined && (
                              <span className={styles.daysSinceLogin}> ({student.days_since_login}d)</span>
                            )}
                          </span>
                        </td>

                        <td>
                        <span className={styles.registeredDate}>
                    {student.created_at
                      ? new Date(student.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                    </span>
                       </td>

                      <td>
                        <div className={styles.actions}>
                          {deleteConfirmId === student.id ? (
                            <div className={styles.deleteConfirm}>
                              <span>Remove this student?</span>
                              <div className={styles.deleteConfirmActions}>
                                <button
                                  className={styles.confirmDeleteBtn}
                                  onClick={() => handleArchive(student.id)}
                                  disabled={deleting}
                                  title="Confirm remove"
                                  aria-label="Confirm remove"
                                >
                                  {deleting ? (
                                    <span className={styles.spinnerDark}></span>
                                  ) : (
                                    <Check size={15} />
                                  )}
                                </button>
                                <button
                                  className={styles.cancelDeleteBtn}
                                  onClick={handleCancelArchive}
                                  disabled={deleting}
                                  title="Cancel remove"
                                  aria-label="Cancel remove"
                                >
                                  <X size={15} />
                                </button>
                              </div>
                            </div>
                          ) : (
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
                                  {student.status === 'pending' && (
                                    <button
                                      className={styles.dropdownItem}
                                      onClick={() => { handleApprove(student.id); setOpenDropdownId(null); }}
                                      role="menuitem"
                                    >
                                      <Check size={14} /> Approve
                                    </button>
                                  )}
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
                                    className={`${styles.dropdownItem} ${styles.dropdownItemDestructive}`}
                                    onClick={() => { handleArchiveConfirm(student.id); setOpenDropdownId(null); }}
                                    role="menuitem"
                                  >
                                    <Trash2 size={14} /> Remove
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
       </section>

        <ConfirmModal
          isOpen={deleteConfirmId === 'bulk'}
          title="Remove Selected Students"
          message={`This will permanently remove ${selectedIds.length} student account(s) to the archive. This action cannot be undone from this page. Restore them from the Archived section below.`}
          confirmLabel={deleting ? 'Removing...' : 'Remove All'}
          isDestructive
          onConfirm={handleBulkArchiveConfirm}
          onClose={() => {
            setDeleteConfirmId(null);
          }}
        />
        {uploadResult && (
          <div
            className={styles.uploadResultOverlay}
            onClick={() => setUploadResult(null)}
          >
            <div
              className={styles.uploadResultModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-upload-result-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`${styles.uploadResultIcon} ${
                uploadResult.kind === 'error'
                  ? styles.uploadResultError
                  : uploadResult.kind === 'warning'
                    ? styles.uploadResultWarning
                    : styles.uploadResultSuccess
              }`}>
                {uploadResult.kind === 'error' ? <X size={22} /> : <Check size={22} />}
              </div>
              <h2 id="student-upload-result-title">
                {uploadResult.kind === 'error'
                  ? 'Upload failed'
                  : uploadResult.kind === 'warning'
                    ? 'Upload completed with issues'
                    : 'Upload complete'}
              </h2>
              <p>{uploadResult.message}</p>
              <button
                type="button"
                className={styles.uploadResultButton}
                onClick={() => setUploadResult(null)}
                autoFocus
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* ARCHIVED ICON BUTTON (bottom) */}
        <button
          type="button"
          className={styles.archiveToggleBtn}
          onClick={() => setArchivedModalOpen(true)}
          title="View archived students"
          aria-label="View archived students"
        >
          <Archive size={18} />
        </button>

        {/* ARCHIVED STUDENTS MODAL */}
        <div
          className={`${styles.modalOverlay} ${archivedModalOpen ? styles.modalOpen : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archived-title"
          onClick={() => setArchivedModalOpen(false)}
        >
          <div
            className={styles.archivedModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="archived-title">Archived Students</h2>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setArchivedModalOpen(false)}
                aria-label="Close archived students"
              >
                <X size={18} />
              </button>
            </div>

            {archivedStudents.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>✓</div>
                <h4>No archived students</h4>
                <p>Removed students will appear here.</p>
              </div>
            ) : (
              <>
                {/* ARCHIVED BULK ACTIONS */}
                {archivedSelectedIds.length > 0 && (
                  <div className={styles.bulkBar}>
                    <div className={styles.bulkActions}>
                      <button
                        className={styles.bulkApproveBtn}
                        onClick={handleBulkRestore}
                        disabled={bulkLoading}
                      >
                        <UserCheck size={14} />
                        Restore Selected
                      </button>

                      <button
                        className={styles.bulkDeleteBtn}
                        onClick={handleBulkPermanentDelete}
                        disabled={bulkLoading}
                      >
                        <Trash2 size={14} />
                        Permanently Delete Selected
                      </button>
                    </div>
                  </div>
                )}

                <div className={styles.tableContainer}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.checkboxHeader}>
                          <button
                            className={styles.checkbox}
                            type="button"
                            onClick={handleSelectAllArchived}
                            aria-label="Select all archived"
                          >
                            {archivedSelectedIds.length === archivedStudents.length &&
                            archivedStudents.length > 0 ? (
                              <CheckSquare size={16} />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </th>
                        <th>STUDENT</th>
                        <th>EMAIL</th>
                        <th>STRAND</th>
                        <th>ARCHIVED</th>
                        <th className={styles.actionHeader}>ACTIONS</th>
                      </tr>
                    </thead>

                    <tbody>
                      {archivedStudents.map((student) => {
                        const fullName =
                          `${student.first_name || ''} ${student.last_name || ''}`.trim();
                        const isSelected = archivedSelectedIds.includes(student.id);
                        return (
                          <tr key={student.id}>
                            <td className={styles.checkboxCell}>
                              <button
                                className={styles.checkbox}
                                type="button"
                                onClick={() => handleSelectOneArchived(student.id)}
                                aria-label={`Select ${student.first_name}`}
                              >
                                {isSelected ? (
                                  <CheckSquare size={16} />
                                ) : (
                                  <Square size={16} />
                                )}
                              </button>
                            </td>

                            <td>
                              <div className={styles.studentCell}>
                                <div>
                                  <strong>{fullName || 'Unnamed Student'}</strong>
                                </div>
                              </div>
                            </td>

                            <td>
                              <span className={styles.email}>{student.email || '-'}</span>
                            </td>

                            <td>
                              <span className={styles.trackStrand}>
                                {student.track_strand || '-'}
                              </span>
                            </td>

                            <td>
                              <span className={styles.registeredDate}>
                                {student.archived_at
                                  ? new Date(student.archived_at).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                    })
                                  : '—'}
                              </span>
                            </td>

                            <td>
                              <div className={styles.actions}>
                                <button
                                  className={styles.approveBtn}
                                  onClick={() => handleRestore(student.id)}
                                  disabled={deleting}
                                  title="Restore from archive"
                                  aria-label="Restore student from archive"
                                >
                                  <UserCheck size={15} />
                                </button>

                                <button
                                  className={styles.deleteBtn}
                                  onClick={() => handlePermanentDelete(student.id)}
                                  disabled={deleting}
                                  title="Permanently delete"
                                  aria-label="Permanently delete student"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        <ConfirmModal
          isOpen={deleteConfirmId === 'bulk'}
          title="Remove Selected Students"
          message={`This will permanently remove ${selectedIds.length} student account(s) to the archive. This action cannot be undone from this page. Restore them from the Archived section below.`}
          confirmLabel={deleting ? 'Removing...' : 'Remove All'}
          isDestructive
          onConfirm={handleBulkArchiveConfirm}
          onClose={() => {
            setDeleteConfirmId(null);
          }}
        />
        {uploadResult && (
          <div
            className={styles.uploadResultOverlay}
            onClick={() => setUploadResult(null)}
          >
            <div
              className={styles.uploadResultModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-upload-result-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`${styles.uploadResultIcon} ${
                uploadResult.kind === 'error'
                  ? styles.uploadResultError
                  : uploadResult.kind === 'warning'
                    ? styles.uploadResultWarning
                    : styles.uploadResultSuccess
              }`}>
                {uploadResult.kind === 'error' ? <X size={22} /> : <Check size={22} />}
              </div>
              <h2 id="student-upload-result-title">
                {uploadResult.kind === 'error'
                  ? 'Upload failed'
                  : uploadResult.kind === 'warning'
                    ? 'Upload completed with issues'
                    : 'Upload complete'}
              </h2>
              <p>{uploadResult.message}</p>
              <button
                type="button"
                className={styles.uploadResultButton}
                onClick={() => setUploadResult(null)}
                autoFocus
              >
                Close
              </button>
            </div>
          </div>
        )}
        {editingEmailId && (
          <div
            className={styles.editEmailOverlay}
            onClick={handleCancelEditEmail}
          >
            <div
              className={styles.editEmailModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-email-title"
              onClick={(event) => event.stopPropagation()}
            >
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
                  type="button"
                  className={styles.editEmailCancelBtn}
                  onClick={handleCancelEditEmail}
                  disabled={updatingEmailId}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.editEmailSaveBtn}
                  onClick={() => handleSaveEmail(editingEmailId)}
                  disabled={updatingEmailId || !editEmailValue.trim()}
                >
                  {updatingEmailId ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

export default StudentApprovals;