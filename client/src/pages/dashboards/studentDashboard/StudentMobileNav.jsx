import { NavLink } from 'react-router-dom';
import { ClipboardList, Home, Megaphone, MessageCircle, Settings } from 'lucide-react';
import styles from './StudentMobileNav.module.css';

const APPROVED_ITEMS = [
  { to: '/dashboard/student/overview', label: 'Home', icon: Home },
  { to: '/dashboard/student/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/dashboard/student/group-chat', label: 'Messenger', icon: MessageCircle },
  { to: '/dashboard/student/profile', label: 'Settings', icon: Settings },
];

const LOCKED_ITEMS = [
  { to: '/dashboard/student/requirements', label: 'Requirements', icon: ClipboardList },
  { to: '/dashboard/student/profile', label: 'Settings', icon: Settings },
];

export default function StudentMobileNav({ requirementsApproved = false }) {
  const items = requirementsApproved ? APPROVED_ITEMS : LOCKED_ITEMS;

  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />
      <nav
        className={`${styles.bottomBar} ${!requirementsApproved ? styles.bottomBarRestricted : ''}`}
        aria-label="Quick navigation"
      >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to.endsWith('overview')}
            className={({ isActive }) =>
              `${styles.item} ${isActive ? styles.itemActive : ''}`
            }
          >
            <Icon size={19} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
      </nav>
    </>
  );
}
