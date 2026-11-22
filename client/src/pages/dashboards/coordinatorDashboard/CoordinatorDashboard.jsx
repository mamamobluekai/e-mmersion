import { Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from '../sharedSidebar/DashboardLayout';
import DashboardTopNav from '../sharedSidebar/DashboardTopNav';
import CoordinatorSidebar from './CoordinatorSidebar';
import StudentApprovals from './StudentApprovals';
import StudentList from './StudentList';
import RequirementsReview from './RequirementsReview';
import Supervisors from './Supervisors';
import PartnerDeployments from '../PartnerDeployments';
import UserProfileSettings from '../UserProfileSettings';
import Announcements from '../Announcements/Announcements';
import CoordinatorOverview from './CoordinatorOverview';
import About from '../About';
import SpecialStudents from './SpecialStudents';

function CoordinatorDashboard({ user, onLogout }) {
  return (
    <DashboardLayout
      topNav={<DashboardTopNav user={user} onLogout={onLogout} title="Coordinator Dashboard" />}
      sidebar={<CoordinatorSidebar />}
    >
      <Routes>
        <Route index element={<CoordinatorOverview />} />
        <Route path="students" element={<StudentApprovals />} />
        <Route path="student-list" element={<StudentList />} />
        <Route path="special-students" element={<SpecialStudents />} />
        <Route path="upload-students" element={<Navigate to="/dashboard/coordinator/students" replace />} />
         <Route path="requirements" element={<RequirementsReview />} />
         <Route path="announcements" element={<Announcements user={user} />} />
         <Route path="batches/*" element={<Navigate to="/dashboard/coordinator/deployment" replace />} />
         <Route path="partner-institutions" element={<Supervisors />} />
         <Route path="supervisors" element={<Navigate to="/dashboard/coordinator/partner-institutions" replace />} />
         <Route path="deployment" element={<PartnerDeployments />} />

         <Route path="profile" element={<UserProfileSettings />} />
         <Route path="about" element={<About user={user} />} />
         <Route path="*" element={<Navigate to="students" replace />} />
      </Routes>
    </DashboardLayout>
  );
}

export default CoordinatorDashboard;
