import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, ClipboardList, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { usePartnerInstitution } from '../../../hooks/usePartnerInstitution';
import { useTeacherAttendanceReport } from '../../../hooks/useTeacherAttendanceReport';
import { getMyTeacherBatch, getTeacherBatchStatus } from '../../../api/teacherApi';
import ImmersionScheduleCalendar from './ImmersionScheduleCalendar';
import TeacherAttendanceRecords from './TeacherAttendanceRecords';
import AttendanceInsights from './AttendanceInsights';
import styles from './TeacherAttendance.module.css';

function attendanceError(error, fallback) {
  if (error.response?.status === 401) return 'Your session has expired. Please sign in again.';
  return error.response?.data?.error || fallback;
}

function DeploymentAttendance({ batch, institutionName, token }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const report = useTeacherAttendanceReport({ batchId: batch.id });

  useEffect(() => {
    const request = new AbortController();
    let timer;
    async function loadStatus() {
      try {
        const data = await getTeacherBatchStatus(batch.id, token, request.signal);
        if (request.signal.aborted) return;
        setStatus(data);
        setStatusError('');
      } catch (error) {
        if (request.signal.aborted) return;
        setStatus(null);
        setStatusError(attendanceError(error, 'Could not load live attendance status.'));
      }
      if (!request.signal.aborted) timer = setTimeout(loadStatus, 15000);
    }
    loadStatus();
    return () => {
      request.abort();
      clearTimeout(timer);
    };
  }, [batch.id, token]);

  useEffect(() => {
    if (!recordsOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setRecordsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [recordsOpen]);

  const windows = status?.schedule;
  const supervisor = [batch.supervisor?.first_name, batch.supervisor?.last_name].filter(Boolean).join(' ');
  const statusText = {
    time_in: 'Time-in is open',
    time_out: 'Time-out is open',
  };
  const liveStatusText = status?.scheduled_today === false
    ? 'No agreed workday today'
    : status?.manual_open
      ? 'Manually opened'
      : statusText[status?.active_type] || 'Outside attendance windows';

  return (
    <>
      {statusError && <p className={styles.error} role="alert">{statusError}</p>}
      {status && (
        <div className={`${styles.liveStatus} ${status.attendance_open ? styles.liveStatusOpen : styles.liveStatusClosed}`}>
          <span className={styles.liveStatusPill}>{status.attendance_open ? 'Open' : 'Closed'}</span>
          <span className={styles.liveStatusText}>{liveStatusText}</span>
        </div>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.scheduleHeading}>
            <h3 className={styles.panelTitle}>Work Immersion Schedule</h3>
            {supervisor && <p className={styles.scheduleSummary}>{supervisor}</p>}
          </div>
          {windows && (
            <div className={styles.windowSummary}>
              <span className={styles.windowLabel}>Attendance Windows</span>
              <span className={styles.windowValue}>
                <span className={styles.windowTag}>Time In</span>
                {windows.time_in.open.slice(0, 5)}–{windows.time_in.close.slice(0, 5)}
              </span>
              <span className={styles.windowValue}>
                <span className={styles.windowTag}>Time Out</span>
                {windows.time_out.open.slice(0, 5)}–{windows.time_out.close.slice(0, 5)}
              </span>
              <span className={styles.windowNote}>{status.timezone}</span>
            </div>
          )}
        </div>

        <div className={styles.supervisorGroup}>
          <div className={styles.groupButtons}>
            <button
              type="button"
              className={styles.scheduleButton}
              disabled={!report.dates.length}
              onClick={() => setCalendarOpen(true)}
            >
              <CalendarDays size={18} strokeWidth={2} aria-hidden="true" />
              <span className={styles.scheduleButtonText}>
                <strong>View Immersion Schedule</strong>
                <span>{report.dates.length} agreed workdays</span>
              </span>
            </button>
            <button type="button" className={styles.scheduleButton} onClick={() => setRecordsOpen(true)}>
              <ClipboardList size={18} strokeWidth={2} aria-hidden="true" />
              <span className={styles.scheduleButtonText}>
                <strong>View Attendance Records</strong>
                <span>Attendance by student and workday</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      {report.error
        ? <p className={styles.error} role="alert">{report.error}</p>
        : <AttendanceInsights report={report} />}

      {calendarOpen && report.dates.length > 0 && (
        <ImmersionScheduleCalendar
          dates={report.dates}
          title={batch.batch_label}
          institutionName={institutionName}
          onClose={closeCalendar}
        />
      )}

      {recordsOpen && (
        <div
          className={styles.calOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRecordsOpen(false);
          }}
        >
          <section
            className={`${styles.calModal} ${styles.calModalWide}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-records-title"
          >
            <div className={styles.calHeader}>
              <div className={styles.calIdentity}>
                <span className={styles.calHeaderIcon} aria-hidden="true"><ClipboardList size={20} strokeWidth={2} /></span>
                <div>
                  <h2 id="attendance-records-title">Scheduled Immersion Attendance</h2>
                  <p>{batch.batch_label}</p>
                </div>
              </div>
              <button
                type="button"
                className={styles.calClose}
                onClick={() => setRecordsOpen(false)}
                aria-label="Close attendance records"
              >
                <X size={18} />
              </button>
            </div>
            <div className={styles.calBody}>
              <TeacherAttendanceRecords variant="body" report={report} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function InstitutionAttendance({ batches, institutionName, token }) {
  const [selectedId, setSelectedId] = useState(null);
  const batch = batches.find(({ id }) => id === selectedId) || batches[0];

  if (!batch) return <p className={styles.info}>No published deployments are assigned to you at this institution.</p>;

  return (
    <>
      {batches.length > 1 && (
        <label className={styles.deploymentPicker}>
          Deployment
          <select value={batch.id} onChange={(event) => setSelectedId(Number(event.target.value))}>
            {batches.map(({ id, batch_label }) => <option key={id} value={id}>{batch_label}</option>)}
          </select>
        </label>
      )}
      <DeploymentAttendance key={batch.id} batch={batch} institutionName={institutionName} token={token} />
    </>
  );
}

function TeacherAttendance() {
  const { token } = useAuth();
  const { institutionId, institutionName, loading, error } = usePartnerInstitution();
  const [deployments, setDeployments] = useState(null);
  const current = deployments?.token === token ? deployments : null;

  useEffect(() => {
    if (!token) return undefined;
    const request = new AbortController();
    getMyTeacherBatch(token, request.signal)
      .then((data) => {
        if (!request.signal.aborted) setDeployments({ token, batches: data.batches || [] });
      })
      .catch((err) => {
        if (!request.signal.aborted) {
          setDeployments({ token, error: attendanceError(err, 'Could not load your published deployments.') });
        }
      });
    return () => request.abort();
  }, [token]);

  const loadError = error || current?.error;
  const isLoading = loading || Boolean(institutionId && token && !current);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Attendance Monitor</h2>
          <p className={styles.pageDescription}>View attendance windows and records for your assigned deployments.</p>
        </div>
      </div>

      {loadError ? (
        <p className={styles.error} role="alert">{loadError}</p>
      ) : isLoading ? (
        <p className={styles.info}>Loading attendance deployments…</p>
      ) : !institutionId ? (
        <p className={styles.info}>You are not assigned to a partner institution yet.</p>
      ) : current?.batches && (
        <InstitutionAttendance
          key={institutionId}
          batches={current.batches.filter((batch) => batch.partner_institution_id === institutionId)}
          institutionName={institutionName}
          token={token}
        />
      )}
    </div>
  );
}

export default TeacherAttendance;
