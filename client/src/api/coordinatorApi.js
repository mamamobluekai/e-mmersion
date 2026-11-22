import { API_BASE } from '../config/api';

function getToken() {
  return localStorage.getItem('wim-token') || '';
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/coordinator${path}`, {
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

// `method` defaults to POST because most coordinator endpoints create. Callers
// that hit a PUT/DELETE route must pass it here rather than spreading jsonBody
// into an options object - jsonBody carries its own `method`, so spreading it
// last silently overrode the intended verb and produced a 404.
function jsonBody(body, method = 'POST') {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function getCoordinatorDashboard() {
  return apiFetch('/dashboard');
}

export async function getCoordinatorProfile() {
  return apiFetch('/profile');
}

/* ---------------- Student approvals ---------------- */
export async function getPendingStudents(strand = 'all', activity = 'all') {
  const params = new URLSearchParams();
  if (strand && strand !== 'all') params.set('strand', strand);
  if (activity && activity !== 'all') params.set('activity', activity);
  const qs = params.toString();
  return apiFetch(`/students/pending${qs ? `?${qs}` : ''}`);
}

export async function getAllStudents({
  strand = 'all',
  activity = 'all',
  search = '',
  requirementsCompleted = 'all',
  deploymentStatus = 'all',
} = {}) {
  const params = new URLSearchParams();
  if (strand && strand !== 'all') params.set('strand', strand);
  if (activity && activity !== 'all') params.set('activity', activity);
  if (search) params.set('search', search);
  if (requirementsCompleted && requirementsCompleted !== 'all') {
    params.set('requirements_completed', requirementsCompleted);
  }
  if (deploymentStatus && deploymentStatus !== 'all') {
    params.set('deployment_status', deploymentStatus);
  }
  const qs = params.toString();
  return apiFetch(`/students/all${qs ? `?${qs}` : ''}`);
}

export async function getSpecialNeedsStudents() {
  return apiFetch('/students/special');
}

export async function createStudentAccountReport(studentId, { reason, comments }) {
  return apiFetch(`/students/${studentId}/reports`, jsonBody({ reason, comments }));
}

export async function getStudentStrands() {
  return apiFetch('/students/strands');
}

export async function approveStudent(id) {
  return apiFetch(`/students/${id}/approve`, { method: 'PUT' });
}

export async function disapproveStudent(id) {
  return apiFetch(`/students/${id}/disapprove`, { method: 'PUT' });
}

// Mails a fresh set-password link to an already-approved student. The response
// carries `emailSent` so the coordinator can see a delivery failure.
export async function resendStudentApprovalEmail(id) {
  return apiFetch(`/students/${id}/resend-approval`, { method: 'POST' });
}

export async function updateStudentEmail(id, email) {
  return apiFetch(`/students/${id}/email`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function deleteStudent(id) {
  return apiFetch(`/students/${id}`, { method: 'DELETE' });
}

export async function restoreStudent(id) {
  return apiFetch(`/students/${id}/restore`, { method: 'POST' });
}

export async function permanentDeleteStudent(id) {
  return apiFetch(`/students/${id}/permanent`, { method: 'DELETE' });
}

export async function getArchivedStudents() {
  return apiFetch('/students/archived');
}

export async function bulkApproveStudents(studentIds) {
  return apiFetch('/students/bulk/approve', jsonBody({ student_ids: studentIds }, 'PUT'));
}

export async function bulkDisapproveStudents(studentIds) {
  return apiFetch('/students/bulk/disapprove', jsonBody({ student_ids: studentIds }, 'PUT'));
}

export async function bulkArchiveStudents(studentIds) {
  return apiFetch('/students/bulk/archive', jsonBody({ student_ids: studentIds }, 'POST'));
}

export async function bulkRestoreStudents(studentIds) {
  return apiFetch('/students/bulk/restore', jsonBody({ student_ids: studentIds }, 'POST'));
}

export async function bulkPermanentDeleteStudents(studentIds) {
  return apiFetch('/students/bulk/permanent', jsonBody({ student_ids: studentIds }, 'DELETE'));
}

export async function uploadStudentsExcel(file) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/coordinator/students/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Upload failed.');
  }
  return data;
}

/* ---------------- Requirements / submissions ---------------- */
export async function listSubmissions({ status = 'all', search = '', strand = '' } = {}) {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);
  if (strand) params.set('strand', strand);
  const qs = params.toString();
  return apiFetch(`/submissions${qs ? `?${qs}` : ''}`);
}

export async function reviewSubmission(id, { status, remarks }) {
  return apiFetch(`/submissions/${id}/review`, jsonBody({ status, remarks }));
}

export async function reviewRequirement(submissionId, documentTypeId, { status, feedback = '' }) {
  return apiFetch(
    `/submissions/${submissionId}/requirements/${documentTypeId}/review`,
    jsonBody({ status, feedback }, 'PUT'),
  );
}

export async function bulkReviewSubmissions(submissionIds, { status, remarks }) {
  return apiFetch('/submissions/bulk-review', jsonBody({ submission_ids: submissionIds, status, remarks }));
}

export async function getRequirements(studentId) {
  return apiFetch(`/requirements/${studentId}`);
}

/* ---------------- Document types (Requirements management) ---------------- */
export async function getDocumentTypes({ all = true } = {}) {
  const qs = all ? '?all=true' : '';
  return apiFetch(`/document-types${qs}`);
}

export async function createDocumentType({ name, section, description }) {
  return apiFetch('/document-types', jsonBody({ name, section, description }));
}

export async function updateDocumentType(id, { name, section, description, sort_order, is_active }) {
  return apiFetch(`/document-types/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, section, description, sort_order, is_active }),
  });
}

