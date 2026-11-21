import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getMySubmissionStatus } from '../../../api/studentApi';
import DashboardLayout from '../sharedSidebar/DashboardLayout';
import DashboardTopNav from '../sharedSidebar/DashboardTopNav';
import StudentSidebar from './StudentSidebar';
import StudentMobileNav from './StudentMobileNav';
import Overview from './Overview';
import Requirements from './Requirements';
import PlacementStatus from './PlacementStatus';
import Announcements from '../Announcements/Announcements';
import Attendance from './Attendance';
import DailyDocumentation from './DailyDocumentation';
import Progress from './Progress';
import StudentEvaluation from './StudentEvaluation';
import BatchChat from '../../../components/social/BatchChat';
import UserProfileSettings from '../UserProfileSettings';
import Guide from './Guide';
import About from '../About';

function StudentDashboard({ user, onLogout }) {
  const [requirementsApproved, setRequirementsApproved] = useState(false);
  const [statusError, setStatusError] = useState('');

  const loadSubmissionStatus = useCallback(async () => {
    try {
      const result = await getMySubmissionStatus();
      setRequirementsApproved(
        String(result.submission?.status || '').trim().toLowerCase() === 'approved'
      );
      setStatusError('');
    } catch (error) {
      setStatusError(error.message || 'Could not verify your requirements approval.');
    }
  }, []);

  useEffect(() => {
    loadSubmissionStatus();
    const intervalId = window.setInterval(loadSubmissionStatus, 30000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadSubmissionStatus();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSubmissionStatus]);

  return (
    <DashboardLayout
      topNav={
        <DashboardTopNav
          user={user}
          onLogout={onLogout}
          title="Student Dashboard"
          hideProfileOnMobile
        />
      }
      sidebar={<StudentSidebar requirementsApproved={requirementsApproved} />}
      enableMobileKeyboardFocus
    >
      {statusError && (
        <p role="alert">
          Could not verify your requirements approval: {statusError}{' '}
          <button type="button" onClick={loadSubmissionStatus}>Try again</button>
        </p>
      )}
      <Routes>
        <Route path="requirements" element={<Requirements user={user} />} />
        <Route path="profile" element={<UserProfileSettings />} />
        {requirementsApproved ? (
          <>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<Overview user={user} />} />
            <Route path="progress" element={<Progress />} />
            <Route path="placement-status" element={<PlacementStatus user={user} />} />
            <Route path="evaluation" element={<StudentEvaluation />} />
            <Route path="announcements" element={<Announcements user={user} />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="daily-documentation" element={<DailyDocumentation />} />
            <Route path="group-chat" element={<BatchChat user={user} />} />
            <Route path="guide" element={<Guide />} />
            <Route path="about" element={<About user={user} />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </>
        ) : (
          <>
            <Route index element={<Navigate to="requirements" replace />} />
            <Route path="*" element={<Navigate to="requirements" replace />} />
          </>
        )}
      </Routes>
      <StudentMobileNav requirementsApproved={requirementsApproved} />
    </DashboardLayout>
  );
}
export default StudentDashboard;
