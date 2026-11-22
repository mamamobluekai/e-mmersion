import DashboardSidebar from '../sharedSidebar/DashboardSidebar';
import UserProfileSettings from '../UserProfileSettings';

import {
  ChartNoAxesColumn,
  Upload,
  Building2,
  CalendarDays,
  ClipboardPenLine,
  ScrollText,
  User,
  Megaphone,
  FileText,
  Info,
} from 'lucide-react';

const links = [
  {
    to: '/dashboard/supervisor',
    label: 'Dashboard',
    icon: ChartNoAxesColumn,
    end: true,
    group: 'Pre-Immersion',
  },
  {
    to: '/dashboard/supervisor/deployment-requests',
    label: 'Deployment Requests',
    icon: Upload,
  },
  {
    to: '/dashboard/supervisor/partner-institutions',
    label: 'Partner Institutions',
    icon: Building2,
  },
  {
    to: '/dashboard/supervisor/attendance-schedule',
    label: 'Attendance Schedule',
    icon: CalendarDays,
  },
  {
    to: '/dashboard/supervisor/attendance',
    label: 'Student Attendance',
    icon: CalendarDays,
    group: 'Immersion Proper',
  },
  {
    to: '/dashboard/supervisor/reports-concerns',
    label: 'My Reports & Concerns',
    icon: FileText,
  },
  {
    to: '/dashboard/supervisor/evaluate',
    label: 'Evaluate Student',
    icon: ClipboardPenLine,
    group: 'Post-Immersion',
  },
  // 'Student Criteria' was retired: criteria are now edited from the
  // "Grading Criteria" modal on the Evaluate Student page.
  {
    to: '/dashboard/supervisor/grade-appeals',
    label: 'Grade Appeals',
    icon: FileText,
  },
  {
    to: '/dashboard/supervisor/certifications',
    label: 'Certifications',
    icon: ScrollText,
  },

  {
    to: '/dashboard/supervisor/announcements',
    label: 'Announcements',
    icon: Megaphone,
  },
  {
    to: '/dashboard/supervisor/profile',
    label: 'Settings',
    icon: User,
    // Phone only: opens in a slide-up sheet instead of navigating. Desktop
    // still navigates to the route above.
    sheet: UserProfileSettings,
    sheetTitle: 'Settings',
  },
  {
    to: '/dashboard/supervisor/about',
    label: 'About',
    icon: Info,
  },
];

function SupervisorSidebar({ isOpen, onClose }) {
  return (
    <DashboardSidebar
      title="Supervisor"
      subtitle="Partner Institutions"
      links={links}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

export default SupervisorSidebar;
