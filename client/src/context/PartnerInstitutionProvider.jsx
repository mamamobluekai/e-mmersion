import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { getMyPartnerInstitutions } from '../api/teacherApi';
import { PartnerInstitutionContext } from './partnerInstitutionContext';

export const PARTNER_INSTITUTION_STORAGE_KEY = 'wim-teacher-partner-id';

export function PartnerInstitutionProvider({ children }) {
  const { token } = useAuth();
  const [institutions, setInstitutions] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    try {
      const raw = localStorage.getItem(PARTNER_INSTITUTION_STORAGE_KEY);
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) {
      setInstitutions([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    try {
      const res = await getMyPartnerInstitutions(token);
      const list = res?.institutions || [];
      setInstitutions(list);
      setError(null);
      setSelectedId((prev) => {
        if (prev && list.some((i) => Number(i.id) === Number(prev))) return prev;
        return list.length ? Number(list[0].id) : null;
      });
    } catch (err) {
      console.error('Failed to load teacher partner institutions:', err);
      setError(err.response?.data?.error || 'Could not load your assigned partner institutions.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const selectInstitution = useCallback((id) => {
    const next = id ? Number(id) : null;
    setSelectedId(next);
    try {
      if (next) localStorage.setItem(PARTNER_INSTITUTION_STORAGE_KEY, String(next));
      else localStorage.removeItem(PARTNER_INSTITUTION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== PARTNER_INSTITUTION_STORAGE_KEY) return;
      const next = event.newValue ? Number(event.newValue) : null;
      setSelectedId(next);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const value = useMemo(() => {
    const institution = institutions.find((i) => Number(i.id) === Number(selectedId)) || null;
    return {
      institutions,
      institution,
      institutionId: institution?.id || null,
      institutionName: institution?.name || '',
      selectedId,
      selectInstitution,
      loading,
      error,
      reload: load,
    };
  }, [institutions, selectedId, selectInstitution, loading, error, load]);

  return <PartnerInstitutionContext.Provider value={value}>{children}</PartnerInstitutionContext.Provider>;
}