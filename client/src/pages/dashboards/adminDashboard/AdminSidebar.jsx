
import DashboardSidebar from '../sharedSidebar/DashboardSidebar';

import {
  ChartNoAxesColumn,
  Users,
  Settings,
  User,
  Search,
  Upload,
  Archive,
  Info,
  ShieldCheck,
  Flag,
  ClipboardList,
  Bell,
  BookOpenCheck,
  BriefcaseBusiness,
  GraduationCap,
  CalendarCheck2,
} from 'lucide-react';

const links = [
  {
    to: '/dashboard/admin',
    label: 'Dashboard',
    icon: ChartNoAxesColumn,
    end: true,
  },
  {
    to: '/dashboard/admin/users',
    label: 'User Management',
    icon: Users,
    group: 'Monitor Users',
  },
  {
    to: '/dashboard/admin/upload-users',
    label: 'Upload Users',
    icon: Upload,
  },
  {
    to: '/dashboard/admin/coordinator-management',
    label: 'Coordinator Management',
    icon: ShieldCheck,
  },
  {
    to: '/dashboard/admin/archives',
    label: 'Archived Periods',
    icon: Archive,
  },
  {
    to: '/dashboard/admin/deployments',
    label: 'Partner Deployments',
    icon: ClipboardList,
  },
  {
    to: '/dashboard/admin/student-monitoring',
    label: 'Student Monitoring',
    icon: GraduationCap,
  },
  {
    to: '/dashboard/admin/student-attendance-monitoring',
    label: 'Student Attendance Monitoring',
    icon: CalendarCheck2,
  },
  {
    to: '/dashboard/admin/supervisor-monitoring',
    label: 'Supervisor Monitoring',
    icon: BriefcaseBusiness,
  },
  {
    to: '/dashboard/admin/teacher-monitoring',
    label: 'Teacher Monitoring',
    icon: BookOpenCheck,
  },
  {
    to: '/dashboard/admin/account-problems',
    label: 'Account Problems',
    icon: Flag,
    group: 'SYSTEM & SUPPORT',
  },
  {
    to: '/dashboard/admin/support-management',
    label: 'Support Management',
    icon: Bell,
  },
  {
    to: '/dashboard/admin/access-logs',
    label: 'Access Logs',
    icon: Search,
  },
  {
    to: '/dashboard/admin/login-activity',
    label: 'Login Activity',
    icon: ShieldCheck,
  },
  {
    to: '/dashboard/admin/settings',
    label: 'System Settings',
    icon: Settings,
  },
  {
    to: '/dashboard/admin/profile',
    label: 'Profile Settings',
    icon: User,
    group: 'Additional Features',
  },
  {
    to: '/dashboard/admin/about',
    label: 'About',
    icon: Info,
  },
];

function AdminSidebar({ isOpen, onClose }) {
  return (
    <DashboardSidebar
      title="Admin Panel"
      links={links}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

export default AdminSidebar;
