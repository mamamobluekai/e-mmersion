import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, ChevronRight, KeyRound, Laptop, LogOut, Smartphone, Tablet, Trash2, X } from 'lucide-react';
import ConfirmModal from '../../components/admin/ConfirmModal';
import { getAccountDevices, getLoginActivity, removeAccountDevice, requestDeviceCode, revokeAccountDeviceTrust,
  saveDeviceAlerts, signOutDevice, signOutOtherDevices, verifyDeviceCode } from '../../api/userApi';
import styles from './AccountDevices.module.css';

const eventNames = {
  login: 'Successful sign-in', new_device: 'New device sign-in', failed: 'Failed sign-in', logout: 'Signed out', terminated: 'Session terminated',
  otp_required: 'Sign-in code requested', otp_failed: 'Sign-in verification failed',
};
const dateTime = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
const formatTime = (value) => value ? dateTime.format(new Date(value)) : 'Unavailable';
const icons = { Mobile: Smartphone, Desktop: Laptop, Tablet };

function useModalDialog() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return ref;
}

function LoginActivity({ devices }) {
  const [query, setQuery] = useState({ date: '', device: '', before: null });
  const [result, setResult] = useState({ entries: [], next: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getLoginActivity({ ...query, signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setResult((current) => ({ ...data, entries: query.before ? [...current.entries, ...data.entries] : data.entries }));
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);

  function updateFilter(change) {
    setResult({ entries: [], next: null });
    setQuery((current) => ({ ...current, ...change, before: null }));
  }

  return (
    <section className={styles.section} aria-label="Login Activity">
      <h3>Login Activity</h3>
      <div className={styles.filters}>
        <label> Date (Philippine time)<input type="date" value={query.date} onChange={(event) => updateFilter({ date: event.target.value })} /></label>
        <label>Device<select value={query.device} onChange={(event) => updateFilter({ device: event.target.value })}>
          <option value="">All devices</option>
          <option value="unknown">Unrecognized device</option>
          {devices.map((device) => <option key={device.id} value={device.id}>
            {device.info.name} · {device.info.browser}{device.is_current ? ' (current)' : device.removed_at ? ' (removed)' : ''}
          </option>)}
        </select></label>
      </div>
      {result.entries.length > 0 && (
        <div className={styles.scroll} role="region" aria-label="Login records" tabIndex={0}>
          <ul className={styles.events}>
            {result.entries.map((entry) => (
              <li key={entry.id}>
                <span className={styles.eventTitle} data-event={entry.event_type}>{eventNames[entry.event_type]}</span>
                <time dateTime={entry.occurred_at}>{formatTime(entry.occurred_at)}</time>
                <small>{[entry.info.name, entry.info.browser, entry.info.location, entry.info.ip].filter(Boolean).join(' · ')}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {loading && <p role="status">Loading login activity…</p>}
      {error && <div className={styles.actions}><p role="alert">{error}</p><button type="button" onClick={() => setQuery({ ...query })}>Try again</button></div>}
      {!loading && !error && !result.entries.length && <p>No login activity matches these filters.</p>}
      {result.next && !error && <button type="button" disabled={loading} onClick={() => setQuery({ ...query, before: result.next })}>Load older activity <ChevronDown size={15} aria-hidden="true" /></button>}
    </section>
  );
}

function DeviceConfirmation({ pending, onClose, ...props }) {
  const dialogRef = useModalDialog();
  function dismiss(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!pending) onClose();
  }

  return <dialog ref={dialogRef} className={styles.confirmDialog} aria-labelledby="confirm-title"
    onCancel={dismiss} onKeyDown={(event) => { if (event.key === 'Escape') dismiss(event); }}>
    <ConfirmModal {...props} isOpen isDestructive inNativeDialog onClose={onClose} />
  </dialog>;
}

function AccountDevicesModal({ onClose }) {
  const dialogRef = useModalDialog();
  const titleId = useId();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [challenge, setChallenge] = useState(false);
  const [code, setCode] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getAccountDevices(controller.signal).then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [revision]);

  function reload() { setRevision((value) => value + 1); }

  async function run(operation, success) {
    setPending(true);
    setError('');
    setNotice('');
    try { await operation(); setNotice(success); }
    catch (err) { setError(err.message); throw err; }
    finally { setPending(false); }
  }

  const devices = data?.devices.filter((device) => !device.removed_at) || [];
  const otherActive = devices.some((device) => !device.is_current && device.active);
  const current = devices.find((device) => device.is_current);
  const activeAction = confirm?.type;
  const retry = !data && error;

  function sendCode() {
    void run(async () => { await requestDeviceCode(); setChallenge(true); }, 'Verification code sent to your account email.').catch(() => {});
  }

  function dismiss(event) {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId}
      onCancel={dismiss} onKeyDown={(event) => { if (event.key === 'Escape') dismiss(event); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <header className={styles.dialogHeader}>
        <h2 id={titleId}>Devices and sessions</h2>
        <button type="button" className={styles.closeButton} aria-label="Close devices and sessions" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={`${styles.dialogBody} ${styles.panel}`}>
      {!data && !error && <p role="status">Loading devices…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {retry && <button type="button" onClick={() => { setError(''); reload(); }}>Try again</button>}
      {data && <>
        <section className={styles.section} aria-label="Logged-in Devices">
          <h3>Logged-in Devices</h3>
          {!devices.length && <p>No devices have signed in yet.</p>}
          <ul className={styles.devices}>
            {devices.map((device) => {
              const Icon = icons[device.info.type] ?? Laptop;
              return <li key={device.id} className={styles.device}>
                <div className={styles.deviceHeading}>
                  <span className={styles.icon}><Icon size={20} aria-hidden="true" /></span>
                  <div><strong>{device.info.name}</strong><p>{device.info.type} · {device.info.browser} · {device.info.os}</p></div>
                </div>
                <div className={styles.badges}>
                  <span data-current={device.is_current}>{device.is_current ? 'Current Device' : 'Other Device'}</span>
                  <span>{device.active ? 'Active' : 'Signed out'}</span>
                  <span>{device.verified_at ? 'Verified' : 'Unverified'}</span>
                  <span>{device.trusted ? 'Trusted' : 'OTP required at sign-in'}</span>
                </div>
                <dl className={styles.details}>
                  <div><dt>Last sign-in</dt><dd>{formatTime(device.last_login_at)}</dd></div>
                  <div><dt>Last active</dt><dd>{formatTime(device.last_active_at)}</dd></div>
                  {device.created_at && <div><dt>Added</dt><dd>{formatTime(device.created_at)}</dd></div>}
                  {device.trusted && <div><dt>Trust expires</dt><dd>{formatTime(device.trust_expires_at)}</dd></div>}
                  {device.trusted && <div><dt>Trust last used</dt><dd>{formatTime(device.trust_last_used_at)}</dd></div>}
                  {device.info.ip && <div><dt>IP address</dt><dd>{device.info.ip}</dd></div>}
                  {device.info.location && <div><dt>Approximate location</dt><dd>{device.info.location}</dd></div>}
                </dl>
                {device.trusted && <div className={styles.actions}>
                  <button type="button" disabled={pending} onClick={() => setConfirm({ type: 'trust', device })}>Remove trust</button>
                </div>}
                {!device.is_current && <div className={styles.actions}>
                  {device.active && <button type="button" disabled={pending} onClick={() => setConfirm({ type: 'logout', device })}><LogOut size={15} aria-hidden="true" /> Sign out</button>}
                  <button type="button" disabled={pending} onClick={() => setConfirm({ type: 'remove', device })}><Trash2 size={15} aria-hidden="true" /> Remove</button>
                </div>}
              </li>;
            })}
          </ul>
          {current && !current.verified_at && <div className={styles.verification}>
            <p>Verify this device with a code sent to your account email.</p>
            <button type="button" onClick={sendCode} disabled={pending}><KeyRound size={16} aria-hidden="true" /> {challenge ? 'Send another code' : 'Send verification code'}</button>
            {challenge && <form className={styles.verifyForm} onSubmit={(event) => {
              event.preventDefault();
              void run(async () => { await verifyDeviceCode(code); setChallenge(false); setCode(''); reload(); }, 'This device is now verified.').catch(() => {});
            }}>
              <label>Verification code<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label>
              <button type="submit" disabled={pending || !/^\d{6}$/.test(code)}>Verify device</button>
            </form>}
          </div>}
        </section>
        <LoginActivity key={revision} devices={data.devices} />
        <section className={styles.section} aria-label="New Login Alerts">
          <h3>New Login Alerts</h3>
          <label className={styles.toggle}>
            <Bell size={17} aria-hidden="true" /> Email me when a new device signs in
            <input type="checkbox" checked={data.emailAlerts} disabled={pending} onChange={(event) => {
              const preference = event.target.checked;
              void run(async () => {
                const result = await saveDeviceAlerts(preference);
                setData((currentData) => ({ ...currentData, emailAlerts: result.emailAlerts }));
              }, 'Email preferences saved.').catch(() => {});
            }} />
          </label>
        </section>
        <section className={styles.section} aria-label="Session Management">
          <h3>Session Management</h3>
          <p>Sign out other devices while keeping this session active.</p>
          <button type="button" disabled={!otherActive || pending} onClick={() => setConfirm({ type: 'others' })}>
            <LogOut size={16} aria-hidden="true" /> Sign out of all other devices
          </button>
        </section>
      </>}
      </div>
      {confirm && <DeviceConfirmation pending={pending}
        title={activeAction === 'trust' ? 'Remove device trust?' : activeAction === 'remove' ? 'Remove device?' : 'Sign out devices?'}
        message={<>{activeAction === 'trust' ? 'This device will require an email code at its next sign-in.' :
          activeAction === 'others' ? 'All other devices will need to sign in again.' : `${confirm.device.info.name} will need to sign in again.${activeAction === 'remove' ? ' Its device verification will be removed.' : ''}`}{error && <><br /><strong role="alert">{error}</strong></>}</>}
        confirmLabel={activeAction === 'trust' ? 'Remove trust' : activeAction === 'remove' ? 'Remove device' : 'Sign out'}
        onClose={() => setConfirm(null)} onConfirm={() => run(async () => {
          if (activeAction === 'remove') await removeAccountDevice(confirm.device.id);
          else if (activeAction === 'trust') await revokeAccountDeviceTrust(confirm.device.id);
          else if (activeAction === 'logout') await signOutDevice(confirm.device.id);
          else await signOutOtherDevices();
          reload();
        }, activeAction === 'trust' ? 'Device trust removed.' : activeAction === 'remove' ? 'Device removed.' : 'Selected sessions ended.')}
      />}
    </dialog>
  );
}

export default function AccountDevices() {
  const [isOpen, setIsOpen] = useState(false);

  return <div className={styles.launcher}>
    <button type="button" className={styles.launchButton} aria-haspopup="dialog" onClick={() => setIsOpen(true)}>
      <Laptop size={17} aria-hidden="true" />
      Manage devices and sessions
      <ChevronRight size={17} aria-hidden="true" />
    </button>
    {isOpen && <AccountDevicesModal onClose={() => setIsOpen(false)} />}
  </div>;
}
