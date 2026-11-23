import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, ClipboardList, UsersRound } from 'lucide-react';
import { partnerDeploymentApi } from '../../../api/partnerDeploymentApi';
import styles from './SupervisorDashboard.module.css';

const requestPath = '/dashboard/supervisor/deployment-requests';
const institutionsPath = '/dashboard/supervisor/partner-institutions';

function buildReminders(requests, assignments) {
  const reminders = [];
  for (const request of requests) {
    const context = [request.partner_name, request.reference, request.coordinator_name].filter(Boolean).join(' · ');
    if (request.status === 'pending') {
      reminders.push({
        key: `proposal-${request.id}`, icon: ClipboardList,
        title: request.previous_proposal ? 'Review revised proposal' : 'Review new proposal',
        context, date: request.submitted_at || request.updated_at, to: `${requestPath}?request=${request.id}`,
      });
    }
    const amendment = request.schedule_amendment;
    if (amendment && ['approved', 'ongoing'].includes(request.status) && amendment.proposed_by === request.coordinator_id) {
      reminders.push({
        key: `amendment-${request.id}`, icon: CalendarDays, title: 'Review schedule amendment',
        context, date: request.updated_at, to: `${institutionsPath}?request=${request.id}`,
      });
    }
  }

  const pending = new Map();
  for (const assignment of assignments) {
    if (assignment.status !== 'pending') continue;
    const id = assignment.deployment_request_id;
    const group = pending.get(id) || { assignment, count: 0, date: assignment.submitted_at };
    group.count += 1;
    if (Date.parse(assignment.submitted_at) > Date.parse(group.date)) group.date = assignment.submitted_at;
    pending.set(id, group);
  }
  for (const [id, { assignment, count, date }] of pending) {
    reminders.push({
      key: `students-${id}`, icon: UsersRound, title: `Review ${count} student ${count === 1 ? 'assignment' : 'assignments'}`,
      context: [assignment.partner_name, assignment.request_reference, assignment.coordinator_name].filter(Boolean).join(' · '),
      date, to: `${requestPath}?request=${id}&students=1`,
    });
  }

  return reminders.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

export default function SupervisorReminders() {
  const [result, setResult] = useState({ loading: true, requests: [], assignments: [] });

  useEffect(() => {
    let active = true;
    let latest = 0;
    async function load() {
      const version = ++latest;
      const [requests, assignments] = await Promise.allSettled([
        partnerDeploymentApi('supervisor'),
        partnerDeploymentApi('supervisor', '/student-approvals'),
      ]);
      if (!active || version !== latest) return;
      setResult((previous) => ({
        loading: false,
        error: requests.status === 'rejected' || assignments.status === 'rejected',
        requests: requests.status === 'fulfilled' ? requests.value.requests || [] : previous.requests,
        assignments: assignments.status === 'fulfilled' ? assignments.value.assignments || [] : previous.assignments,
      }));
    }
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);

  const reminders = buildReminders(result.requests, result.assignments);

  return <section className={styles.reminders} aria-labelledby="supervisor-reminders-title">
    <h2 id="supervisor-reminders-title">Reminders</h2>
    {result.loading && <p className={styles.reminderMessage} role="status">Checking for items that need your review…</p>}
    {result.error && <p className={styles.reminderMessage} role="alert">Some reminders could not be loaded.</p>}
    {!result.loading && !result.error && reminders.length === 0 &&
      <p className={styles.reminderMessage}>No items need your review right now.</p>}
    {reminders.length > 0 && <ul className={styles.reminderList}>
      {reminders.map(({ key, icon: Icon, title, context, to }) => <li key={key}>
        <Link to={to} className={styles.reminderLink}>
          <span className={styles.reminderIcon}><Icon size={18} aria-hidden="true" /></span>
          <span><strong>{title}</strong><small>{context}</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </Link>
      </li>)}
    </ul>}
  </section>;
}
