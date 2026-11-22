import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getMyJourney } from '../../../api/studentApi';
import PartnerChat from '../../../components/social/PartnerChat';
import About from '../About';
import Announcements from '../Announcements/Announcements';
import UserProfileSettings from '../UserProfileSettings';
import DashboardLayout from '../sharedSidebar/DashboardLayout';
import DashboardTopNav from '../sharedSidebar/DashboardTopNav';
import Attendance from './Attendance';
import DailyDocumentation from './DailyDocumentation';
import Guide from './Guide';
import PlacementStatus from './PlacementStatus';
import Progress from './Progress';
import Requirements from './Requirements';
import StudentEvaluation from './StudentEvaluation';
import { JourneyStage, Roadmap } from './StudentJourney';
import DailyMissionRoadmap from './DailyMissionRoadmap';
import StudentMobileNav from './StudentMobileNav';
import StudentSettings, { StudentSettingsBackButton } from './StudentSettings';
import StudentSidebar from './StudentSidebar';
import StudentTermsAndAgreement from './StudentTermsAndAgreement';

const BASE = '/dashboard/student';
const LEGACY_ROUTES = {
  overview: 'roadmap',
  requirements: 'pre-immersion/requirements',
  'placement-status': 'immersion-proper/placement-status',
  attendance: 'immersion-proper/attendance',
  'daily-documentation': 'immersion-proper/daily-documentation',
  progress: 'post-immersion',
  evaluation: 'post-immersion/evaluation',
  profile: 'settings/profile',
};

function StageAccess({ stage, journey, children }) {
  if (!journey) return null;
  if (journey.stages[stage] === 'locked') {
    return <Navigate to={`${BASE}/roadmap`} replace />;
  }
  return children;
}

function StudentDashboard({ user, onLogout }) {
  const [journey, setJourney] = useState(null);
  const [error, setError] = useState('');
  const request = useRef(null);
  const { pathname } = useLocation();

  const refreshJourney = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const nextJourney = await getMyJourney(controller.signal);
      if (!controller.signal.aborted) {
        setJourney(nextJourney);
        setError('');
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message);
    }
  }, []);

  useEffect(() => {
    refreshJourney();
    return () => request.current?.abort();
  }, [pathname, refreshJourney]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshJourney();
    };
    const interval = window.setInterval(refreshWhenVisible, 30000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshJourney]);

  const stagePage = (stage, content) => (
    <StageAccess stage={stage} journey={journey}>
      <JourneyStage stage={stage}>{content}</JourneyStage>
    </StageAccess>
  );
  const immersionUnlocked = Boolean(journey && journey.stages.immersion !== 'locked');

  return (
    <DashboardLayout
      topNav={<DashboardTopNav user={user} onLogout={onLogout} title="Student Dashboard" hideProfileOnMobile />}
      sidebar={<StudentSidebar stages={journey?.stages} />}
      enableMobileKeyboardFocus
      compactGutters={pathname === `${BASE}/roadmap` || pathname === `${BASE}/immersion-proper`}
    >
      {error && (
        <p role="alert">
          {error}{' '}<button type="button" onClick={refreshJourney}>Try again</button>
        </p>
      )}
      {!journey && !error && <p role="status">Loading your immersion journey…</p>}
      {!journey && error && <p><Link to={`${BASE}/pre-immersion`}>Open Pre-Immersion</Link></p>}
      <Routes>
        <Route index element={<Navigate to="roadmap" replace />} />
        <Route path="roadmap" element={<Roadmap journey={journey} />} />
        <Route path="pre-immersion" element={<JourneyStage stage="pre"><Requirements key="missions" checklistOnly /></JourneyStage>} />
        <Route path="pre-immersion/requirements" element={<JourneyStage stage="pre"><Requirements key="forms" /></JourneyStage>} />
        <Route path="immersion-proper" element={stagePage('immersion', journey && <DailyMissionRoadmap journey={journey} />)} />
        <Route path="immersion-proper/placement-status" element={stagePage('immersion', <PlacementStatus />)} />
        <Route path="immersion-proper/attendance" element={stagePage('immersion', <Attendance />)} />
        <Route path="immersion-proper/daily-documentation" element={stagePage('immersion', <DailyDocumentation />)} />
        <Route path="post-immersion" element={stagePage('post', journey && <Progress journey={journey} />)} />
        <Route path="post-immersion/evaluation" element={stagePage('post', <StudentEvaluation />)} />
        <Route path="post-immersion/documents" element={stagePage('post', journey && <Progress journey={journey} documents />)} />

        <Route path="group-chat" element={<StageAccess stage="immersion" journey={journey}><BatchChat user={user} /></StageAccess>} />
        <Route path="announcements" element={<><Announcements user={user} /><StudentSettingsBackButton /></>} />
        <Route path="guide" element={<><Guide /><StudentSettingsBackButton /></>} />
        <Route path="about" element={<><About user={user} /><StudentSettingsBackButton /></>} />
        <Route path="settings" element={<StudentSettings immersionUnlocked={immersionUnlocked} />} />
        <Route path="settings/profile" element={<UserProfileSettings section="profile" />} />
        <Route path="settings/security" element={<UserProfileSettings section="security" />} />
        <Route path="settings/additional" element={<UserProfileSettings section="additional" />} />
        <Route path="settings/terms" element={<StudentTermsAndAgreement />} />
        {Object.entries(LEGACY_ROUTES).map(([from, to]) => (
          <Route key={from} path={from} element={<Navigate to={`${BASE}/${to}`} replace />} />
        ))}
        <Route path="*" element={<Navigate to={`${BASE}/roadmap`} replace />} />
      </Routes>
      <StudentMobileNav immersionUnlocked={immersionUnlocked} />
    </DashboardLayout>
  );
}

export default StudentDashboard;
