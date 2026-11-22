import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Search, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { usePartnerInstitution } from '../../../hooks/usePartnerInstitution';
import { getPartnerInstitutionStudents } from '../../../api/teacherApi';
import StudentDetailModal from '../../../components/shared/StudentDetailModal';
import {
  getStudentName,
  getStudentContact,
  getStudentStrand,
  getStudentInitials,
} from '../../../components/shared/studentFields';
import styles from './TeacherStudents.module.css';

// Teacher's read-only student list for the partner institution selected in the sidebar.
// Clicking a row opens the shared student information modal.
function TeacherStudents() {
  const { token } = useAuth();
  const { institution, institutionId, institutionName, loading: institutionsLoading } = usePartnerInstitution();
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!institutionId) {
      setStudents([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setStudents([]);
    async function init() {
      try {
        const s = await getPartnerInstitutionStudents(institutionId, token);
        if (!cancelled) setStudents(s?.students || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load students.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [institutionId, token]);

  const closeStudent = useCallback(() => setSelected(null), []);

  // Switching institution starts from a clean search.
  useEffect(() => {
    setQuery('');
  }, [institutionId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return students;
    return students.filter((s) =>
      [
        s.student_number,
        s.student_id,
        getStudentName(s),
        s.email,
        getStudentStrand(s),
        getStudentContact(s),
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [students, query]);

  const showTable = !loading && !institutionsLoading && Boolean(institutionId);

  return (
    <div className={styles.page}>

      {/* ============ PAGE HEADER ============ */}
      <div className={styles.pageHeader}>
        <div>
          <h1>My Students</h1>
          <p>View the students assigned to your selected partner institution.</p>
          {institution?.deployment_start && <p>Approved dates {institution.deployment_start} to {institution.deployment_end}</p>}
        </div>
      </div>

      {/* ============ ALERTS ============ */}
      {error && <div className={styles.errorAlert}>{error}</div>}

      {/* ============ CARD ============ */}
      <div className={styles.card}>

        <div className={styles.cardHeader}>
          <div>
            <h2>Student List</h2>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={15} strokeWidth={2} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, student ID, email, strand or contact no."
              aria-label="Search students"
            />
            {query && (
              <button type="button" className={styles.searchClear} onClick={() => setQuery('')} aria-label="Clear search">
                <X size={12} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {(loading || institutionsLoading) && (
          <div className={styles.loading}>
            <span className={styles.spinner} />
            Loading students...
          </div>
        )}

        {!institutionsLoading && !institutionId && (
          <div className={styles.empty}>
            <Users size={34} strokeWidth={1.5} />
            <h3>No partner institution assigned</h3>
            <p>You are not assigned to a partner institution yet.</p>
          </div>
        )}

        {showTable && filtered.length === 0 && (
          <div className={styles.empty}>
            <Search size={34} strokeWidth={1.5} />
            <h3>{students.length === 0 ? 'No students yet' : 'No matching students'}</h3>
            <p>
              {students.length === 0
                ? 'No students are assigned to this partner institution.'
                : 'Try a different name, student ID, email, strand or contact number.'}
            </p>
          </div>
        )}

        {showTable && filtered.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Strand</th>
                  <th>Contact No.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id || s.student_id}
                    className={styles.clickableRow}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(s)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(s);
                      }
                    }}
                    aria-label={`View information for ${getStudentName(s)}`}
                  >
                    <td className={styles.idCell}>
                      {s.student_number || s.student_id || '—'}
                    </td>
                    <td>
                      <div className={styles.studentCell}>
                        {s.photo_url ? (
                          <img className={styles.studentAvatar} src={s.photo_url} alt="" />
                        ) : (
                          <span className={styles.studentAvatar} aria-hidden="true">
                            {getStudentInitials(s)}
                          </span>
                        )}
                        <div>
                          <strong>{getStudentName(s) || '—'}</strong>
                          <span>{getStudentStrand(s) || 'No strand'}</span>
                        </div>
                      </div>
                    </td>
                    <td className={styles.email}>{s.email || '—'}</td>
                    <td>
                      <span className={styles.badge}>{getStudentStrand(s) || '—'}</span>
                    </td>
                    <td className={styles.contactCell}>{getStudentContact(s) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <StudentDetailModal
          student={selected}
          batch={{ batch_label: institutionName }}
          onClose={closeStudent}
        />
      )}
    </div>
  );
}

export default TeacherStudents;
