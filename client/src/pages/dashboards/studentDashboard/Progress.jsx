import styles from './StudentJourney.module.css';

export default function Progress({ journey }) {
  const { requirements, hours, attendance, documentation, evaluation, percent } = journey;
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

  return (
    <section className={styles.panel}>
      <h1>Immersion progress report</h1>
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
