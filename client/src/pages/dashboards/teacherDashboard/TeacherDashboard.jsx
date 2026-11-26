import { Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from '../sharedSidebar/DashboardLayout';
import DashboardTopNav from '../sharedSidebar/DashboardTopNav';
import TeacherSidebar from './TeacherSidebar';
import TeacherOverview from './TeacherOverview';
import TeacherDocuments from './TeacherDocuments';
import LiveMap from './LiveMap';
import TeacherAttendance from './TeacherAttendance';
import TeacherStudents from './TeacherStudents';
import StudentApprovals from './StudentApprovals';
import RequirementsReview from '../coordinatorDashboard/RequirementsReview';
import TeacherStudentEvaluations from './TeacherStudentEvaluations';
import TeacherStudentDocumentation from './TeacherStudentDocumentation';
import TeacherReportsConcerns from './TeacherReportsConcerns';
import TeacherSettings from './TeacherSettings';
import PartnerChat from '../../../components/social/PartnerChat';
import Announcements from '../Announcements/Announcements';
import UserProfileSettings from '../UserProfileSettings';
import ActivityHistory from '../ActivityHistory';
import { PartnerInstitutionProvider } from '../../../context/PartnerInstitutionProvider';
import About from '../About';

function TeacherDashboard({ user, onLogout }) {
  return (
    <PartnerInstitutionProvider>
    <DashboardLayout
      topNav={<DashboardTopNav user={user} onLogout={onLogout} title="Teacher Dashboard" />}
      sidebar={<TeacherSidebar />}
    >
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<TeacherOverview user={user} />} />
         <Route path="students" element={<TeacherStudents />} />
         <Route path="upload-students" element={<StudentApprovals />} />
         <Route path="requirements" element={<RequirementsReview />} />
         <Route path="evaluations" element={<TeacherStudentEvaluations />} />
         <Route path="attendance" element={<TeacherAttendance />} />
          <Route path="student-documentation" element={<TeacherStudentDocumentation />} />
         <Route path="reports-concerns" element={<TeacherReportsConcerns />} />
         <Route path="announcements" element={<Announcements user={user} />} />
         <Route path="live-map" element={<LiveMap />} />
         <Route path="appeals" element={<Navigate to="/dashboard/teacher/attendance" replace />} />
         <Route path="settings" element={<TeacherSettings />} />

         <Route path="group-chat" element={<PartnerChat user={user} />} />
         <Route path="profile" element={<UserProfileSettings />} />
         <Route path="settings/security" element={<UserProfileSettings section="security" />} />
         <Route path="settings/history" element={<ActivityHistory settingsPath="/dashboard/teacher/profile" />} />
         <Route path="about" element={<About user={user} />} />
         <Route path="documents" element={<TeacherDocuments user={user} />} />
         <Route path="*" element={<Navigate to="overview" replace />} />
       </Routes>
    </DashboardLayout>
    </PartnerInstitutionProvider>
  );
}

export default TeacherDashboard;
