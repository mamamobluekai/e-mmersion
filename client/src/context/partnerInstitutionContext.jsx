import { createContext } from 'react';

export const PartnerInstitutionContext = createContext(null);

export function usePartnerInstitution() {
  const ctx = useContext(PartnerInstitutionContext);
  if (!ctx) {
    throw new Error('usePartnerInstitution must be used within a PartnerInstitutionProvider');
  }
  return ctx;
}