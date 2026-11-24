import { useState } from 'react';
import { Award, Check, Clock3, Download } from 'lucide-react';
import { downloadMyCertificate } from '../../../api/studentApi';
import styles from './Certifications.module.css';

export default function Certifications({ issued }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const StatusIcon = issued ? Check : Clock3;

  async function handleDownload() {
    setBusy(true);
    setMessage('');
    try {
      const { blob, filename } = await downloadMyCertificate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Certifications</h1>
        <p>Your official work immersion certificate</p>
      </header>

      <section className={styles.card} aria-labelledby="completion-certificate-title">
        <div className={styles.emblem} aria-hidden="true"><Award size={38} strokeWidth={1.6} /></div>
        <div className={styles.details}>
          <h2 id="completion-certificate-title">Certificate of Completion</h2>
          <p>{issued ? 'Save a copy for your records.' : 'You can download your certificate once it’s issued.'}</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.status} data-issued={issued} role="status">
            <StatusIcon size={15} aria-hidden="true" />
            {issued ? 'Issued' : 'Awaiting issuance'}
          </span>
          <button type="button" className={styles.download} disabled={!issued || busy} onClick={handleDownload}>
            <Download size={17} aria-hidden="true" />
            {busy ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
        {message && <p className={styles.error} role="alert">{message}</p>}
      </section>
    </div>
  );
}
