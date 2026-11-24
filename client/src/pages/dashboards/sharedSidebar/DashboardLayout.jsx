import { useEffect, useRef, useState, cloneElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useMobileKeyboardFocus } from '../../../hooks/useMobileKeyboardFocus';
import { recordPageVisit } from '../../../api/activityHistoryApi';
import styles from './DashboardLayout.module.css';

function DashboardLayout({
  topNav,
  sidebar,
  children,
  enableMobileKeyboardFocus = false,
  compactGutters = false,
  activityReady = true,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const lastVisit = useRef(null);

  useEffect(() => {
    if (!activityReady || lastVisit.current === pathname) return undefined;
    // Let redirects settle before recording the page the user actually opens.
    const timer = window.setTimeout(() => {
      lastVisit.current = pathname;
      recordPageVisit(pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activityReady, pathname]);

  useMobileKeyboardFocus(enableMobileKeyboardFocus ? 110 : 24);

  const handleOpenSidebar = () => {
    setSidebarOpen(true);
  };

  const handleCloseSidebar = () => {
    setSidebarOpen(false);
  };

  const topNavWithProps = cloneElement(topNav, {
    onMenuClick: handleOpenSidebar,
  });

  const sidebarWithProps = cloneElement(sidebar, {
    isOpen: sidebarOpen,
    onClose: handleCloseSidebar,
  });
  

  // Two-part shell: the sidebar is its own fixed-width column and the topbar
  // sits inside the main column, so the topbar can never extend underneath the
  // sidebar (and the sidebar logo can never be covered by it).
  return (
    <div className={styles.shell}>

      {/* =====================================
          SIDEBAR — occupies its own layout space
      ===================================== */}

      <div className={styles.sidebar}>

        {sidebarWithProps}

      </div>

      {/* =====================================
          MAIN COLUMN — TOPBAR + CONTENT
      ===================================== */}

      <div className={styles.main}>

        {/* TOP NAVIGATION */}

        <div className={styles.topNav}>
          {topNavWithProps}
        </div>


        {/* CONTENT */}

        <main className={styles.content}>
          <div className={`${styles.contentInner} ${compactGutters ? styles.compactGutters : ''}`}>
            {children}
          </div>
        </main>

      </div>

    </div>
  );
}

export default DashboardLayout;
