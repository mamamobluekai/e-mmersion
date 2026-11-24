import { useEffect, useState } from 'react';
import { Building2, Plus, Save, Trash2, UserRound } from 'lucide-react';
import { getImmersionFeedbackCriteria, saveImmersionFeedbackCriteria } from '../../../api/evaluationApi';
import styles from '../ImmersionFeedback.module.css';

const sections = [
  { key: 'institution', label: 'Partner institution', Icon: Building2 },
  { key: 'supervisor', label: 'Workplace supervisor', Icon: UserRound },
];

export default function ImmersionFeedbackCriteria() {
  const [criteria, setCriteria] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getImmersionFeedbackCriteria(controller.signal).then((data) => setCriteria(data.criteria)).catch((err) => {
      if (!controller.signal.aborted) setError(err);
    });
    return () => controller.abort();
  }, [request]);

  function reload() {
    setError(null);
    setNotice('');
    setCriteria(null);
    setRequest((value) => value + 1);
  }

  function change(key, update) {
    setNotice('');
    setCriteria((current) => ({ ...current, [key]: update(current[key]) }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      const data = await saveImmersionFeedbackCriteria({ institution: criteria.institution, supervisor: criteria.supervisor }, criteria.version);
      setCriteria(data.criteria);
      setNotice('Evaluation criteria saved.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Evaluation Criteria</h1>
        <p>Edit the statements students rate when evaluating partner institutions and workplace supervisors.</p>
      </header>
      {error && <p className={styles.error} role="alert">{error.message}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {!criteria && !error && <p role="status">Loading criteria…</p>}
      {(!criteria && error || error?.status === 409) && (
        <button className={styles.secondary} type="button" onClick={reload}>Reload criteria</button>
      )}
      {criteria && (
        <form className={styles.stack} onSubmit={save}>
          {sections.map(({ key, label, Icon }) => (
            <fieldset className={styles.card} disabled={saving} key={key} aria-label={label}>
              <div className={styles.cardHeading}>
                <span className={styles.icon}><Icon size={20} aria-hidden="true" /></span>
                <h2>{label}</h2>
              </div>
              <ol className={styles.rows}>
                {criteria[key].map((item, index) => (
                  <li key={index} className={styles.editRow}>
                    <label className={styles.field}>
                      Criterion {index + 1}
                      <textarea rows={2} required maxLength={140} value={item}
                        onChange={(event) => change(key, (items) => items.map((entry, position) => position === index ? event.target.value : entry))} />
                    </label>
                    <button className={styles.remove} type="button" aria-label={`Remove ${label.toLowerCase()} criterion ${index + 1}`}
                      disabled={criteria[key].length === 1} onClick={() => change(key, (items) => items.filter((_, position) => position !== index))}>
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
              <button className={styles.secondary} type="button" disabled={criteria[key].length >= 20}
                onClick={() => change(key, (items) => [...items, ''])}>
                <Plus size={17} aria-hidden="true" /> Add criterion
              </button>
            </fieldset>
          ))}
          <div className={styles.footer}>
            <button className={styles.primary} type="submit" disabled={saving || error?.status === 409}>
              <Save size={17} aria-hidden="true" /> {saving ? 'Saving…' : 'Save criteria'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
