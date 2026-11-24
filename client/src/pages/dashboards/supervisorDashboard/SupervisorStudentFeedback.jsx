import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { getMySupervisorFeedback } from '../../../api/evaluationApi';
import styles from '../ImmersionFeedback.module.css';

const responseCount = (count) => `${count} ${count === 1 ? 'response' : 'responses'}`;

export default function SupervisorStudentFeedback() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getMySupervisorFeedback(controller.signal).then(setSummary).catch((err) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [request]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Student Feedback</h1>
        <p>See how students rated the supervision and guidance they received during work immersion.</p>
      </header>
      {error && <div className={styles.stack}><p className={styles.error} role="alert">{error}</p>
        <button type="button" className={styles.secondary} onClick={() => { setError(''); setRequest((value) => value + 1); }}>Try again</button>
      </div>}
      {!summary && !error && <p role="status">Loading student feedback…</p>}
      {summary?.responses === 0 && <p className={styles.card}>You haven’t received any student ratings yet.</p>}
      {summary?.responses > 0 && (
        <div className={styles.stack}>
          <section className={`${styles.card} ${styles.summary}`} aria-label="Overall supervisor rating">
            <div>
              <h2>Overall rating</h2>
              <p className={styles.hint}>Based on {responseCount(summary.responses)}</p>
            </div>
            <strong className={styles.score}><Star size={24} fill="currentColor" aria-hidden="true" /> {summary.average.toFixed(2)} / 5</strong>
          </section>
          <section className={styles.card}>
            <h2>Ratings by criterion</h2>
            <ul className={styles.rows}>
              {summary.criteria.map((item) => (
                <li className={styles.summaryRow} key={item.criterion}>
                  <span>{item.criterion}</span>
                  <small>{responseCount(item.responses)}</small>
                  <strong className={styles.score}>{item.average.toFixed(2)} / 5</strong>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.card}>
            <h2>Ratings by partner institution</h2>
            <ul className={styles.rows}>
              {summary.institutions.map((item) => (
                <li className={styles.summaryRow} key={item.id}>
                  <span>{item.name}</span>
                  <small>{responseCount(item.responses)}</small>
                  <strong className={styles.score}>{item.average.toFixed(2)} / 5</strong>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
