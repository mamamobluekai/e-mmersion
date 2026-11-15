import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getCoordinatorDashboard } from '../../../api/coordinatorApi';
import { useAuth } from '../../../context/AuthContext';
import styles from './CoordinatorOverview.module.css';

const ROUTES = {
  students: '/dashboard/coordinator/students',
  requirements: '/dashboard/coordinator/requirements',
  batches: '/dashboard/coordinator/batches',
  supervisors: '/dashboard/coordinator/supervisors',
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function LoadingCard() {
  return (
    <div className={styles.loadingCard} role="status">
      <span className={styles.loadingPulse} />
      <span>Preparing your overview...</span>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className={styles.errorState} role="alert">
      <AlertCircle size={20} />
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        <RefreshCw size={15} /> Try again
      </button>
    </div>
  );
}

function CoordinatorOverview() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getCoordinatorDashboard());
    } catch (err) {
      setError(err.message || 'Unable to load your dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const firstName = user?.first_name || user?.email?.split('@')[0] || 'Coordinator';

  const requirements = useMemo(() => data?.requirements || {}, [data]);
  const requirementsTrend = useMemo(() => data?.requirementsTrend || [], [data]);

  return (
    <div className={styles.dashboard}>
      <section className={styles.greeting}>
        <div>
          <h1>
            {getGreeting()}, {firstName}! <span aria-hidden="true">👋</span>
          </h1>
          <p>Stay on top of today’s priorities with a quick overview of approvals, student requirements, and batch activities.
          </p>
        </div>
      </section>

      {loading && <LoadingCard />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && data && (
        <>

          <div className={styles.contentGrid}>
            <div className={styles.mainColumn}>
              <section className={styles.card}>
                <div className={`${styles.cardHeader} ${styles.chartHeader}`}>
                  <h2>Requirements Overview</h2>
                </div>
                <div className={styles.summaryRow} aria-label="Key coordinator metrics">
                  <div className={styles.summaryItem}><strong>{requirements.pendingReview || 0}</strong><span>Pending review</span></div>
                  <div className={styles.summaryItem}><strong>{requirements.approved || 0}</strong><span>Approved</span></div>
                </div>
                <div className={styles.lineChartWrap}>
                  {requirementsTrend.length ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={requirementsTrend} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eadde0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#596579' }} tickLine={false} axisLine={{ stroke: '#eadde0' }} minTickGap={18} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#596579' }} tickLine={false} axisLine={false} width={28} />
                        <Tooltip contentStyle={{ border: '1px solid #eadde0', borderRadius: 11, fontSize: 12, color: '#172033' }} />
                        <Line type="monotone" dataKey="submitted" name="Submitted" stroke="#be8c3f" strokeWidth={2.2} dot={{ r: 2, fill: '#be8c3f' }} activeDot={{ r: 4 }} />
                        <Line type="monotone" dataKey="approved" name="Approved" stroke="#8b1e2d" strokeWidth={2.2} dot={{ r: 2, fill: '#8b1e2d' }} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className={styles.emptyState}><p>No requirement activity yet.</p></div>
                  )}
                </div>
                <Link className={styles.reviewButton} to={ROUTES.requirements}>Open requirements review<ArrowRight size={17} /></Link>
              </section>
            </div>

            <section className={styles.roleSection} aria-label="Coordinator responsibilities">
              <div className={styles.roleCard}>
                <p className={styles.cardEyebrow}>STUDENT APPROVALS</p>
                <p>Review and approve student accounts so learners can access the work immersion system and begin submitting requirements.</p>
              </div>
              <div className={styles.roleCard}>
                <p className={styles.cardEyebrow}>REQUIREMENTS REVIEW</p>
                <p>Check submitted documents, provide feedback, and mark requirements as approved, under review, or needing revision.</p>
              </div>
              <div className={styles.roleCard}>
                <p className={styles.cardEyebrow}>PLACEMENT COORDINATION</p>
                <p>Organize teacher batches, monitor capacity, and coordinate deployment requests to support student immersion placement.</p>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default CoordinatorOverview;
