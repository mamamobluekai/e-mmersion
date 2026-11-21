import { NavLink } from 'react-router-dom';
import { Flag, Map, MessageCircle } from 'lucide-react';
import styles from './StudentMobileNav.module.css';

export default function StudentMobileNav({ immersionUnlocked }) {
  const items = [
    { path: 'roadmap', label: 'Roadmap', icon: Map },
    immersionUnlocked
      ? { path: 'group-chat', label: 'Messenger', icon: MessageCircle }
      : { path: 'pre-immersion', label: 'Pre-Immersion', icon: Flag },
  ];
  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />
      <nav className={styles.bottomBar} aria-label="Quick navigation">
        {items.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={`/dashboard/student/${path}`}
            className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}
          >
            <Icon size={19} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
