import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  MoreHorizontal,
  Plus,
  Save,
  X,
} from 'lucide-react';
import {
  assignPartnerSupervisor,
  createPartnerInstitution,
  deactivatePartnerInstitution,
  deactivatePartnerSupervisor,
  getPartnerInstitutions,
  reactivatePartnerInstitution,
  resendPartnerSupervisorActivation,
  updatePartnerInstitution,
  updatePartnerSupervisor,
} from '../../../api/coordinatorApi';
import styles from './Supervisors.module.css';

const INDUSTRIES = [
  'IT',
  'Healthcare',
  'Engineering',
  'Education',
  'Manufacturing',
  'Hospitality',
  'Government',
  'Business and Finance',
  'Agriculture',
  'Other',
];

const EMPTY_INSTITUTION = {
  name: '',
  industry: '',
  description: '',
  address: '',
  supervisor: { fullName: '', email: '', phone: '' },
};

const EMPTY_SUPERVISOR = { fullName: '', email: '', phone: '' };

function supervisorName(supervisor) {
  return [supervisor?.first_name, supervisor?.last_name].filter(Boolean).join(' ') || 'No supervisor assigned';
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusLabel(status) {
  if (status === 'pending_activation') return 'Awaiting activation';
  if (['approved', 'active'].includes(String(status || '').toLowerCase())) return 'Active account';
  if (status === 'disapproved') return 'Deactivated';
  return status || 'Unknown status';
}

function revealInstitution(card) {
  card?.scrollIntoView({ block: 'nearest' });
}

export default function Supervisors() {
  const [params, setParams] = useSearchParams();
  const linkedInstitutionId = params.get('institution');
  const [institutions, setInstitutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState({});
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const [institutionModal, setInstitutionModal] = useState(null);
  const [institutionForm, setInstitutionForm] = useState(EMPTY_INSTITUTION);
  const [supervisorModal, setSupervisorModal] = useState(null);
  const [supervisorForm, setSupervisorForm] = useState(EMPTY_SUPERVISOR);
  const [formError, setFormError] = useState('');
  const actionMenuRef = useRef(null);
  const actionMenuButtonRef = useRef(null);

  const loadInstitutions = useCallback(async () => {
    setLoading(true);
    setPageError('');
    try {
      const data = await getPartnerInstitutions();
      setInstitutions(data.institutions || []);
    } catch (err) {
      setPageError(err.message || 'Could not load partner institutions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInstitutions();
  }, [loadInstitutions]);

  useEffect(() => {
    if (openActionMenu === null) return undefined;

    const handlePointerDown = (event) => {
      if (!actionMenuRef.current?.contains(event.target)) setOpenActionMenu(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpenActionMenu(null);
        actionMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openActionMenu]);

  const filteredInstitutions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return institutions.filter((institution) => {
      if (!showInactive && !institution.is_active && String(institution.id) !== linkedInstitutionId) return false;
      if (!query) return true;
      const supervisor = institution.current_supervisor;
      return [
        institution.name,
        institution.industry,
        institution.address,
        supervisor?.first_name,
        supervisor?.last_name,
        supervisor?.email,
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [institutions, search, showInactive, linkedInstitutionId]);

  const openNewInstitution = () => {
    setInstitutionForm({ ...EMPTY_INSTITUTION, supervisor: { ...EMPTY_SUPERVISOR } });
    setInstitutionModal({ mode: 'create' });
    setFormError('');
  };

  const openEditInstitution = useCallback((institution, focusAddress = false) => {
    setInstitutionForm({
      name: institution.name || '',
      industry: institution.industry || 'Other',
      description: institution.description || '',
      address: institution.address || '',
      supervisor: { ...EMPTY_SUPERVISOR },
    });
    setInstitutionModal({ mode: 'edit', institution, focusAddress });
    setFormError('');
  }, []);

  useEffect(() => {
    if (params.get('edit') !== 'address' || !linkedInstitutionId || loading) return;
    const institution = institutions.find(({ id }) => String(id) === linkedInstitutionId);
    if (!institution) return;
    openEditInstitution(institution, true);
    const next = new URLSearchParams(params);
    next.delete('edit');
    setParams(next, { replace: true, preventScrollReset: true });
  }, [institutions, linkedInstitutionId, loading, openEditInstitution, params, setParams]);

  const closeInstitutionModal = () => {
    if (!saving) {
      setInstitutionModal(null);
      setFormError('');
    }
  };

  const openSupervisorModal = (institution, mode) => {
    const current = institution.current_supervisor;
    setSupervisorForm(
      mode === 'edit' && current
        ? {
            fullName: supervisorName(current),
            email: current.email || '',
            phone: current.phone || '',
          }
        : { ...EMPTY_SUPERVISOR },
    );
    setSupervisorModal({ institution, mode });
    setFormError('');
  };

  const closeSupervisorModal = () => {
    if (!saving) {
      setSupervisorModal(null);
      setFormError('');
    }
  };

  const handleInstitutionSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError('');
    try {
      let response;
      if (institutionModal.mode === 'create') {
        response = await createPartnerInstitution(institutionForm);
      } else {
        const { name, industry, description, address } = institutionForm;
        response = await updatePartnerInstitution(institutionModal.institution.id, {
          name,
          industry,
          description,
          address,
        });
      }
      setInstitutionModal(null);
      setNotice({
        type: response.emailNotification?.sent === false ? 'warning' : 'success',
        message: response.emailNotification?.message ||
          (institutionModal.mode === 'create'
            ? 'Partner institution and supervisor account created.'
            : 'Partner institution updated.'),
      });
      await loadInstitutions();
    } catch (err) {
      setFormError(err.message || 'Could not save this partner institution.');
    } finally {
      setSaving(false);
    }
  };

  const handleSupervisorSubmit = async (event) => {
    event.preventDefault();
    if (saving || !supervisorModal) return;
    setSaving(true);
    setFormError('');
    try {
      const { institution, mode } = supervisorModal;
      let response;
      if (mode === 'edit') {
        response = await updatePartnerSupervisor(
          institution.id,
          institution.current_supervisor.id,
          supervisorForm,
        );
      } else {
        response = await assignPartnerSupervisor(institution.id, supervisorForm);
      }
      setSupervisorModal(null);
      setNotice({
        type: response.emailNotification?.sent === false ? 'warning' : 'success',
        message: response.emailNotification?.message ||
          (mode === 'edit' ? 'Supervisor information updated.' : 'Supervisor assigned.'),
      });
      await loadInstitutions();
    } catch (err) {
      setFormError(err.message || 'Could not save supervisor information.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateInstitution = async (institution) => {
    const supervisorMessage = institution.current_supervisor
      ? ` The assigned supervisor account will also be deactivated.`
      : '';
    if (!window.confirm(`Deactivate ${institution.name}?${supervisorMessage} Assignment history will be retained.`)) return;
    setActionBusy(true);
    setPageError('');
    try {
      await deactivatePartnerInstitution(institution.id);
      setNotice({ type: 'success', message: `${institution.name} deactivated.` });
      await loadInstitutions();
    } catch (err) {
      setPageError(err.message || 'Could not deactivate this institution.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReactivateInstitution = async (institution) => {
    setActionBusy(true);
    setPageError('');
    try {
      await reactivatePartnerInstitution(institution.id);
      setNotice({ type: 'success', message: `${institution.name} reactivated. Assign a supervisor to restore its coverage.` });
      await loadInstitutions();
    } catch (err) {
      setPageError(err.message || 'Could not reactivate this institution.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeactivateSupervisor = async (institution) => {
    const supervisor = institution.current_supervisor;
    if (!window.confirm(`Deactivate ${supervisorName(supervisor)}? The account will no longer be able to sign in, and the assignment will remain in history.`)) return;
    setActionBusy(true);
    setPageError('');
    try {
      await deactivatePartnerSupervisor(institution.id, supervisor.id);
      setNotice({ type: 'success', message: 'Supervisor deactivated. The institution record was retained.' });
      await loadInstitutions();
    } catch (err) {
      setPageError(err.message || 'Could not deactivate this supervisor.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleResendActivation = async (institution) => {
    const supervisor = institution.current_supervisor;
    setActionBusy(true);
    setPageError('');
    try {
      const response = await resendPartnerSupervisorActivation(institution.id, supervisor.id);
      setNotice({
        type: response.emailNotification?.sent ? 'success' : 'warning',
        message: response.emailNotification?.message || 'Activation credentials resent.',
      });
    } catch (err) {
      setPageError(err.message || 'Could not resend supervisor activation credentials.');
    } finally {
      setActionBusy(false);
    }
  };

  const runMenuAction = (action) => {
    setOpenActionMenu(null);
    action();
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Work Immersion placements</p>
          <h1>Partner Institutions</h1>
          <p>
            Register host organizations, manage workplace supervisors, and retain
            a history of supervisor assignments.
          </p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openNewInstitution}>
          <Plus size={17} aria-hidden="true" />
          Add Institution
        </button>
      </header>

      {pageError && (
        <div className={styles.alertError} role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          {pageError}
        </div>
      )}
      {notice && (
        <div className={notice.type === 'success' ? styles.alertSuccess : styles.alertWarning} role="status">
          {notice.type === 'success'
            ? <CheckCircle2 size={17} aria-hidden="true" />
            : <AlertCircle size={17} aria-hidden="true" />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      <section className={styles.toolbar} aria-label="Institution filters">
        <label className={styles.searchField}>
          <span className={styles.srOnly}>Search institutions</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company, industry, supervisor..."
          />
        </label>
        <label className={styles.inactiveToggle}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          Show inactive
        </label>
      </section>

      {loading ? (
        <div className={styles.stateMessage}>Loading partner institutions...</div>
      ) : filteredInstitutions.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}><Building2 size={22} aria-hidden="true" /></span>
          <h2>{search ? 'No matching institutions' : 'No partner institutions yet'}</h2>
          <p>
            {search
              ? 'Try another company, industry, or supervisor search.'
              : 'Add an institution and register its workplace supervisor to get started.'}
          </p>
          {!search && (
            <button type="button" className={styles.secondaryButton} onClick={openNewInstitution}>
              <Plus size={16} aria-hidden="true" /> Add Institution
            </button>
          )}
        </div>
      ) : (
        <section className={styles.institutionGrid} aria-label="Partner institution list">
          {filteredInstitutions.map((institution) => {
            const supervisor = institution.current_supervisor;
            const historyExpanded = Boolean(expandedHistory[institution.id]);
            const previousAssignmentCount = (institution.supervisor_history || [])
              .filter((entry) => Boolean(entry.ended_at)).length;
            const menuOpen = openActionMenu === institution.id;
            const linked = String(institution.id) === linkedInstitutionId;
            return (
              <article className={styles.institutionCard} key={institution.id}
                ref={linked ? revealInstitution : undefined} aria-current={linked ? 'location' : undefined}>
                <div className={styles.cardHeader}>
                  <div className={styles.companyHeading}>
                    <div className={styles.companyTitleRow}>
                      <h2>{institution.name}</h2>
                      <span className={`${styles.statusBadge} ${institution.is_active ? styles.statusActive : styles.statusInactive}`}>
                        {institution.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className={styles.industry}>{institution.industry || 'Industry not specified'}</p>
                  </div>
                  <div
                    className={styles.actionMenuWrap}
                    ref={menuOpen ? actionMenuRef : null}
                  >
                    <button
                      type="button"
                      className={styles.menuButton}
                      aria-label={`Actions for ${institution.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      disabled={actionBusy}
                      ref={menuOpen ? actionMenuButtonRef : null}
                      onClick={() => setOpenActionMenu(menuOpen ? null : institution.id)}
                    >
                      <MoreHorizontal size={19} aria-hidden="true" />
                    </button>
                    {menuOpen && (
                      <div className={styles.actionMenu} role="menu" aria-label={`${institution.name} actions`}>
                        {institution.is_active ? (
                          <>
                            <button type="button" role="menuitem" onClick={() => runMenuAction(() => openEditInstitution(institution))}>
                              Edit Institution
                            </button>
                            {supervisor ? (
                              <>
                                <button type="button" role="menuitem" onClick={() => runMenuAction(() => openSupervisorModal(institution, 'edit'))}>
                                  Edit Supervisor
                                </button>
                                <button type="button" role="menuitem" onClick={() => runMenuAction(() => openSupervisorModal(institution, 'replace'))}>
                                  Replace Supervisor
                                </button>
                                {supervisor.status === 'pending_activation' && (
                                  <button type="button" role="menuitem" disabled={actionBusy} onClick={() => runMenuAction(() => handleResendActivation(institution))}>
                                    Resend Activation
                                  </button>
                                )}
                                <button type="button" role="menuitem" className={styles.destructiveMenuItem} disabled={actionBusy} onClick={() => runMenuAction(() => handleDeactivateSupervisor(institution))}>
                                  Deactivate Supervisor
                                </button>
                              </>
                            ) : (
                              <button type="button" role="menuitem" onClick={() => runMenuAction(() => openSupervisorModal(institution, 'assign'))}>
                                Assign Supervisor
                              </button>
                            )}
                            <div className={styles.menuDivider} role="separator" />
                            <button type="button" role="menuitem" className={styles.destructiveMenuItem} disabled={actionBusy} onClick={() => runMenuAction(() => handleDeactivateInstitution(institution))}>
                              Deactivate Institution
                            </button>
                          </>
                        ) : (
                          <button type="button" role="menuitem" onClick={() => runMenuAction(() => handleReactivateInstitution(institution))}>
                            Reactivate Institution
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {institution.description && <p className={styles.description} title={institution.description}>{institution.description}</p>}
                <p className={styles.addressLine} title={institution.address || ''}>
                  {institution.address || 'Address not provided'}
                </p>

                <div className={styles.supervisorInfo}>
                  <div className={styles.supervisorField}>
                    <span>Workplace Supervisor</span>
                    <strong>{supervisorName(supervisor)}</strong>
                  </div>
                  <div className={styles.supervisorField}>
                    <span>Email</span>
                    <strong title={supervisor?.email || ''}>{supervisor?.email || 'Not provided'}</strong>
                  </div>
                  <div className={styles.supervisorField}>
                    <span>Contact Number</span>
                    <strong>{supervisor?.phone || 'Not provided'}</strong>
                  </div>
                  <div className={styles.supervisorField}>
                    <span>Account Status</span>
                    <span className={`${styles.accountBadge} ${supervisor?.status === 'pending_activation' ? styles.accountPending : supervisor ? styles.accountActive : styles.accountInactive}`}>
                      {supervisor ? statusLabel(supervisor.status) : 'Unassigned'}
                    </span>
                  </div>
                </div>

                {institution.supervisor_history?.length > 0 && (
                  <div className={styles.historySection}>
                    <button
                      type="button"
                      className={styles.historyToggle}
                      aria-expanded={historyExpanded}
                      onClick={() => setExpandedHistory((state) => ({
                        ...state,
                        [institution.id]: !state[institution.id],
                      }))}
                    >
                      <span>
                        Supervisor assignment history
                        <small>{previousAssignmentCount} previous</small>
                      </span>
                      <span className={styles.historyToggleAction}>{historyExpanded ? 'Hide' : 'View'}</span>
                    </button>
                    {historyExpanded && (
                      <ol className={styles.historyList}>
                        {institution.supervisor_history.map((entry) => (
                          <li key={entry.assignment_id}>
                            <strong>{supervisorName(entry)}</strong>
                            <span>{entry.email}</span>
                            <small>
                              Assigned {formatDate(entry.assigned_at)}
                              {entry.ended_at ? ` · ${entry.end_reason || 'Ended'} ${formatDate(entry.ended_at)}` : ' · Current assignment'}
                            </small>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {institutionModal && (
        <div className={styles.modalOverlay} onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeInstitutionModal();
        }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="institution-form-title">
            <header className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>{institutionModal.mode === 'create' ? 'New partner' : 'Institution profile'}</p>
                <h2 id="institution-form-title">{institutionModal.mode === 'create' ? 'Add Institution' : 'Edit Institution'}</h2>
              </div>
              <button type="button" className={styles.closeButton} onClick={closeInstitutionModal} disabled={saving} aria-label="Close">
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={handleInstitutionSubmit}>
              <div className={styles.modalBody}>
                {formError && <p className={styles.formError} role="alert"><AlertCircle size={15} />{formError}</p>}
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Company / Institution Name *</span>
                    <input value={institutionForm.name} onChange={(event) => setInstitutionForm((form) => ({ ...form, name: event.target.value }))} maxLength={255} required />
                  </label>
                  <label className={styles.field}>
                    <span>Company Type / Industry *</span>
                    <select value={institutionForm.industry} onChange={(event) => setInstitutionForm((form) => ({ ...form, industry: event.target.value }))} required>
                      <option value="" disabled>Select an industry</option>
                      {INDUSTRIES.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
                    </select>
                  </label>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span>Company Address *</span>
                    <textarea value={institutionForm.address} onChange={(event) => setInstitutionForm((form) => ({ ...form, address: event.target.value }))}
                      maxLength={2000} rows={2} required autoFocus={institutionModal.focusAddress} />
                  </label>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span>Short Description</span>
                    <textarea value={institutionForm.description} onChange={(event) => setInstitutionForm((form) => ({ ...form, description: event.target.value }))} maxLength={2500} rows={3} />
                  </label>
                </div>
                {institutionModal.mode === 'create' && (
                  <div className={styles.supervisorFormSection}>
                    <h3>Assigned Workplace Supervisor</h3>
                    <p>The supervisor receives a temporary password by email, accepts the Terms and Agreement, then sets a permanent password.</p>
                    <div className={styles.formGrid}>
                      <label className={styles.field}>
                        <span>Full Name *</span>
                        <input value={institutionForm.supervisor.fullName} onChange={(event) => setInstitutionForm((form) => ({ ...form, supervisor: { ...form.supervisor, fullName: event.target.value } }))} maxLength={200} autoComplete="name" required />
                      </label>
                      <label className={styles.field}>
                        <span>Email Address *</span>
                        <input type="email" value={institutionForm.supervisor.email} onChange={(event) => setInstitutionForm((form) => ({ ...form, supervisor: { ...form.supervisor, email: event.target.value } }))} maxLength={255} autoComplete="email" required />
                      </label>
                      <label className={styles.field}>
                        <span>Contact Number</span>
                        <input type="tel" value={institutionForm.supervisor.phone} onChange={(event) => setInstitutionForm((form) => ({ ...form, supervisor: { ...form.supervisor, phone: event.target.value } }))} maxLength={50} autoComplete="tel" />
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={closeInstitutionModal} disabled={saving}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={saving}>
                  <Save size={16} aria-hidden="true" />
                  {saving ? 'Saving...' : institutionModal.mode === 'create' ? 'Create Institution' : 'Save Changes'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {supervisorModal && (
        <div className={styles.modalOverlay} onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSupervisorModal();
        }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="supervisor-form-title">
            <header className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>{supervisorModal.institution.name}</p>
                <h2 id="supervisor-form-title">
                  {supervisorModal.mode === 'edit'
                    ? 'Edit Supervisor'
                    : supervisorModal.mode === 'replace'
                      ? 'Replace Supervisor'
                      : 'Assign Supervisor'}
                </h2>
              </div>
              <button type="button" className={styles.closeButton} onClick={closeSupervisorModal} disabled={saving} aria-label="Close">
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={handleSupervisorSubmit}>
              <div className={styles.modalBody}>
                {formError && <p className={styles.formError} role="alert"><AlertCircle size={15} />{formError}</p>}
                {supervisorModal.mode === 'replace' && (
                  <p className={styles.replacementNote}>
                    The current supervisor account will be deactivated and preserved in assignment history.
                  </p>
                )}
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Full Name *</span>
                    <input value={supervisorForm.fullName} onChange={(event) => setSupervisorForm((form) => ({ ...form, fullName: event.target.value }))} maxLength={200} autoComplete="name" required />
                  </label>
                  <label className={styles.field}>
                    <span>Email Address *</span>
                    <input type="email" value={supervisorForm.email} onChange={(event) => setSupervisorForm((form) => ({ ...form, email: event.target.value }))} maxLength={255} autoComplete="email" required />
                  </label>
                  <label className={styles.field}>
                    <span>Contact Number</span>
                    <input type="tel" value={supervisorForm.phone} onChange={(event) => setSupervisorForm((form) => ({ ...form, phone: event.target.value }))} maxLength={50} autoComplete="tel" />
                  </label>
                </div>
                {supervisorModal.mode !== 'edit' && (
                  <p className={styles.replacementNote}>
                    A temporary password will be emailed. The supervisor must accept the Terms and Agreement and set a permanent password before accessing the dashboard.
                  </p>
                )}
              </div>
              <footer className={styles.modalFooter}>
                <button type="button" className={styles.secondaryButton} onClick={closeSupervisorModal} disabled={saving}>Cancel</button>
                <button type="submit" className={styles.primaryButton} disabled={saving}>
                  <Save size={16} aria-hidden="true" />
                  {saving ? 'Saving...' : supervisorModal.mode === 'edit' ? 'Save Supervisor' : supervisorModal.mode === 'replace' ? 'Replace Supervisor' : 'Assign Supervisor'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
