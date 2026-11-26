import { Routes, Route, Navigate } from 'react-router-dom';
import AdminTopNav from '../../../components/admin/AdminTopNav';
import AdminSidebar from './AdminSidebar';
import DashboardLayout from '../sharedSidebar/DashboardLayout';
import Dashboard from './Dashboard';
import UserManagement from './UserManagement';
import Coordinators from './Coordinators';
import Settings from './Settings';
import AdminProfileSettings from './AdminProfileSettings';
import Reports from './Reports';
import AccessLogs from './AccessLogs';
import LoginActivityMonitoring from './LoginActivityMonitoring';
import UploadUsers from './UploadUsers';
import UploadBulk from './UploadBulk';
import ManualUser from './ManualUser';
import CoordinatorManagement from './CoordinatorManagement';
import ArchivedPeriods from './ArchivedPeriods';
import AccountProblems from './AccountProblems';
import About from '../About';
import PartnerDeployments from '../PartnerDeployments';
import SupportManagement from './SupportManagement';
import ImmersionMonitoring from './ImmersionMonitoring';
import StudentAttendanceMonitoring from './StudentAttendanceMonitoring';

function AdminDashboard({ user, onLogout }) {
  return (
    <DashboardLayout
      topNav={<AdminTopNav user={user} onLogout={onLogout} />}
      sidebar={<AdminSidebar />}
    >
      <Routes>
        <Route index element={<Navigate to="/dashboard/admin/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="coordinators" element={<Coordinators />} />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<AdminProfileSettings />} />
        <Route path="settings/security" element={<AdminProfileSettings key="security" section="security" />} />
        <Route path="about" element={<About user={user} />} />
        <Route path="reports" element={<Reports />} />
        <Route path="access-logs" element={<AccessLogs />} />
        <Route path="login-activity" element={<LoginActivityMonitoring />} />
        <Route path="upload-users" element={<UploadUsers />} />
        <Route path="manual-users" element={<ManualUser />} />
        <Route path="upload-bulk" element={<UploadBulk />} />
        <Route path="coordinator-management" element={<CoordinatorManagement />} />
        <Route path="archives" element={<ArchivedPeriods />} />
        <Route path="deployments" element={<PartnerDeployments role="admin" />} />
        <Route path="student-monitoring/:userId?" element={<ImmersionMonitoring role="student" />} />
        <Route path="student-attendance-monitoring/:partnerId?" element={<StudentAttendanceMonitoring />} />
        <Route path="supervisor-monitoring/:userId?" element={<ImmersionMonitoring role="supervisor" />} />
        <Route path="teacher-monitoring/:userId?" element={<ImmersionMonitoring role="teacher" />} />
        <Route path="account-problems" element={<AccountProblems />} />
        <Route path="support-management" element={<SupportManagement />} />
        <Route path="*" element={<Navigate to="/dashboard/admin/dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}

export default AdminDashboard;
