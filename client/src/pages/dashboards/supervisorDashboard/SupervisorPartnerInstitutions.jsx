import { useEffect, useMemo, useState } from 'react';
import { getSupervisorPartnerInstitutions, getSupervisorPartnerInstitutionStudents } from '../../../api/supervisorApi';
import Feedback from '../../../components/Feedback';
import StudentDetailModal from '../../../components/shared/StudentDetailModal';
import PersonDrawer from '../../../components/shared/PersonDrawer';
import { getStudentName } from '../../../components/shared/studentFields';
import styles from './SupervisorPartnerInstitutions.module.css';

const joinName = (first, last) => `${first || ''} ${last || ''}`.trim() || 'Not provided';

function SupervisorPartnerInstitutions() {
  const [institutions, setInstitutions] = useState([]);
  const [activePerson, setActivePerson] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
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

  // Teacher / coordinator profile opens in the shared side drawer.
  const openPerson = (role, institution) => {
    if (role === 'teacher') {
      setActivePerson({
        role: 'Teacher',
        firstName: institution.teacher_first_name,
        lastName: institution.teacher_last_name,
        institutionName: institution.name,
        fields: [
          { label: 'Full Name', value: joinName(institution.teacher_first_name, institution.teacher_last_name) },
          { label: 'Employee ID', value: institution.teacher_employee_id },
          { label: 'Department', value: institution.teacher_department },
          { label: 'Designation', value: institution.teacher_designation },
          { label: 'School', value: institution.teacher_school },
          { label: 'Email', value: institution.teacher_email },
          { label: 'Phone', value: institution.teacher_phone },
          { label: 'Partner Institution', value: institution.name },
        ],
      });
      return;
    }

    setActivePerson({
      role: 'Coordinator',
      firstName: institution.coordinator_first_name,
      lastName: institution.coordinator_last_name,
      institutionName: institution.name,
      fields: [
        { label: 'Full Name', value: joinName(institution.coordinator_first_name, institution.coordinator_last_name) },
        { label: 'Employee ID', value: institution.coordinator_employee_id },
        { label: 'Department', value: institution.coordinator_department },
        { label: 'Designation', value: institution.coordinator_designation },
        { label: 'School', value: institution.coordinator_school },
        { label: 'Email', value: institution.coordinator_email },
        { label: 'Phone', value: institution.coordinator_phone },
        { label: 'Partner Institution', value: institution.name },
      ],
    });
  };

  const filteredInstitutions = useMemo(() => {
    if (!term.trim()) return institutions;
    const t = term.toLowerCase();
    return institutions.filter((inst) =>
      inst.name.toLowerCase().includes(t) ||
      inst.industry.toLowerCase().includes(t)
    );
  }, [institutions, term]);

  const openInstitutionStudents = async (institution) => {
    if (institution.students) return;
    try {
      const data = await getSupervisorPartnerInstitutionStudents(institution.id);
      institution.students = data.students || [];
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) {
    return <Feedback busy>Loading partner institutions…</Feedback>;
  }

  if (error) {
    return <Feedback error={error} />;
  }

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

      <div className={styles.grid}>
        {filteredInstitutions.map((inst) => (
          <section key={inst.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.instInfo}>
                <h3 className={styles.instName}>{inst.name}</h3>
                <p className={styles.instMeta}>
                  <span>{inst.industry}</span>
                  {inst.batch_count && <span> · {inst.batch_count} deployment{batch_count !== 1 ? 's' : ''}</span>}
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
                        <span>{getStudentName(student.first_name, student.last_name).charAt(0)}</span>
                      )}
                    </div>
                    <div className={styles.studentInfo}>
                      <span className={styles.studentName}>
                        {getStudentName(student.first_name, student.last_name)}
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
      </div>

      {filteredInstitutions.length === 0 && (
        <Feedback empty>
          <p>No partner institutions found</p>
          <p className={styles.subText}>
            {term ? 'Try a different search term.' : 'You are not assigned to any partner institutions yet.'}
          </p>
        </Feedback>
      )}

      <StudentDetailModal
        student={selectedStudent?.student}
        institution={selectedStudent?.institution}
        onClose={closeStudent}
      />

      {activePerson && (
        <PersonDrawer
          person={activePerson}
          onClose={() => setActivePerson(null)}
        />
      )}
    </div>
  );
}

export default SupervisorPartnerInstitutions;