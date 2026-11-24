import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Download, FilePlus, History, LogIn, LogOut, PanelsTopLeft, Pencil, Trash2 } from 'lucide-react';
import { getActivityHistory } from '../../api/activityHistoryApi';
import styles from './ActivityHistory.module.css';

const dateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
});
const activityIcons = {
  page: PanelsTopLeft,
  'sign-in': LogIn,
  'sign-out': LogOut,
  create: FilePlus,
  update: Pencil,
  delete: Trash2,
  download: Download,
};
const expiryTime = (entry) => entry.expires_at ? Date.parse(entry.expires_at) : Date.parse(entry.occurred_at) + 86_400_000;

export function ActivityHistoryLink({ to, onClick }) {
  return (
    <Link to={to} onClick={onClick} className={styles.settingsLink}>
      <span className={styles.icon}><History size={20} aria-hidden="true" /></span>
      <span className={styles.linkText}><strong>Activity History</strong><small>Review your page visits and account activity.</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </Link>
  );
}

export default function ActivityHistory({ settingsPath }) {
  const [query, setQuery] = useState({ type: '', area: '', before: null });
  const [result, setResult] = useState({ entries: [], next: null, types: {}, areas: {} });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getActivityHistory({ ...query, signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setResult((previous) => ({ ...data, entries: query.before ? [...previous.entries, ...data.entries] : data.entries }));
      setLoading(false);
    }).catch((err) => {
      if (controller.signal.aborted) return;
      setError(err.message);
      setLoading(false);
    });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!result.entries.length) return undefined;
    const nextExpiry = result.entries.reduce((earliest, entry) => Math.min(earliest, expiryTime(entry)), Infinity);
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setResult((previous) => {
        const entries = previous.entries.filter((entry) => expiryTime(entry) > now);
        return { ...previous, entries, next: entries.length ? previous.next : null };
      });
    }, Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [result.entries]);

  function changeQuery(changes) {
    setError('');
    setLoading(true);
    if (!changes.before) setResult((previous) => ({ ...previous, entries: [], next: null }));
    setQuery((previous) => ({ ...previous, before: null, ...changes }));
  }

  return (
    <div className={styles.page}>
      <Link to={settingsPath} className={styles.back}><ArrowLeft size={17} aria-hidden="true" /> Back to Settings</Link>
      <header className={styles.heading}>
        <div>
          <h1>Activity History</h1>
          <p className={styles.headingDescription}>Your sign-ins, page visits, and completed actions from the last 24 hours.</p>
        </div>
      </header>
      <section className={styles.card} aria-labelledby="activity-list-title">
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>
            <h2 id="activity-list-title">Account activity</h2>
            <span className={styles.timezone}>Philippine time</span>
          </div>
          <div className={styles.filters}>
            <label>Activity type
              <select value={query.type} onChange={(event) => changeQuery({ type: event.target.value })}>
                <option value="">All types</option>
                {Object.entries(result.types).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
              </select>
            </label>
            <label>Area
              <select value={query.area} onChange={(event) => changeQuery({ area: event.target.value })}>
                <option value="">All areas</option>
                {Object.entries(result.areas).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {result.entries.length > 0 && (
          <div className={styles.scrollArea} role="region" aria-labelledby="activity-list-title" tabIndex={0}>
            <ol className={styles.entries}>
              {result.entries.map((entry) => {
                const Icon = activityIcons[entry.type] ?? History;
                return (
                  <li className={styles.entry} key={entry.id}>
                    <span className={styles.entryIcon}><Icon size={18} aria-hidden="true" /></span>
                    <div className={styles.entryText}>
                      <strong>{entry.label}</strong>
                      <div className={styles.metadata}><span>{result.types[entry.type]}</span><span>{result.areas[entry.area]}</span></div>
                    </div>
                    <time dateTime={entry.occurred_at}>{dateFormat.format(new Date(entry.occurred_at))}</time>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {loading && <p className={styles.message} role="status">Loading activity…</p>}
        {error && (
          <div className={styles.errorState}>
            <p className={styles.error} role="alert">{error}</p>
            <button type="button" className={styles.button} onClick={() => changeQuery({ before: query.before })}>Try again</button>
          </div>
        )}
        {!loading && !error && !result.entries.length && (
          <div className={styles.emptyState}>
            <span className={styles.entryIcon}><History size={20} aria-hidden="true" /></span>
            <p>{query.type || query.area ? 'No activity matches these filters.' : 'There’s no recorded activity yet.'}</p>
          </div>
        )}
        {result.next && !error && (
          <div className={styles.footer}>
            <button type="button" className={styles.button} disabled={loading} onClick={() => changeQuery({ before: result.next })}>
              Load older activity <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
