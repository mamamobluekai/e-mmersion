import { useState } from 'react';
import { downloadMyCertificate } from '../../../api/studentApi';
import { JourneyDownloads } from './StudentJourney';
import styles from './StudentJourney.module.css';

export default function Progress({ journey, documents = false }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { requirements, hours, attendance, documentation, evaluation, percent, certificate } = journey;
  const report = [
    ['Required immersion hours', `${hours.required} hours`],
    ['Scheduled immersion hours', `${hours.scheduled} hours`],
    ['Actual recorded work hours', `${hours.recorded} hours`],
    ['Validated hours credited', `${hours.credited} hours`],
    ['Attendance', `${attendance.completed} of ${attendance.total} days completed`],
    ['Daily documentation', `${documentation.completed} of ${documentation.total} reviewed`],
    ['Requirements', `${requirements.approved} of ${requirements.total} approved`],
    ['Final evaluation', evaluation.available ? 'Available' : 'Awaiting supervisor evaluation'],
    ['Overall immersion progress', `${percent}%`],
  ];

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

  if (documents) {
    return <JourneyDownloads issued={certificate.issued} busy={busy} message={message} onDownload={handleDownload} />;
  }

  return (
    <section className={styles.panel}>
      <h2>Immersion progress report</h2>
      <dl className={styles.report}>
        {report.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>{hours.recordedOnly ? 'Credited hours are based on recorded Time In and Time Out.' : 'Credited hours follow the schedule for each validated attendance day.'}</p>
    </section>
  );
}
