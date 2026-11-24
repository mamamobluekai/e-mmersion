import { API_BASE } from '../config/api';
import { withCsrf } from '../utils/csrf';

async function historyRequest(path, { signal, event } = {}) {
  const token = localStorage.getItem('wim-token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${API_BASE}/activity-history${path}`, {
    credentials: 'include',
    signal,
    ...(event ? {
      method: 'POST',
      headers: withCsrf({ ...headers, 'Content-Type': 'application/json' }),
      body: JSON.stringify(event),
      keepalive: true,
    } : { headers }),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not load activity history.');
  return data;
}

export function getActivityHistory({ type, area, before, signal }) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (area) params.set('area', area);
  if (before) params.set('before', before);
  return historyRequest(`?${params}`, { signal });
}

export function recordPageVisit(pathname) {
  if (!/^\/dashboard\/(student|teacher|coordinator|supervisor)(?:\/|$)/.test(pathname)) return;
  void historyRequest('/events', { event: { pathname } }).catch(() => {});
}

export function recordThemeChange() {
  void historyRequest('/events', { event: { preference: 'theme' } }).catch(() => {});
}
