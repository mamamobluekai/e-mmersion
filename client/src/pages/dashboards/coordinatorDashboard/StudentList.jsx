import { useEffect, useRef, useState } from 'react';
import {
  getCoordinatorProfile,
  getAllStudents,
  getStudentStrands,
  getArchivedStudents,
} from '../../../api/coordinatorApi';
import {
  Search,
  UserCheck,
  X,
  Archive,
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

  const [error, setError] = useState('');

  const [archivedModalOpen, setArchivedModalOpen] = useState(false);
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
              placeholder="Search by student, email, ID, or teacher…"
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
          ) : students.length === 0 ? (
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
                  <th>Uploaded by teacher</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
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
                    <td data-label="Uploaded by teacher">{student.uploaded_by_teacher || 'Not recorded'}</td>
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
                      <th>Uploaded by teacher</th>
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
                        <td>{student.uploaded_by_teacher || 'Not recorded'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default StudentList;
