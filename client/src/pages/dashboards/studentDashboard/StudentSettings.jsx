import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import styles from './StudentSettings.module.css';

const settingsItems = [
  {
    to: '/dashboard/student/settings/history',
    label: 'Activity History',
    description: 'Review your page visits and account activity.',
  },
  {
    to: '/dashboard/student/guide',
    label: 'Guide',
    description: 'Find help using the student portal.',
  },
  {
    to: '/dashboard/student/about',
    label: 'About',
    description: 'Learn about the e-MMERSION system.',
  },
  {
    to: '/dashboard/student/settings/profile',
    label: 'Profile Information',
    description: 'View your account and student details.',
  },
  {
    to: '/dashboard/student/settings/security',
    label: 'Account Security',
    description: 'Change your password and protect your account.',
  },
  {
    to: '/dashboard/student/settings/additional',
    label: 'Additional Settings',
    description: 'Customize your theme and preferences.',
  },
  {
    to: '/dashboard/student/settings/terms',
    label: 'Terms and Agreement',
    description: 'Read the terms for using the student portal.',
  },
];

export default function StudentSettings() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Settings</h1>
        <p>Manage your account, preferences, and helpful student resources.</p>
      </header>

      <nav className={styles.grid} aria-label="Student settings">
        {settingsItems.map((item) => (
          <Link className={styles.card} to={item.to} key={item.to}>
            <span className={styles.cardCopy}>
              <span className={styles.cardTitle}>{item.label}</span>
              <span className={styles.description}>{item.description}</span>
            </span>
            <ArrowRight className={styles.cardArrow} size={19} aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </main>
  );
}

export function StudentSettingsBackButton({
  to = '/dashboard/student/settings',
  label = 'Back to Settings',
}) {
  return (
    <Link className={styles.backButton} to={to}>
      <ArrowLeft size={17} aria-hidden="true" />
      {label}
    </Link>
  );
}
