import { useContext } from 'react';
import { PartnerInstitutionContext } from '../context/partnerInstitutionContext';

// Consumer hook for the shared teacher partner institution selection.
// A teacher may handle MULTIPLE partner institutions; `PartnerInstitutionProvider`
// owns the list and the persisted selection so the sidebar switcher, inline pickers
// and every teacher page stay in sync. Falls back to an empty selection when used
// outside the provider.
export function usePartnerInstitution() {
  const ctx = useContext(PartnerInstitutionContext);

  if (ctx) return ctx;

  return {
    institutions: [],
    institution: null,
    institutionId: null,
    institutionName: '',
    selectedId: null,
    selectInstitution: () => {},
    loading: false,
    error: null,
    reload: () => {},
  };
}