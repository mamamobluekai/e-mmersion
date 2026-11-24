import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getMyJourney } from '../../../api/studentApi';
import { useToast } from '../../../components/admin/toastContext';
import PartnerChat from '../../../components/social/PartnerChat';
import About from '../About';
import Announcements from '../Announcements/Announcements';
import UserProfileSettings from '../UserProfileSettings';
import ActivityHistory from '../ActivityHistory';
import DashboardLayout from '../sharedSidebar/DashboardLayout';
import DashboardTopNav from '../sharedSidebar/DashboardTopNav';
import Attendance from './Attendance';
import Certifications from './Certifications';
import DailyDocumentation from './DailyDocumentation';
import EvaluatePartnerInstitution from './EvaluatePartnerInstitution';
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
const LOCKED_STAGE_MESSAGES = {
  immersion: 'Immersion Proper is locked. Complete Pre-Immersion to unlock this section.',
  post: 'Post-Immersion is locked. Complete Immersion Proper to unlock this section.',
};
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
    return <Navigate to={`${BASE}/roadmap`} replace state={{ lockedStage: stage }} />;
  }
  return children;
}

function StudentDashboard({ user, onLogout }) {
  const [journey, setJourney] = useState(null);
  const [error, setError] = useState('');
  const request = useRef(null);
  const { pathname, state } = useLocation();
  const { showToast } = useToast();
  const lockedStage = state?.lockedStage;
  const lockedStageMessage = journey?.stages[lockedStage] === 'locked' ? LOCKED_STAGE_MESSAGES[lockedStage] : '';

  const handleLockedStageClick = (stage) => showToast(LOCKED_STAGE_MESSAGES[stage], 'info');

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
      <JourneyStage>{content}</JourneyStage>
    </StageAccess>
  );
  const immersionUnlocked = Boolean(journey && journey.stages.immersion !== 'locked');
  const activityReady = pathname.startsWith(`${BASE}/post-immersion`)
    ? Boolean(journey && journey.stages.post !== 'locked')
    : pathname.startsWith(`${BASE}/immersion-proper`) || pathname === `${BASE}/group-chat`
      ? immersionUnlocked
      : true;

  return (
    <DashboardLayout
      topNav={<DashboardTopNav user={user} onLogout={onLogout} title="Student Dashboard" hideProfileOnMobile />}
      sidebar={<StudentSidebar stages={journey?.stages} onLockedStageClick={handleLockedStageClick} />}
      enableMobileKeyboardFocus
      activityReady={activityReady}
      compactGutters={pathname === `${BASE}/roadmap` || pathname === `${BASE}/immersion-proper`}
    >
      {error && (
        <p role="alert">
          {error}{' '}<button type="button" onClick={refreshJourney}>Try again</button>
        </p>
      )}
      {!journey && !error && <p role="status">Loading your immersion journey…</p>}
      {!journey && error && <p><Link to={`${BASE}/pre-immersion`}>Open Pre-Immersion</Link></p>}
      {lockedStageMessage && <p role="status">{lockedStageMessage}</p>}
      <Routes>
        <Route index element={<Navigate to="roadmap" replace />} />
        <Route path="roadmap" element={<Roadmap journey={journey} onLockedStageClick={handleLockedStageClick} />} />
        <Route path="pre-immersion" element={<JourneyStage><Requirements key="missions" checklistOnly /></JourneyStage>} />
        <Route path="pre-immersion/requirements" element={<JourneyStage><Requirements key="forms" /></JourneyStage>} />
        <Route path="immersion-proper" element={stagePage('immersion', journey && <DailyMissionRoadmap journey={journey} />)} />
        <Route path="immersion-proper/placement-status" element={stagePage('immersion', <PlacementStatus />)} />
        <Route path="immersion-proper/attendance" element={stagePage('immersion', <Attendance />)} />
        <Route path="immersion-proper/daily-documentation" element={stagePage('immersion', <DailyDocumentation />)} />
        <Route path="post-immersion" element={stagePage('post', journey && <Progress journey={journey} />)} />
        <Route path="post-immersion/evaluation" element={stagePage('post', <StudentEvaluation />)} />
        <Route path="post-immersion/evaluate-partner" element={stagePage('post', <EvaluatePartnerInstitution />)} />
        <Route path="post-immersion/certifications" element={stagePage('post', journey && <Certifications issued={journey.certificate.issued} />)} />
        <Route path="post-immersion/documents" element={<Navigate to={`${BASE}/post-immersion/certifications`} replace />} />

        <Route path="group-chat" element={<StageAccess stage="immersion" journey={journey}><PartnerChat user={user} /></StageAccess>} />
        <Route path="announcements" element={<Announcements user={user} />} />
        <Route path="guide" element={<><Guide /><StudentSettingsBackButton /></>} />
        <Route path="about" element={<><About user={user} /><StudentSettingsBackButton /></>} />
        <Route path="settings" element={<StudentSettings />} />
        <Route path="settings/profile" element={<UserProfileSettings section="profile" />} />
        <Route path="settings/security" element={<UserProfileSettings section="security" />} />
        <Route path="settings/additional" element={<UserProfileSettings section="additional" />} />
        <Route path="settings/terms" element={<StudentTermsAndAgreement />} />
        <Route path="settings/history" element={<ActivityHistory settingsPath={`${BASE}/settings`} />} />
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
