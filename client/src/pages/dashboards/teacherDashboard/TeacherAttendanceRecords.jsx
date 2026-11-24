import { RefreshCw } from 'lucide-react';
import { useTeacherAttendanceReport } from '../../../hooks/useTeacherAttendanceReport';
import { getAttendanceLabel, hasAppeal, formatShortDate } from '../../../utils/attendanceAnalytics';
import styles from './AttendanceReportsRecords.module.css';

function TeacherAttendanceRecords({ variant = 'panel', report: reportProp }) {
  const own = useTeacherAttendanceReport({ enabled: !reportProp });
  const report = reportProp || own;

  const { dates, rows, loading, refreshing, error } = report;
  const refresh = report.refresh || own.refresh;
  const refreshButton = (className) => (
    <button type="button" className={className} onClick={refresh} disabled={loading || refreshing}>
      <RefreshCw size={16} className={refreshing ? styles.spin : ''} aria-hidden="true" />
      {refreshing ? 'Refreshing…' : 'Refresh records'}
    </button>
  );

  const grid = (
    <>
      {loading ? <p className={styles.state}>Loading attendance records…</p> : !dates.length ? <p className={styles.state}>No agreed workdays are available for this deployment.</p> : !rows.length ? <p className={styles.state}>No students are assigned to these workdays.</p> : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Student</th><th>Student ID</th><th>Grade / Strand</th>{dates.map((date) => <th key={date}>{formatShortDate(date)}</th>)}</tr></thead>
            <tbody>
              {rows.map((student) => (
                <tr key={student.student_id}>
                  <td className={styles.studentName}>{student.first_name} {student.last_name}</td>
                  <td>{student.student_number || '-'}</td>
                  <td>{[student.grade_level, student.track_strand].filter(Boolean).join(' / ') || '-'}</td>
                  {dates.map((date) => {
                    const record = student.attendance[date];
                    const value = record ? getAttendanceLabel(record.status, date) : 'Not assigned';
                    const statusClass = {
                      Absent: styles.absent, Late: styles.late, Present: styles.present,
                      In: styles.present, 'Not Started': styles.upcoming,
                    }[value] || styles.unrecorded;
                    return (
                      <td key={date} className={styles.statusCell}>
                        <span className={`${styles.status} ${statusClass}`}>{value}</span>
                        {hasAppeal(record) && <span className={styles.appealMark}>Appeal</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  if (variant === 'body') {
    return (
      <div>
        {refreshButton(styles.bodyRefreshButton)}
        {error ? <div className={styles.error} role="alert">{error}</div> : grid}
      </div>
    );
  }

  return (
    <div>
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.reportPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>ATTENDANCE RECORDS</span>
            <h2>{dates.length} scheduled immersion dates</h2>
            <p>Every enrolled student is shown against each scheduled work immersion date.</p>
          </div>
          <div className={styles.headerTools}>
            <div className={styles.legend}>
              <span><i className={styles.presentDot} />Present</span>
              <span><i className={styles.absentDot} />Absent</span>
              <span><i className={styles.appealDot} />Appeal</span>
            </div>
            {refreshButton(styles.refreshButton)}
          </div>
        </div>

        {!error && grid}
      </section>
    </div>
  );
}

export default TeacherAttendanceRecords;
