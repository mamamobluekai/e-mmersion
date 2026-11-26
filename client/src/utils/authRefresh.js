import { API_BASE } from '../config/api';

export const SESSION_TOKEN_UPDATED = 'wim:session-token-updated';
export const SESSION_ENDED = 'wim:session-ended';

export function canRefreshRequest(url, authorization) {
  if (!/^Bearer \S+$/i.test(authorization || '')) return false;
  const api = new URL(API_BASE, location.origin);
  const target = new URL(url, location.origin);
  if (target.origin !== api.origin || !target.pathname.startsWith(`${api.pathname}/`)) return false;
  return !/^\/(?:admin\/login\/?$|users\/(?:login(?:\/|$)|refresh\/?$))/.test(target.pathname.slice(api.pathname.length));
}

function storeToken(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private-mode storage failures must not break the request.
  }
}

// Single in-flight refresh shared by every caller, so a dashboard firing six
// parallel requests on an expired token rotates the cookie once, not six times.
// Rotation revokes the presented token, so concurrent refreshes would
// invalidate each other.
let inFlightRefresh = null;

export function authSessionId(token) {
  try {
    const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const { id, sid } = JSON.parse(atob(payload));
    return sid ? `${id}:${sid}` : null;
  } catch {
    return null;
  }
}

export function sameAuthSession(first, second) {
  return Boolean(first && second && (first === second
    || (authSessionId(first) && authSessionId(first) === authSessionId(second))));
}

export async function refreshAccessToken(rejectedToken = localStorage.getItem('wim-token')) {
  const currentToken = () => localStorage.getItem('wim-token');
  if (!sameAuthSession(rejectedToken, currentToken())) return null;
  if (currentToken() !== rejectedToken) return currentToken();
  if (sameAuthSession(inFlightRefresh?.token, rejectedToken)) return inFlightRefresh.promise;

  async function rotate() {
    const current = currentToken();
    if (!sameAuthSession(current, rejectedToken)) return null;
    if (current !== rejectedToken) return current;
    const response = await fetch(`${API_BASE}/users/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!sameAuthSession(currentToken(), rejectedToken)) return null;
    if (!response.ok) {
      if (response.status === 401 || data.code === 'SESSION_ENDED') {
        storeToken('wim-token', null);
        storeToken('wim-user', null);
        window.dispatchEvent(new Event(SESSION_ENDED));
      }
      return null;
    }
    if (!sameAuthSession(data.accessToken, rejectedToken)) return null;

    storeToken('wim-token', data.accessToken);
    if (data.csrfToken) storeToken('wim-csrf', data.csrfToken);
    window.dispatchEvent(new CustomEvent(SESSION_TOKEN_UPDATED, { detail: data.accessToken }));
    return data.accessToken;
  }

  // Tabs share the refresh cookie, so serialize rotations across tabs when available.
  const locks = globalThis.navigator?.locks;
  const request = { token: rejectedToken };
  request.promise = Promise.resolve()
    .then(() => locks ? locks.request('wim-refresh-token', rotate) : rotate())
    .catch(() => null)
    .finally(() => { if (inFlightRefresh === request) inFlightRefresh = null; });
  inFlightRefresh = request;
  return request.promise;
}

export function installFetchAuthInterceptor() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (window.fetch.__authPatched) return;

  const originalFetch = window.fetch.bind(window);

  const patchedFetch = async (input, init = {}) => {
    const response = await originalFetch(input, init);
    if (response.status !== 401) return response;

    const headers = new Headers(init.headers ?? input?.headers ?? undefined);
    const authorization = headers.get('Authorization');
    if (!canRefreshRequest(input?.url || input, authorization)) return response;

    const token = await refreshAccessToken(authorization.slice(7));
    if (!token) return response;

    headers.set('Authorization', `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };

  patchedFetch.__authPatched = true;
  window.fetch = patchedFetch;
}
