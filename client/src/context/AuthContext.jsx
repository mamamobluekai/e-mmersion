import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { logoutUser } from '../api/userApi';
import { useSessionActivity } from '../hooks/useSessionActivity';
import { authSessionId, sameAuthSession, SESSION_ENDED, SESSION_TOKEN_UPDATED } from '../utils/authRefresh';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const storedUser = localStorage.getItem('wim-user');
      return storedUser ? JSON.parse(storedUser) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => localStorage.getItem('wim-token') || '');
  const [csrfToken, setCsrfToken] = useState(() => localStorage.getItem('wim-csrf') || '');

  useEffect(() => {
    function updateToken(event) {
      setToken(event.detail);
      setCsrfToken(localStorage.getItem('wim-csrf') || '');
    }
    function endSession() {
      setUser(null);
      setToken('');
      setCsrfToken('');
    }
    function syncSession(event) {
      if (event.key !== 'wim-token') return;
      if (!event.newValue) endSession();
      else if (sameAuthSession(event.oldValue, event.newValue)) setToken(event.newValue);
      else window.location.reload();
    }
    window.addEventListener(SESSION_TOKEN_UPDATED, updateToken);
    window.addEventListener(SESSION_ENDED, endSession);
    window.addEventListener('storage', syncSession);
    return () => {
      window.removeEventListener(SESSION_TOKEN_UPDATED, updateToken);
      window.removeEventListener(SESSION_ENDED, endSession);
      window.removeEventListener('storage', syncSession);
    };
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('wim-user', JSON.stringify(user));
    } else {
      localStorage.removeItem('wim-user');
    }
  }, [user]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('wim-token', token);
    } else {
      localStorage.removeItem('wim-token');
    }
  }, [token]);

  useEffect(() => {
    if (csrfToken) {
      localStorage.setItem('wim-csrf', csrfToken);
    } else {
      localStorage.removeItem('wim-csrf');
    }
  }, [csrfToken]);

  useSessionActivity(user ? authSessionId(token) : null);

  const login = (authData) => {
    const nextUser = authData?.user || null;
    // The dashboard can make its first requests as soon as the login form navigates.
    if (nextUser && authData.accessToken) {
      localStorage.setItem('wim-user', JSON.stringify(nextUser));
      localStorage.setItem('wim-token', authData.accessToken);
      if (authData.csrfToken) localStorage.setItem('wim-csrf', authData.csrfToken);
    }
    setUser(nextUser);
    setToken(authData?.accessToken || '');
    setCsrfToken(authData?.csrfToken || '');
    if (typeof nextUser?.skip_splash_screen === 'boolean') {
      localStorage.setItem('wim-skip-splash-screen', String(nextUser.skip_splash_screen));
    }
  };

  // Clears local state first and revokes the session on the server after, so a
  // failed request (offline, expired token) can never strand the user in a
  // half-logged-in state. Admins revoke through /admin/logout via
  // AdminAuthContext, so their token is skipped here.
  const logout = useCallback(async () => {
    const isAdmin = user?.role === 'admin';

    setUser(null);
    setToken('');
    setCsrfToken('');

    if (isAdmin) return;

    try {
      await logoutUser();
    } catch (e) {
      // The local session is already gone, so a revoke failure is not worth
      // blocking the user on; the server expires the token on its own.
      console.error('Logout revoke error:', e.message);
    }
  }, [user]);

  const updateUser = (partial) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : null));
  };

  const value = useMemo(
    () => ({ user, token, login, logout, updateUser, isAuthenticated: Boolean(user) }),
    [user, token, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
