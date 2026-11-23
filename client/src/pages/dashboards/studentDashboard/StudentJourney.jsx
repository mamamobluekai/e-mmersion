import { Link, NavLink } from 'react-router-dom';
import { ArrowDown, ArrowRight, Check, Flag, LockKeyhole, MapPinned, Route } from 'lucide-react';
import styles from './StudentJourney.module.css';

const BASE = '/dashboard/student';
const STAGES = [
  {
    key: 'pre', path: 'pre-immersion', title: 'Pre-Immersion', icon: Flag,
    description: 'Complete your forms and submit the documents your coordinator needs to approve.',
    locked: '',
  },
  {
    key: 'immersion', path: 'immersion-proper', title: 'Immersion Proper', icon: Route,
    description: 'Check your placement and complete the attendance and documentation missions for each workday.',
    locked: 'Unlocks after your requirements are approved and your coordinator deploys your batch.',
  },
  {
    key: 'post', path: 'post-immersion', title: 'Post-Immersion', icon: MapPinned,
    description: 'Review your evaluation, check your final progress, and download your issued certificate.',
    locked: 'Unlocks when your scheduled missions and required hours are complete.',
  },
];

function stageCount(stage, journey) {
  if (stage === 'pre') return [journey.requirements.approved, journey.requirements.total];
  if (stage === 'immersion') {
    return [journey.attendance.completed + journey.documentation.completed, journey.days.length * 2];
  }
  return [Number(journey.evaluation.available), 1];
}

export function Roadmap({ journey }) {
  if (!journey) return <div className={styles.page}><h1 className={styles.loadingTitle}>Your immersion roadmap</h1></div>;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Work Immersion Journey</p>
          <h1>Your immersion roadmap</h1>
          <p>Follow your missions from coordinator approval to your final evaluation.</p>
        </div>
        <div className={styles.tracker}>
          <span>Journey progress</span>
          {journey.percent == null ? (
            <>
              <strong>{journey.completedMissions} missions completed</strong>
              <progress
                max={journey.requirements.total || 1}
                value={journey.requirements.approved}
                aria-label="Pre-Immersion approvals"
              />
              <small>The overall percentage appears when your schedule is available.</small>
            </>
          ) : (
            <>
              <strong>{journey.percent}%</strong>
              <progress max={100} value={journey.percent} aria-label="Overall journey progress" />
              <small>{journey.completedMissions} of {journey.totalMissions} missions completed</small>
            </>
          )}
        </div>
      </header>

      <ol className={styles.trail}>
        {STAGES.map((stage, index) => {
          const status = journey.stages[stage.key];
          const [completed, total] = stageCount(stage.key, journey);
          const Icon = status === 'locked' ? LockKeyhole : status === 'completed' ? Check : stage.icon;
          return (
            <li key={stage.key} className={styles.trailStep} data-stage-state={status}>
              <span className={styles.marker} aria-hidden="true"><Icon size={20} /></span>
              <article className={styles.stageCard}>
                <div className={styles.stageMeta}>
                  <span>Stage {index + 1}</span>
                  <span className={styles.stageBadge}>
                    {{ active: 'Current stage', completed: 'Completed', locked: 'Locked' }[status]}
                  </span>
                </div>
                <h2>{stage.title}</h2>
                <p>{stage.description}</p>
                <div className={styles.stageFooter}>
                  <small>
                    {status === 'locked'
                      ? stage.key === 'post' && journey.awaitingEvaluation
                        ? 'Waiting for the supervisor’s evaluation.'
                        : stage.key === 'immersion' && journey.requirements.complete
                          ? 'Waiting for your coordinator to deploy your batch.'
                          : stage.locked
                      : total > 0
                        ? `${completed} of ${total} missions completed`
                        : 'Waiting for your schedule.'}
                  </small>
                  {status !== 'locked' && (
                    <Link to={`${BASE}/${stage.path}`} className={styles.action}>
                      {status === 'completed' ? 'View stage' : 'Open stage'} <ArrowRight size={16} />
                    </Link>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const POST_SECTIONS = [
  { path: '', label: 'Progress Report' },
  { path: '/evaluation', label: 'Final Evaluation' },
  { path: '/documents', label: 'Documents' },
];

export function JourneyStage({ stage, children }) {
  const { title, path, description } = STAGES.find((item) => item.key === stage);
  return (
    <div className={styles.page}>
      {stage === 'post' && (
        <>
          <header className={styles.stageHeader}>
            <Link to={`${BASE}/roadmap`} className={styles.backLink}>← Roadmap</Link>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          <nav aria-label={`${title} sections`} className={styles.tabs}>
            {POST_SECTIONS.map((section) => (
              <NavLink key={section.path} to={`${BASE}/${path}${section.path}`} end>
                {section.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
      {children}
    </div>
  );
}

export function JourneyDownloads({ issued, busy, message, onDownload }) {
  return (
    <section className={styles.panel}>
      <h2>Downloadable documents</h2>
      <div className={styles.document}>
        <div>
          <h3>Certificate of Completion</h3>
          <p>{issued ? 'Your certificate is ready to download.' : 'Your certificate will appear here after it is issued.'}</p>
        </div>
        <button type="button" className={styles.action} disabled={!issued || busy} onClick={onDownload}>
          <ArrowDown size={16} /> {busy ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