export async function deleteDocumentType(id) {
  return apiFetch(`/document-types/${id}`, { method: 'DELETE' });
}

export async function restoreDocumentType(id) {
  return apiFetch(`/document-types/${id}/restore`, { method: 'PUT' });
}

export async function permanentDeleteDocumentType(id) {
  return apiFetch(`/document-types/${id}/permanent`, { method: 'DELETE' });
}

/* ---------------- Teachers / Supervisors ---------------- */


/* ---------------- Partner institutions / workplace supervisors ---------------- */
export async function getPartnerInstitutions() {
  return apiFetch('/partner-institutions');
}

export async function createPartnerInstitution(institution) {
  return apiFetch('/partner-institutions', jsonBody(institution));
}

export async function updatePartnerInstitution(id, institution) {
  return apiFetch(`/partner-institutions/${id}`, jsonBody(institution, 'PUT'));
}

export async function deactivatePartnerInstitution(id) {
  return apiFetch(`/partner-institutions/${id}/deactivate`, jsonBody({}));
}

export async function reactivatePartnerInstitution(id) {
  return apiFetch(`/partner-institutions/${id}/reactivate`, jsonBody({}));
}

export async function assignPartnerSupervisor(institutionId, supervisor) {
  return apiFetch(
    `/partner-institutions/${institutionId}/supervisors`,
    jsonBody(supervisor),
  );
}

export async function updatePartnerSupervisor(institutionId, supervisorId, supervisor) {
  return apiFetch(
    `/partner-institutions/${institutionId}/supervisors/${supervisorId}`,
    jsonBody(supervisor, 'PUT'),
  );
}

export async function deactivatePartnerSupervisor(institutionId, supervisorId) {
  return apiFetch(
    `/partner-institutions/${institutionId}/supervisors/${supervisorId}/deactivate`,
    jsonBody({}),
  );
}

export async function resendPartnerSupervisorActivation(institutionId, supervisorId) {
  return apiFetch(
    `/partner-institutions/${institutionId}/supervisors/${supervisorId}/resend-activation`,
    jsonBody({}),
  );
}
