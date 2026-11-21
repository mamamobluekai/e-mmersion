import { API_BASE } from '../config/api';
import { ensureCsrfToken, methodNeedsCsrf, withCsrf } from '../utils/csrf';

export async function partnerDeploymentApi(role, path = '', body, method) {
  const token = localStorage.getItem('wim-token');
  const requestMethod = method || (body ? 'PUT' : 'GET');
  if (methodNeedsCsrf(requestMethod)) await ensureCsrfToken();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
  const response = await fetch(`${API_BASE}/${role === 'supervisor' ? 'supervisor' : 'coordinator'}/partner-deployments${path}`, {
    credentials: 'include',
    method: requestMethod,
    headers: methodNeedsCsrf(requestMethod) ? withCsrf(headers) : headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The deployment request could not be loaded.');
  return result;
}
