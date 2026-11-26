import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { getAdminLoginActivity, updateAdminLoginAccess } from '../../../api/adminApi';
import ConfirmModal from '../../../components/admin/ConfirmModal';
import styles from './LoginActivityMonitoring.module.css';

const views = { activity: 'All activity', suspicious: 'Flagged activity', sessions: 'Active sessions', devices: 'Trusted devices' };
const roles = { admin: 'Administrator', coordinator: 'Coordinator', teacher: 'Teacher', supervisor: 'Supervisor', student: 'Student' };
const loginLabels = { success: 'Successful', failed: 'Failed', pending: 'Code requested', logout: 'Signed out', terminated: 'Session terminated' };
const otpLabels = { pending: 'Pending', verified: 'Verified', failed: 'Failed', not_required: 'Not required' };
const initialFilters = { search: '', role: '', loginStatus: '', otpStatus: '', from: '', to: '' };
const formatDate = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
const displayDate = (value) => value ? formatDate.format(new Date(value)) : '—';

function SelectFilter({ label, name, value, options, onChange }) {
  return <label>{label}
    <select name={name} value={value} onChange={onChange}>
      <option value="">All</option>
      {Object.entries(options).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
    </select>
  </label>;
}

export default function LoginActivityMonitoring() {
  const [view, setView] = useState('activity');
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [actionError, setActionError] = useState('');
  const isHistory = view === 'activity' || view === 'suspicious';
  const action = view === 'sessions' ? 'Terminate session' : 'Revoke trust';
  const enteredSearch = filters.search.trim();
  const { role, loginStatus, otpStatus, from, to } = filters;
  const invalidRange = Boolean(isHistory && from && to && from > to);
  const waitingForSearch = search !== enteredSearch;
  const params = useMemo(() => ({
    view, page, search, role, loginStatus: isHistory ? loginStatus : '', otpStatus: isHistory ? otpStatus : '',
    from: isHistory ? from : '', to: isHistory ? to : '',
  }), [view, page, search, role, isHistory, loginStatus, otpStatus, from, to]);
  const current = !waitingForSearch && response?.params === params && response.revision === revision ? response : null;
  const result = current?.result;
  const error = current?.error;
  const hasFilters = Boolean(filters.search || role || (isHistory && (loginStatus || otpStatus || from || to)));

  useEffect(() => {
    const timer = setTimeout(() => setSearch(enteredSearch), 275);
    return () => clearTimeout(timer);
  }, [enteredSearch]);

  useEffect(() => {
    if (waitingForSearch || invalidRange) return;
    const controller = new AbortController();
    getAdminLoginActivity(params, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResponse({ params, revision, result: data });
    }).catch((err) => {
      if (!controller.signal.aborted) setResponse({ params, revision, error: err.message });
    });
    return () => controller.abort();
  }, [params, revision, waitingForSearch, invalidRange]);

  function changeFilter(event) {
    const { name, value } = event.target;
    setFilters((previous) => ({ ...previous, [name]: value }));
    setPage(1);
    setNotice('');
  }

  function clearFilters() {
    setFilters(initialFilters);
    setSearch('');
    setPage(1);
    setNotice('');
  }

  function reload(nextPage) {
    setPage(nextPage);
    setRevision((current) => current + 1);
  }

  return <section className={styles.page} aria-labelledby="login-activity-title">
    <header className={styles.header}>
      <h1 id="login-activity-title">Login Activity Monitoring</h1>
      <p>Review sign-ins, manage active sessions, and revoke trusted devices. Times are in Philippine time.</p>
    </header>
    <nav className={styles.views} aria-label="Login activity views">
      {Object.entries(views).map(([id, label]) => <button key={id} type="button" aria-pressed={view === id}
        onClick={() => { setView(id); setNotice(''); setPage(1); }}>{label}</button>)}
    </nav>
    <div className={styles.panel}>
      {view === 'suspicious' && <p className={styles.message}>Security flags indicate activity that may need review.</p>}
      <form className={styles.filters} role="search" aria-label="Filter login activity"
        onSubmit={(event) => { event.preventDefault(); setSearch(enteredSearch); }}>
        <label className={styles.search}>Search users
          <span className={styles.searchField}><Search size={16} aria-hidden="true" />
            <input type="search" name="search" value={filters.search} maxLength={150} placeholder="Name or email" onChange={changeFilter} />
          </span>
        </label>
        <SelectFilter label="Role" name="role" value={role} options={roles} onChange={changeFilter} />
        {isHistory && <>
          <SelectFilter label="Login status" name="loginStatus" value={loginStatus} options={loginLabels} onChange={changeFilter} />
          <SelectFilter label="OTP status" name="otpStatus" value={otpStatus} options={otpLabels} onChange={changeFilter} />
          <label>From<input type="date" name="from" value={from} onChange={changeFilter} aria-invalid={invalidRange} /></label>
          <label>To<input type="date" name="to" value={to} onChange={changeFilter} aria-invalid={invalidRange} /></label>
        </>}
        <button type="button" className={styles.button} disabled={!hasFilters} onClick={clearFilters}>Clear filters</button>
      </form>
      {invalidRange && <p className={styles.error} role="alert">The end date must be on or after the start date.</p>}
      {error && <p className={styles.error} role="alert">{error} <button className={styles.button} type="button" onClick={() => reload(page)}>Retry</button></p>}
      {notice && <p className={styles.message} role="status">{notice}</p>}
      {!result && !error && !invalidRange && <p className={styles.message} role="status">Loading {views[view].toLowerCase()}…</p>}
      {result && !result.entries.length && <p className={styles.message} role="status">No results match this view and its filters.</p>}
      {result?.entries.length > 0 && <div className={styles.tableScroll} role="region" aria-label={views[view]} tabIndex={0}>
        <table className={styles.table}>
          <thead><tr>
            <th scope="col">User</th><th scope="col">Role</th><th scope="col">Sign-in time</th>
            <th scope="col">IP address</th><th scope="col">Device and OS</th><th scope="col">Browser</th>
            {isHistory ? <>
              <th scope="col">Login status</th><th scope="col">OTP status</th><th scope="col">Trusted</th>
              <th scope="col">Session</th><th scope="col">Security flags</th>
            </> : <>
              <th scope="col">{view === 'sessions' ? 'Last active' : 'Trust last used'}</th>
              <th scope="col">Expires</th><th scope="col">Action</th>
            </>}
          </tr></thead>
          <tbody>{result.entries.map((entry) => <tr key={entry.id}>
            <td><strong>{entry.name || '—'}</strong><small>{entry.email || '—'}</small></td>
            <td>{roles[entry.role] || '—'}</td><td>{displayDate(entry.occurred_at || entry.last_login_at)}</td>
            <td>{entry.ip || '—'}</td><td>{[entry.device, entry.os].filter(Boolean).join(' · ') || '—'}</td>
            <td>{entry.browser || '—'}</td>
            {isHistory ? <>
              <td>{loginLabels[entry.login_status]}</td><td>{otpLabels[entry.otp_status] || '—'}</td>
              <td>{entry.was_trusted == null ? '—' : entry.was_trusted ? 'Yes' : 'No'}</td>
              <td>{entry.session_status || '—'}</td>
              <td>{entry.flags?.length ? entry.flags.map((flag) => flag.replaceAll('_', ' ')).join(', ') : '—'}</td>
            </> : <>
              <td>{displayDate(entry.last_active_at || entry.trust_last_used_at)}</td>
              <td>{displayDate(entry.expires_at || entry.trust_expires_at)}</td>
              <td><button type="button" className={styles.button} onClick={() => { setActionError(''); setConfirm(entry); }}>{action}</button></td>
            </>}
          </tr>)}</tbody>
        </table>
      </div>}
      {result && (page > 1 || result.hasMore) && <nav className={styles.pagination} aria-label="Login activity pages">
        <button className={styles.button} type="button" disabled={page === 1} onClick={() => reload(page - 1)}>
          <ChevronLeft size={16} aria-hidden="true" /> Previous
        </button>
        <span>Page {page}</span>
        <button className={styles.button} type="button" disabled={!result.hasMore} onClick={() => reload(page + 1)}>
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>}
    </div>
    {confirm && <ConfirmModal isOpen isDestructive title={`${action}?`} confirmLabel={action}
      message={<>{view === 'sessions' ? `${confirm.email} will be signed out of this session.`
        : `This device will need a new email code the next time ${confirm.email} signs in.`}
        {actionError && <><br /><strong role="alert">{actionError}</strong></>}</>}
      onClose={() => setConfirm(null)} onConfirm={async () => {
        setActionError('');
        try {
          await updateAdminLoginAccess(view, confirm.user_id, confirm.id);
        } catch (err) {
          setActionError(err.message);
          throw err;
        }
        setNotice(view === 'sessions' ? 'Session terminated.' : 'Device trust revoked.');
        reload(result?.entries.length === 1 ? Math.max(1, page - 1) : page);
      }} />}
  </section>;
}
