import DashboardSidebar from '../sharedSidebar/DashboardSidebar';
import UserProfileSettings from '../UserProfileSettings';

import {
  Users,
  ClipboardList,
  Building2,
  Megaphone,
  User,
  LayoutDashboard,
  Send,
  Info,
  List,
  Layers,
} from 'lucide-react';

const links = [
  {
    to: '/dashboard/coordinator',
    label: 'Overview',
    icon: LayoutDashboard,
  },
  {
    to: '/dashboard/coordinator/students',
    label: 'Student Approvals',
    icon: Users,
  },
  {
    to: '/dashboard/coordinator/student-list',
    label: 'Student List',
    icon: List,
  },
  {
    to: '/dashboard/coordinator/special-students',
    label: 'Special Students',
    icon: Users,
  },
  {
    to: '/dashboard/coordinator/requirements',
    label: 'Requirements',
    icon: ClipboardList,
  },
  {
    to: '/dashboard/coordinator/partner-institutions',
    label: 'Partner Institutions',
    icon: Building2,
  },
  {
    to: '/dashboard/coordinator/deployment',
    label: 'Deployment Requests',
    icon: Send,
  },
  {
    to: '/dashboard/coordinator/batches',
    label: 'Batches',
    icon: Layers,
  },
  {
    to: '/dashboard/coordinator/announcements',
    label: 'Announcements',
    icon: Megaphone,
  },
  {
    to: '/dashboard/coordinator/profile',
    label: 'Settings',
    icon: User,
    // Phone only: opens in a slide-up sheet instead of navigating. Desktop
    // still navigates to the route above.
    sheet: UserProfileSettings,
    sheetTitle: 'Settings',
  },
  {
    to: '/dashboard/coordinator/about',
    label: 'About',
    icon: Info,
  },
];

function CoordinatorSidebar({ isOpen, onClose }) {
  return (
    <DashboardSidebar
      title="Coordinator"
      subtitle="Work Immersion Office"
      links={links}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

export default CoordinatorSidebar;
