import { useEffect, useState } from 'react';
import { Building2, Check, Send, Star, UserRound } from 'lucide-react';
import { getImmersionFeedbackForm, submitImmersionFeedback } from '../../../api/evaluationApi';
import { StarRating } from '../../../components/shared/StarRating';
import styles from '../ImmersionFeedback.module.css';

const agreementScale = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']
  .map((label, index) => ({ value: index + 1, label }));

const sections = [
  { key: 'institution', label: 'Partner institution', Icon: Building2 },
  { key: 'supervisor', label: 'Workplace supervisor', Icon: UserRound },
];

function FeedbackForm({ criteria, placement, onSaved, onReload }) {
  const [ratings, setRatings] = useState(() => Object.fromEntries(sections.map(({ key }) => [key, criteria[key].map(() => null)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const submitted = Boolean(placement.submitted_at);
  const complete = sections.every(({ key }) => ratings[key].every(Boolean));

  async function submit(event) {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { feedback } = await submitImmersionFeedback(placement.deployment_id, criteria.version, ratings);
      onSaved(placement.deployment_id, feedback);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.stack} onSubmit={submit}>
      {submitted ? <p className={styles.success} role="status"><Check size={18} aria-hidden="true" /> Feedback submitted</p> : (
        <p className={styles.hint}>Give each statement 1 star for strongly disagree through 5 stars for strongly agree. Your ratings are shared as summaries without your name.</p>
      )}
      {sections.map(({ key, label, Icon }) => (
        <section className={styles.card} key={key} aria-label={label}>
          <div className={styles.cardHeading}>
            <span className={styles.icon}><Icon size={20} aria-hidden="true" /></span>
            <div>
              <p>{label}</p>
              <h2>{placement[`${key}_name`]}</h2>
            </div>
          </div>
          <ol className={styles.rows}>
            {(submitted ? placement[`${key}_ratings`] : criteria[key]).map((item, index) => (
              <li key={index} className={styles.ratingRow}>
                <span>{submitted ? item.criterion : item}</span>
                {submitted ? <span className={styles.score}><Star size={16} fill="currentColor" aria-hidden="true" /> {item.stars} / 5</span> : (
                  <StarRating name={`${label}: ${item}`} value={ratings[key][index]} scale={agreementScale} allowNA={false}
                    onChange={(stars) => setRatings((current) => ({ ...current, [key]: current[key].map((score, position) => position === index ? stars : score) }))} />
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {error && <p className={styles.error} role="alert">{error.message}</p>}
      {!submitted && (
        <div className={styles.footer}>
          {error?.status === 409 && <button className={styles.secondary} type="button" onClick={onReload}>Reload form</button>}
          <button className={styles.primary} type="submit" disabled={!complete || saving || error?.status === 409}>
            <Send size={17} aria-hidden="true" /> {saving ? 'Submitting…' : 'Submit evaluation'}
          </button>
        </div>
      )}
    </form>
  );
}

export default function EvaluatePartnerInstitution() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [deploymentId, setDeploymentId] = useState(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getImmersionFeedbackForm(controller.signal).then(setData).catch((err) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [request]);

  function reload() {
    setData(null);
    setError('');
    setRequest((value) => value + 1);
  }

  const placement = data?.placements.find((item) => item.deployment_id === deploymentId)
    ?? data?.placements.find((item) => !item.submitted_at) ?? data?.placements[0];

  function saveResult(id, feedback) {
    setDeploymentId((current) => current ?? id);
    setData((current) => ({ ...current, placements: current.placements.map((item) => item.deployment_id === id ? { ...item, ...feedback } : item) }));
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Evaluate Partner Institution</h1>
        <p>Share feedback on your work immersion placement and workplace supervisor.</p>
      </header>
      {error && <div className={styles.stack}><p className={styles.error} role="alert">{error}</p><button type="button" className={styles.secondary} onClick={reload}>Try again</button></div>}
      {!data && !error && <p role="status">Loading evaluation form…</p>}
      {data && !placement && <p className={styles.card}>There are no attended partner placements available to evaluate.</p>}
      {data?.placements.length > 1 && (
        <label className={styles.field}>
          Placement
          <select value={placement.deployment_id} onChange={(event) => setDeploymentId(Number(event.target.value))}>
            {data.placements.map((item) => (
              <option key={item.deployment_id} value={item.deployment_id}>{item.institution_name} · {item.batch_label}{item.submitted_at ? ' (submitted)' : ''}</option>
            ))}
          </select>
        </label>
      )}
      {placement && <FeedbackForm key={`${placement.deployment_id}:${data.criteria.version}`} criteria={data.criteria}
        placement={placement} onSaved={saveResult} onReload={reload} />}
    </div>
  );
}
