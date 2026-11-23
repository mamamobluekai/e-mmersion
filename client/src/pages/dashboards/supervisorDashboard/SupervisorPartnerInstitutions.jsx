import { useEffect, useMemo, useState } from 'react';
import { getSupervisorPartnerInstitutions, getSupervisorPartnerInstitutionStudents } from '../../../api/supervisorApi';
import Feedback from '../../../components/Feedback';
import StudentDetailModal from '../../../components/shared/StudentDetailModal';
import { getStudentName } from '../../../components/shared/studentFields';
import { SupervisorApprovedDeployments } from '../PartnerDeployments';
import styles from './SupervisorPartnerInstitutions.module.css';

function SupervisorPartnerInstitutions() {
  const [institutions, setInstitutions] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError('');
      try {
        const data = await getSupervisorPartnerInstitutions();
        if (!cancelled) setInstitutions(data.institutions || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const openStudent = (student, institution) => {
    setSelectedStudent({ student, institution });
  };

  const closeStudent = () => {
    setSelectedStudent(null);
  };

  const filteredInstitutions = useMemo(() => {
    if (!term.trim()) return institutions;
    const t = term.trim().toLowerCase();
    return institutions.filter((inst) =>
      inst.name.toLowerCase().includes(t) ||
      inst.industry?.toLowerCase().includes(t)
    );
  }, [institutions, term]);

  const openInstitutionStudents = async (institution) => {
    const updateStudents = (students) => setInstitutions((current) =>
      current.map((item) => item.id === institution.id ? { ...item, students } : item));
    if (institution.students) {
      updateStudents(undefined);
      return;
    }
    try {
      const data = await getSupervisorPartnerInstitutionStudents(institution.id);
      updateStudents(data.students || []);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Partner Institutions</h1>
        <p>Manage students deployed to partner institutions</p>
      </header>

      <div className={styles.searchBar}>
        <input
          type="text"
          placeholder="Search partner institutions..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      {loading && <Feedback busy>Loading partner institutions…</Feedback>}
      {error && <Feedback error={error} />}
      {filteredInstitutions.length > 0 && <div className={styles.grid}>
        {filteredInstitutions.map((inst) => (
          <section key={inst.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.instInfo}>
                <h3 className={styles.instName}>{inst.name}</h3>
                <p className={styles.instMeta}>
                  <span>{inst.industry}</span>
                  {Number(inst.batch_count) > 0 && <span> · {inst.batch_count} deployment{Number(inst.batch_count) !== 1 ? 's' : ''}</span>}
                  {inst.deployment_start && <span> · {new Date(inst.deployment_start).toLocaleDateString()}</span>}
                </p>
              </div>
              <button
                className={styles.expandBtn}
                onClick={() => openInstitutionStudents(inst)}
              >
                {inst.students ? 'Hide' : 'View'} Students
              </button>
            </div>

            {inst.students && inst.students.length > 0 && (
              <div className={styles.studentList}>
                {inst.students.map((student) => (
                  <button
                    key={student.student_id}
                    className={styles.studentRow}
                    onClick={() => openStudent(student, inst)}
                  >
                    <div className={styles.studentAvatar}>
                      {student.photo_url ? (
                        <img src={student.photo_url} alt="" />
                      ) : (
                        <span>{getStudentName(student).charAt(0)}</span>
                      )}
                    </div>
                    <div className={styles.studentInfo}>
                      <span className={styles.studentName}>
                        {getStudentName(student)}
                      </span>
                      <span className={styles.studentMeta}>
                        {student.student_number} · {student.track_strand}
                      </span>
                    </div>
                    <div className={styles.studentProgress}>
                      <span className={styles.progressBadge}>
                        {student.requirements_status || 'Pending'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>}

      {!loading && !error && filteredInstitutions.length === 0 && (
        <Feedback empty>
          <p>No partner institutions found</p>
          <p className={styles.subText}>
            {term ? 'Try a different search term.' : 'You are not assigned to any partner institutions yet.'}
          </p>
        </Feedback>
      )}

      <div className={styles.approvedDeployments}>
        <SupervisorApprovedDeployments search={term} />
      </div>

      {selectedStudent && <StudentDetailModal
        student={selectedStudent.student}
        batch={selectedStudent.institution}
        onClose={closeStudent}
      />}

    </div>
  );
}

export default SupervisorPartnerInstitutions;
