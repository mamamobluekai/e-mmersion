import { useEffect, useState } from 'react';
import { submitLoginOtp } from '../../api/authApi';
import styles from './LoginOtpForm.module.css';

export default function LoginOtpForm({ initialChallenge, role, onSuccess, onBack, submitClass }) {
  const [challenge, setChallenge] = useState(initialChallenge);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil((Date.parse(challenge.resendAt) - now) / 1000));
  const expired = now >= Date.parse(challenge.expiresAt);
  const canVerify = !pending && !expired && code.length === 6;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function submit(action) {
    if (pending || (action === 'verify' && !canVerify) || (action === 'resend' && remaining)) return;
    setPending(action);
    setError('');
    setNotice('');
    try {
      const payload = { challengeId: challenge.challengeId };
      if (action === 'verify') Object.assign(payload, { code, trustDevice });
      const result = await submitLoginOtp(action, payload);
      if (action === 'resend') {
        setChallenge(result);
        setCode('');
        setNotice('A new sign-in code was sent.');
        return;
      }
      if (result.user?.role !== role || !result.accessToken) throw new Error('Return to sign in and try again.');
      onSuccess(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending('');
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit('verify'); }}>
      <h2>Verify your sign-in</h2>
      <p>Enter the six-digit code sent to <strong>{challenge.maskedEmail}</strong>.</p>
      {expired && <p role="status">This code expired. Request a new one to continue.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label className={styles.code}>
        Sign-in code
        <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          disabled={Boolean(pending)} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
      </label>
      <label className={styles.trust}>
        <input type="checkbox" checked={trustDevice} disabled={Boolean(pending)}
          onChange={(event) => setTrustDevice(event.target.checked)} />
        Trust this device for 30 days
      </label>
      <small>Skip the code on future sign-ins in this browser. Leave this unchecked on public or shared devices.</small>
      <button type="submit" className={submitClass} disabled={!canVerify}>
        {pending === 'verify' ? 'Verifying…' : 'Verify'}
      </button>
      <div className={styles.actions}>
        <button type="button" disabled={Boolean(pending)} onClick={onBack}>Back to login</button>
        <button type="button" disabled={Boolean(pending) || remaining > 0} onClick={() => void submit('resend')}>
          {pending === 'resend' ? 'Sending…' : remaining ? `Resend code in ${remaining}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}
