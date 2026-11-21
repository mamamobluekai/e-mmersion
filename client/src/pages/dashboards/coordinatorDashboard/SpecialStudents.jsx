import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getSpecialNeedsStudents } from '../../../api/coordinatorApi';
import styles from './SpecialStudents.module.css';

const studentName = (student) =>
  [student.first_name, student.middle_name, student.last_name, student.suffix]
    .filter(Boolean)
    .join(' ');

function SpecialStudents() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    getSpecialNeedsStudents()
      .then((data) => {
        if (!cancelled) setStudents(data.students || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load special students.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) => [
      studentName(student),
      student.student_number,
      student.section,
      student.strand,
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [search, students]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Student Support</p>
          <h1>Special Students</h1>
          <p>Students who answered Yes to the disability or special needs question.</p>
        </div>
        {!loading && !error && (
          <div className={styles.count} aria-live="polite">
            <strong>{students.length}</strong>
            <span>{students.length === 1 ? 'student' : 'students'}</span>
          </div>
        )}
      </header>

      <p className={styles.privacyNote}>
        This list contains sensitive student information. Use it only to coordinate appropriate support.
      </p>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {!error && (
        <>
          <label className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <span className={styles.srOnly}>Search special students</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, student number, section, or strand"
            />
          </label>

          {loading ? (
            <div className={styles.state}>Loading students...</div>
          ) : filteredStudents.length > 0 ? (
            <section className={styles.studentGrid} aria-label="Students who answered Yes">
              {filteredStudents.map((student) => (
                <article className={styles.studentCard} key={student.id}>
                  <div className={styles.cardHeader}>
                    <div className={styles.studentIdentity}>
                      <h2>{studentName(student) || 'Unnamed student'}</h2>
                      <p>{student.student_number || 'Student number not available'}</p>
                    </div>
                    <span className={styles.yesBadge}>Yes</span>
                  </div>
                  <dl className={styles.details}>
                    <div>
                      <dt>Section</dt>
                      <dd>{student.section || '—'}</dd>
                    </div>
                    <div>
                      <dt>Track &amp; Strand</dt>
                      <dd>{student.strand || '—'}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </section>
          ) : (
            <div className={styles.emptyState}>
              <h2>{search ? 'No matching students' : 'No students listed'}</h2>
              <p>
                {search
                  ? 'Try another name, student number, section, or strand.'
                  : 'Students who answer Yes will appear here.'}
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default SpecialStudents;
