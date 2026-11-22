import { Building2 } from 'lucide-react';
import { usePartnerInstitution } from '../../../hooks/usePartnerInstitution';
import styles from './TeacherSidebarPartner.module.css';

function TeacherPartnerSwitcher() {
  const { institutions, institutionId, institutionName, selectInstitution, loading, error, reload } = usePartnerInstitution();

  if (loading) {
    return (
      <div className={styles.block}>
        <div className={styles.label}>
          <Building2 size={14} strokeWidth={2} />
          <span>Partner Institution</span>
        </div>
        <div className={styles.loading}>Loading partner institutions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.block}>
        <div className={styles.label}>
          <Building2 size={14} strokeWidth={2} />
          <span>Partner Institution</span>
        </div>
        <div className={styles.error}>{error}</div>
        <button type="button" className={styles.retry} onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  if (!institutions || institutions.length === 0) {
    return (
      <div className={styles.block}>
        <div className={styles.label}>
          <Building2 size={14} strokeWidth={2} />
          <span>Partner Institution</span>
        </div>
        <div className={styles.empty}>No partner institution assigned</div>
      </div>
    );
  }

  if (institutions.length === 1) {
    return (
      <div className={styles.block}>
        <div className={styles.label}>
          <Building2 size={14} strokeWidth={2} />
          <span>Partner Institution</span>
        </div>
        <div className={styles.single} title={institutionName}>
          {institutionName}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.block}>
      <label className={styles.label} htmlFor="teacher-sidebar-partner">
        <Building2 size={14} strokeWidth={2} />
        <span>Partner Institution</span>
      </label>
      <select
        id="teacher-sidebar-partner"
        className={styles.select}
        value={institutionId || ''}
        onChange={(e) => selectInstitution(e.target.value)}
      >
        {institutions.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
      <p className={styles.hint} title="Applies to all dashboard data. The Live Map always shows every partner institution.">
        Live Map shows all partner institutions
      </p>
    </div>
  );
}

export default TeacherPartnerSwitcher;