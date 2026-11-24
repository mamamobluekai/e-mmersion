const loginPages = {
  student: '/login/student',
  teacher: '/login/teacherandCoordinator',
  coordinator: '/login/teacherandCoordinator',
  supervisor: '/login/supervisor',
  admin: '/admin/login',
};

export function getLoginPage(role) {
  return Object.hasOwn(loginPages, role) ? loginPages[role] : loginPages.student;
}

// Paths relative to VITE_API_BASE_URL. Override a role independently in client/.env.
export const loginEndpoints = {
  student: import.meta.env.VITE_LOGIN_STUDENT_ENDPOINT || '/users/login/student',
  teacher: import.meta.env.VITE_LOGIN_TEACHER_ENDPOINT || '/users/login/teacher',
  coordinator: import.meta.env.VITE_LOGIN_COORDINATOR_ENDPOINT || '/users/login/coordinator',
  supervisor: import.meta.env.VITE_LOGIN_SUPERVISOR_ENDPOINT || '/users/login/supervisor',
};
