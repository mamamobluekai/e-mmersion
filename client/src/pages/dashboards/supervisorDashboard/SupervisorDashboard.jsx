import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, ClipboardList, ClipboardPenLine, UsersRound } from 'lucide-react';

import DashboardLayout from '../sharedSidebar/DashboardLayout';
import DashboardTopNav from '../sharedSidebar/DashboardTopNav';
import SupervisorSidebar from './SupervisorSidebar';
import PartnerDeployments from '../PartnerDeployments';
import SupervisorPartnerInstitutions from './SupervisorPartnerInstitutions';
import SupervisorAttendance from './SupervisorAttendance';
import SupervisorReportsConcerns from './SupervisorReportsConcerns';
import SupervisorSchedule from './SupervisorSchedule';
import SupervisorEvaluateStudent from './SupervisorEvaluateStudent';
import SupervisorEvaluation from './SupervisorEvaluation';
import SupervisorCertifications from './SupervisorCertifications';
import SupervisorGradeAppeals from './SupervisorGradeAppeals';
import PartnerChat from '../../../components/social/PartnerChat';
import Announcements from '../Announcements/Announcements';
import UserProfileSettings from '../UserProfileSettings';


import SupervisorCalendar from './SupervisorCalendar';
import SupervisorStudentProgress from './SupervisorStudentProgress';
import SupervisorReminders from './SupervisorReminders';
import About from '../About';
import aboutStyles from '../About.module.css';
import styles from './SupervisorDashboard.module.css';

const overviewShortcuts = [
  { path: 'deployment-requests', label: 'Deployment Requests', icon: ClipboardList },
  { path: 'attendance', label: 'Student Attendance', icon: CalendarDays },
  { path: 'student-progress', label: 'Student Progress', icon: UsersRound },
  { path: 'evaluate', label: 'Evaluate Student', icon: ClipboardPenLine },
];

function SupervisorDashboard({ user, onLogout }) {
  return (
    <DashboardLayout
      topNav={
        <DashboardTopNav
          user={user}
          onLogout={onLogout}
          title="Supervisor Dashboard"
        />
      }
      sidebar={<SupervisorSidebar />}
    >
      <Routes>
        <Route index element={<SupervisorOverview user={user} />} />

        <Route
          path="create-deployment-request"
          element={<Navigate to="/dashboard/supervisor/deployment-requests" replace />}
        />
        <Route path="deployment-requests" element={<PartnerDeployments role="supervisor" />} />

        <Route path="partner-institutions" element={<SupervisorPartnerInstitutions />} />

        <Route path="attendance" element={<SupervisorAttendance />} />

        <Route path="student-progress" element={<SupervisorStudentProgress />} />

        <Route path="attendance-schedule" element={<SupervisorSchedule />} />

        <Route path="reports-concerns" element={<SupervisorReportsConcerns />} />

        <Route
          path="evaluate"
          element={<SupervisorEvaluateStudent />}
        />

        <Route
          path="evaluation"
          element={<SupervisorEvaluation />}
        />

        <Route
          path="certifications"
          element={<SupervisorCertifications />}
        />

        <Route
          path="grade-appeals"
          element={<SupervisorGradeAppeals />}
        />

        <Route path="announcements" element={<Announcements user={user} />} />

        <Route
          path="group-chat"
          element={<PartnerChat user={user} />}
        />

        <Route
          path="profile"
          element={<UserProfileSettings />}
        />

        <Route path="about" element={<About user={user} />} />

        <Route
          path="*"
          element={<Navigate to="evaluate" replace />}
        />
      </Routes>
    </DashboardLayout>
  );
}

function SupervisorOverview({ user }) {
  return (
    <div className={aboutStyles.page}>

      <div className={styles.pageHeader}>
        <div>

          <h1>
            Welcome back,
            <span>
              {' '}
              {getUserName(user)}
            </span>
          </h1>

          <p>
            Monitor your deployed students, attendance,
            and immersion progress from one place.
          </p>
        </div>
      </div>

      <div className={styles.overviewSplit}>
        <div className={styles.overviewLeft}>
          <SupervisorCalendar compact />
        </div>
        <div className={styles.overviewRight}>
          <SupervisorReminders />
        </div>
      </div>

      <nav className={styles.overviewShortcuts} aria-labelledby="supervisor-shortcuts-title">
        <h2 id="supervisor-shortcuts-title">Shortcuts</h2>
        <ul>
          {overviewShortcuts.map(({ path, label, icon: Icon }) => <li key={path}>
            <Link className={styles.shortcutLink} to={`/dashboard/supervisor/${path}`}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </li>)}
        </ul>
      </nav>

      <footer className={aboutStyles.footer} aria-hidden="true" />

    </div>
  );
}

function getUserName(user) {
  return (
    user?.first_name ||
    user?.name ||
    user?.email ||
    'Supervisor'
  );
}

export default SupervisorDashboard;
