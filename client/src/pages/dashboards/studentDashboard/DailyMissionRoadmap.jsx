import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Circle, Clock3, TriangleAlert, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../../../hooks/useIsMobile';
import styles from './DailyMissionRoadmap.module.css';

const BASE = '/dashboard/student/immersion-proper';
const MANILA = 'Asia/Manila';
const shortDate = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: MANILA });
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: MANILA, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourLabel = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 });

const CHECKPOINTS = {
  completed: { label: 'Completed', Icon: Check },
  current: { label: 'Current workday', Icon: Circle },
  revision: { label: 'Needs revision', Icon: TriangleAlert },
  upcoming: { label: 'Upcoming', Icon: Clock3 },
  progress: { label: 'In progress', Icon: Circle },
};

function documentationTaskStatus(status) {
  return status === 'Submitted' ? 'Completed' : status;
}

function checkpointState(day, today) {
  const { attendance, documentation } = day;
  if (attendance.status === 'Completed' && documentationTaskStatus(documentation.status) === 'Completed') return 'completed';
  if ([attendance.status, documentation.status].includes('Needs Revision')) return 'revision';
  if (day.date > today) return 'upcoming';
  return day.date === today ? 'current' : 'progress';
}

function checkpointPosition(index, isMobile) {
  if (isMobile) return { x: 72 + index * 136, y: index % 2 === 0 ? 46 : 62 };
  const row = Math.floor(index / 4);
  const column = row % 2 ? 3 - index % 4 : index % 4;
  return { x: 135 + column * (730 / 3), y: 64 + row * 166 };
}

function trailSegment(from, to, isMobile) {
  const start = `M ${from.x} ${from.y}`;
  if (isMobile) {
    const midpoint = (from.x + to.x) / 2;
    return `${start} C ${midpoint} ${from.y} ${midpoint} ${to.y} ${to.x} ${to.y}`;
  }
  if (from.y === to.y) return `${start} H ${to.x}`;
  const outer = from.x < 500 ? 23 : 977;
  return `${start} C ${outer} ${from.y} ${outer} ${to.y} ${to.x} ${to.y}`;
}

