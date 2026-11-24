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
    throw Object.assign(new Error(data.error || data.message || 'Request failed.'), { status: res.status });
  }
  return data;
}

export async function getEvaluationCriteria() {
  return apiFetch('/evaluation/criteria');
}

export async function saveEvaluationCriteria(criteria, criteriaVersion) {
  return apiFetch('/evaluation/criteria', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteria, criteriaVersion }),
  });
}

export async function submitStudentEvaluation(payload) {
  return apiFetch('/evaluation/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getStudentEvaluation(studentId, batchId) {
  const query = batchId ? `?batchId=${encodeURIComponent(batchId)}` : '';
  return apiFetch(`/evaluation/student/${studentId}${query}`);
}

export async function getBatchEvaluations(batchId) {
  return apiFetch(`/evaluation/batch/${batchId}`);
}

export async function getSupervisorEvaluationStudents() {
  return apiFetch('/evaluation/my-students');
}

export async function getMyEvaluation() {
  return apiFetch('/evaluation/me');
}

export async function getTeacherBatchEvaluations() {
  return apiFetch('/evaluation/teacher/my-batch');
}

const feedbackPath = '/evaluation/immersion-feedback';

export const getImmersionFeedbackForm = (signal) => apiFetch(`${feedbackPath}/form`, { signal });
export const getImmersionFeedbackCriteria = (signal) => apiFetch(`${feedbackPath}/criteria`, { signal });
export const getInstitutionFeedbackRatings = () => apiFetch(`${feedbackPath}/institutions`);
export const getMySupervisorFeedback = (signal) => apiFetch(`${feedbackPath}/supervisor`, { signal });

export function saveImmersionFeedbackCriteria(criteria, version) {
  return apiFetch(`${feedbackPath}/criteria`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteria, version }),
  });
}

export function submitImmersionFeedback(deploymentId, version, ratings) {
  return apiFetch(`${feedbackPath}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deploymentId, version, ratings }),
  });
}
