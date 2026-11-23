import { API_BASE } from '../config/api';


function getToken() {
  return localStorage.getItem('wim-token') || '';
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Request failed.');
  }
  return data;
}

// Supervisor
export async function supervisorGetEligibleStudents() {
  return apiFetch('/supervisor/certificate/eligible');
}

export async function supervisorGetAllStudents() {
  return apiFetch('/supervisor/certificate/eligible?all=true');
}

function certificateAction(action, studentId, deploymentRequestId, method) {
  const query = deploymentRequestId == null ? '' : `?deploymentRequestId=${encodeURIComponent(deploymentRequestId)}`;
  return apiFetch(`/supervisor/certificate/${action}/${studentId}${query}`, { method });
}

export function supervisorGenerateCertificate(studentId, deploymentRequestId) {
  return certificateAction('generate', studentId, deploymentRequestId, 'POST');
}

export function supervisorForceGenerateCertificate(studentId, deploymentRequestId) {
  return certificateAction('force', studentId, deploymentRequestId, 'POST');
}

export function supervisorUndoForceIssue(studentId, deploymentRequestId) {
  return certificateAction('undo', studentId, deploymentRequestId, 'DELETE');
}

export async function supervisorGetCertificateTemplate(institutionId) {
  const qs = institutionId == null ? '' : `?institutionId=${encodeURIComponent(institutionId)}`;
  return apiFetch(`/supervisor/certificate/template/me${qs}`);
}

export async function supervisorSaveCertificateTemplate(data) {
  return apiFetch('/supervisor/certificate/template/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// Student
export async function getMyCertificate() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/certificate/me`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Request failed.');
  }
  return data;
}