function MissionDetails({ checkpoint, inline, reveal, onClose }) {
  const { day, state } = checkpoint;
  const { attendance, documentation } = day;
  const panelRef = useRef(null);
  const { date, teacher_batch_id: batchId } = day;
  const query = new URLSearchParams({ date, batch: String(batchId) }).toString();
  const Panel = inline ? 'section' : 'dialog';
  const missions = [
    { label: 'Attendance', path: 'attendance', status: attendance.status },
    { label: 'Daily Documentation', path: 'daily-documentation', status: documentationTaskStatus(documentation.status) },
  ];
  const completed = missions.filter((mission) => mission.status === 'Completed').length;

  useEffect(() => {
    const panel = panelRef.current;
    if (inline && reveal) {
      panel.firstElementChild?.scrollIntoView({ block: 'nearest' });
    } else if (!inline && !panel.open) {
      panel.showModal();
    }
  }, [inline, reveal]);

  function closeDetails() {
    panelRef.current.close();
    onClose();
  }

  return (
    <Panel
      ref={panelRef}
      id="daily-mission-details"
      className={inline ? styles.inlineDetails : styles.dialog}
      aria-labelledby="daily-mission-title"
      onCancel={inline ? undefined : (event) => { event.preventDefault(); closeDetails(); }}
    >
      <header className={styles.detailHeader}>
        <div>
          <h2 id="daily-mission-title">Daily tasks</h2>
          <p>Record your time in and out, and submit a short work reflection with evidence.</p>
          <span className={styles.detailState} data-state={state}>
            {state === 'completed' ? 'Day completed' : `${completed} of 2 missions complete`}
          </span>
        </div>
        {!inline && (
          <button className={styles.close} type="button" onClick={closeDetails} aria-label="Close mission details"><X size={21} /></button>
        )}
      </header>

      <ul className={styles.missionList}>
        {missions.map((mission) => {
          const done = mission.status === 'Completed';
          const upcoming = state === 'upcoming';
          return (
            <li className={styles.mission} key={mission.path}>
              <div className={styles.missionHeading}>
                <h3>{mission.label}</h3>
                <span data-status={mission.status}>{upcoming ? 'Upcoming' : mission.status}</span>
              </div>
              {done ? (
                <span className={styles.checkDone} aria-hidden="true"><Check size={19} /></span>
              ) : !upcoming ? (
                <Link
                  className={styles.missionLink}
                  to={`${BASE}/${mission.path}?${query}`}
                  aria-label={`Go to ${mission.label}`}
                >
                  Go <ArrowRight size={15} aria-hidden="true" />
                </Link>
              ) : (
                <Clock3 className={styles.missionClock} size={19} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export default function DailyMissionRoadmap({ journey }) {
  const { days, attendance, documentation, hours } = journey;
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState(null);
  const viewportRef = useRef(null);
  const priorityRef = useRef(null);
  const today = dateKey.format(new Date());
  const checkpoints = days.map((day, index) => ({
    key: `${day.teacher_batch_id}:${day.date}`,
    day,
    state: checkpointState(day, today),
    position: checkpointPosition(index, isMobile),
  }));
  const last = checkpoints.at(-1);
  const priority = checkpoints.find(({ day }) => day.date >= today) ?? last;
  const priorityKey = priority?.key;
  const chosen = checkpoints.find((checkpoint) => checkpoint.key === selected);
  const active = chosen ?? (isMobile ? priority : null);
  const height = isMobile ? 172 : (last?.position.y ?? 0) + 116;
  const viewWidth = isMobile ? (last?.position.x ?? 0) + 72 : 1000;
  const credited = Math.min(hours.credited, hours.required);
  const documentationCompleted = days.filter((day) => documentationTaskStatus(day.documentation.status) === 'Completed').length;

  useLayoutEffect(() => {
    if (!isMobile || !priorityKey) return;
    const viewport = viewportRef.current;
    const checkpoint = priorityRef.current;
    viewport.scrollLeft = checkpoint.offsetLeft - viewport.clientWidth / 2;
  }, [isMobile, priorityKey, viewWidth]);

  return (
    <section className={styles.roadmap} aria-labelledby="daily-roadmap-title">
      <header className={styles.summary}>
        <div>
          <h1 id="daily-roadmap-title">Daily missions</h1>
          <p>Select a scheduled workday to see its attendance and documentation.</p>
        </div>
        <dl className={styles.totals}>
          <div><dt>Attendance days</dt><dd>{attendance.completed}/{attendance.total}</dd></div>
          <div><dt>Documentation entries</dt><dd>{documentationCompleted}/{documentation.total}</dd></div>
        </dl>
        <div className={styles.hours}>
          <label htmlFor="credited-immersion-hours">
            <strong>{hourLabel.format(hours.credited)} of {hourLabel.format(hours.required)}</strong> required hours credited
          </label>
          <progress id="credited-immersion-hours" value={credited} max={hours.required || 1} />
        </div>
      </header>

      {last ? (
        <div
          ref={viewportRef}
          className={styles.boardViewport}
          role={isMobile ? 'region' : undefined}
          aria-label={isMobile ? 'Scheduled workdays' : undefined}
          tabIndex={isMobile ? 0 : undefined}
        >
          <div className={styles.board} style={{ height, width: isMobile ? viewWidth : undefined }}>
            <svg
              className={styles.trail}
              viewBox={`0 0 ${viewWidth} ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {checkpoints.slice(1).map(({ key, position, state }, index) => (
                <path
                  key={key}
                  className={styles.segment}
                  data-earned={checkpoints[index].state === 'completed' && state === 'completed'}
                  d={trailSegment(checkpoints[index].position, position, isMobile)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {checkpoints.map(({ key, day, state, position }) => {
              const { label, Icon } = CHECKPOINTS[state];
              return (
                <button
                  key={key}
                  ref={key === priorityKey ? priorityRef : undefined}
                  type="button"
                  className={styles.checkpoint}
                  data-state={state}
                  style={{ left: `${position.x / viewWidth * 100}%`, top: position.y }}
                  onClick={() => setSelected(key)}
                  aria-haspopup={isMobile ? undefined : 'dialog'}
                  aria-current={day.date === today ? 'date' : undefined}
                  aria-expanded={isMobile ? active?.key === key : undefined}
                  aria-controls={isMobile && active?.key === key ? 'daily-mission-details' : undefined}
                >
                  <span className={styles.node} aria-hidden="true"><Icon size={21} /></span>
                  <span className={styles.checkpointText}>
                    <strong>Day {day.number}</strong>
                    <time dateTime={day.date}>{shortDate.format(new Date(day.date))}</time>
                    <span className={styles.checkpointStatus}>{label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : <p className={styles.empty}>Your workdays will appear when your batch schedule is published.</p>}
      {active && (
        <MissionDetails
          key={active.key}
          checkpoint={active}
          inline={isMobile}
          reveal={Boolean(chosen)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
