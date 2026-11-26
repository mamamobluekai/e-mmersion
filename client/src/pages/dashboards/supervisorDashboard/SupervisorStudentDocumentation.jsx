import { useEffect, useState } from 'react';
import { getSupervisorPartnerInstitutions } from '../../../api/supervisorApi';
import { StudentDocumentation } from '../teacherDashboard/TeacherStudentDocumentation';
import styles from '../teacherDashboard/TeacherStudentDocumentation.module.css';

export default function SupervisorStudentDocumentation() {
  const [institutions, setInstitutions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const request = new AbortController();
    getSupervisorPartnerInstitutions(request.signal)
      .then(({ institutions: assigned }) => {
        if (!request.signal.aborted) setInstitutions(assigned || []);
      })
      .catch((err) => {
        if (!request.signal.aborted) setError(err.message || 'Could not load your partner institutions.');
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, []);

  const institutionId = selectedId ?? institutions[0]?.id;
  const picker = institutions.length > 1 && (
    <label className={styles.institutionPicker}>
      Partner institution
      <select value={institutionId} onChange={(event) => setSelectedId(Number(event.target.value))}>
        {institutions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );

  return (
    <StudentDocumentation
      key={institutionId}
      institutionId={institutionId}
      scopeLoading={loading}
      scopeError={error}
      scopePicker={picker}
      readOnly
    />
  );
}
