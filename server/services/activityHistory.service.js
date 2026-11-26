const { readFile } = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db');

const roles = ['student', 'teacher', 'coordinator', 'supervisor'];
const types = {
  page: 'Page visits', 'sign-in': 'Sign-ins', 'sign-out': 'Sign-outs', create: 'Created',
  update: 'Updated', delete: 'Removed', download: 'Downloads', action: 'Other actions',
};
const areas = {
  account: 'Account & Settings', attendance: 'Attendance', communication: 'Communication',
  deployments: 'Deployments & Partners', documents: 'Documentation & Certificates', evaluation: 'Evaluation',
  general: 'Dashboard & Help', requirements: 'Requirements', students: 'Student Management',
};

const sharedPages = {
  'settings/history': ['account', 'Activity History'], announcements: ['communication', 'Announcements'],
  'settings/security': ['account', 'Account Security'],
  'group-chat': ['communication', 'Messenger'], about: ['general', 'About'],
};
const pages = {
  student: {
    roadmap: ['general', 'Roadmap'], 'pre-immersion': ['requirements', 'Pre-Immersion'],
    'pre-immersion/requirements': ['requirements', 'Requirements'], 'immersion-proper': ['general', 'Immersion Proper'],
    'immersion-proper/placement-status': ['deployments', 'Placement Status'], 'immersion-proper/attendance': ['attendance', 'Attendance'],
    'immersion-proper/daily-documentation': ['documents', 'Daily Documentation'], 'post-immersion': ['general', 'Immersion Progress Report'],
    'post-immersion/evaluation': ['evaluation', 'Supervisor’s Evaluation'], 'post-immersion/evaluate-partner': ['evaluation', 'Evaluate Partner Institution'],
    'post-immersion/certifications': ['documents', 'Certifications'], guide: ['general', 'Guide'], settings: ['account', 'Settings'],
    'settings/profile': ['account', 'Profile Information'], 'settings/security': ['account', 'Account Security'],
    'settings/additional': ['account', 'Additional Settings'], 'settings/terms': ['account', 'Terms and Agreement'],
  },
  teacher: {
    overview: ['general', 'Teacher Dashboard'], students: ['students', 'Students'], evaluations: ['evaluation', 'Student Grades'],
    'upload-students': ['students', 'Upload Students'], requirements: ['requirements', 'Requirements Review'],
    attendance: ['attendance', 'Attendance Monitor'], 'student-documentation': ['documents', 'Student Documentation'],
    'reports-concerns': ['communication', 'Reports & Concerns'], 'live-map': ['attendance', 'Live Map'],
    settings: ['account', 'Settings'], profile: ['account', 'Profile Settings'], documents: ['documents', 'Documents'],
  },
  coordinator: {
    '': ['general', 'Coordinator Dashboard'], students: ['students', 'Student List'], 'student-list': ['students', 'Student List'],
    'special-students': ['students', 'Special Students'], requirements: ['requirements', 'Student Requirements'], batches: ['deployments', 'Batches'],
    'partner-institutions': ['deployments', 'Partner Institutions'], 'evaluation-criteria': ['evaluation', 'Evaluation Criteria'],
    deployment: ['deployments', 'Deployment Requests'], 'deployment/:id/students': ['deployments', 'Choose Students for Deployment'],
    profile: ['account', 'Profile Settings'],
  },
  supervisor: {
    '': ['general', 'Supervisor Dashboard'], 'deployment-requests': ['deployments', 'Deployment Requests'],
    'partner-institutions': ['deployments', 'Partner Institutions'], attendance: ['attendance', 'Student Attendance'],
    'student-progress': ['students', 'Student Progress'], 'student-documentation': ['documents', 'Student Documentation'],
    'attendance-schedule': ['attendance', 'Attendance Schedule'], 'reports-concerns': ['communication', 'Reports & Concerns'],
    evaluate: ['evaluation', 'Evaluate Student'], evaluation: ['evaluation', 'Evaluations'], 'student-feedback': ['evaluation', 'Student Feedback'],
    certifications: ['documents', 'Certifications'], 'grade-appeals': ['evaluation', 'Grade Appeals'], profile: ['account', 'Profile Settings'],
  },
};

let ready;
const retention = "INTERVAL '24 hours'";
function ensureHistorySchema() {
  ready ??= (async () => {
    const { rows: [schema] } = await pool.query("SELECT to_regclass('public.idx_personal_activity_expiry') AS expiry_index");
    if (!schema.expiry_index) {
      await pool.query(await readFile(path.join(__dirname, '../db/migrations/050_personal_activity_history.sql'), 'utf8'));
    }
  })().catch((error) => { ready = undefined; throw error; });
  return ready;
}

async function recordActivity(user, type, area, label) {
  if (!roles.includes(user?.role)) return;
  await ensureHistorySchema();
  await pool.query(`INSERT INTO public.personal_activity_history (user_id, activity_type, area, label) VALUES ($1, $2, $3, $4)`,
    [user.id, type, area, label]);
}

function pageActivity(role, pathname) {
  const prefix = `/dashboard/${role}`;
  if (!roles.includes(role) || typeof pathname !== 'string' || pathname.length > 180 ||
      (pathname !== prefix && !pathname.startsWith(`${prefix}/`))) return null;
  const key = pathname.slice(prefix.length).replace(/^\/|\/$/g, '').replace(/^deployment\/\d+\/students$/, 'deployment/:id/students');
  if (Object.hasOwn(pages[role], key)) return pages[role][key];
  return Object.hasOwn(sharedPages, key) ? sharedPages[key] : null;
}

const moduleAreas = {
  users: 'account', attendance: 'attendance', tracking: 'attendance', chat: 'communication', feed: 'communication',
  notifications: 'communication', files: 'documents', documentation: 'documents', certificate: 'documents',
  evaluation: 'evaluation', appeals: 'evaluation',
};
const resourceAreas = {
  'partner-institutions': 'deployments', 'partner-deployments': 'deployments', 'teacher-batches': 'deployments',
  attendance: 'attendance', holidays: 'attendance', 'blocked-dates': 'attendance', 'work-immersion': 'attendance',
  requirements: 'requirements', submissions: 'requirements', 'document-types': 'requirements',
  documents: 'documents', certificate: 'documents', students: 'students', 'reports-concerns': 'communication',
};
const commandLabels = {
  'check-in': 'Checked in for attendance', 'check-out': 'Checked out of attendance', 'location-issue': 'Reported an attendance location issue',
  approve: 'Approved', disapprove: 'Disapproved', archive: 'Archived', restore: 'Restored', review: 'Reviewed',
  'bulk-review': 'Reviewed in bulk', cancel: 'Cancelled', resubmit: 'Resubmitted', finalize: 'Finalized',
  'submit-students': 'Submitted student assignments', 'review-students': 'Reviewed student assignments',
  generate: 'Issued a certificate', force: 'Issued a certificate by exception', undo: 'Revoked an exception certificate',
  'read-all': 'Marked all notifications as read', read: 'Marked a notification as read',
};
const methodTypes = { POST: ['create', 'Created'], PUT: ['update', 'Updated'], PATCH: ['update', 'Updated'], DELETE: ['delete', 'Removed'] };
const pageSize = 25;

function requestActivity(req, res) {
  const module = req.originalUrl.split('/')[2]?.split('?')[0]?.toLowerCase();
  const route = req.route?.path;
  if (typeof route !== 'string' || module === 'activity-history' || module === 'admin') return null;
  // Only static route words are retained. Neither the actual URL nor route parameters are stored.
  const segments = route.split('/').filter((part) => /^[a-z][a-z0-9-]*$/.test(part));
  const key = segments.join('/');
  const last = segments.at(-1);
  const moduleArea = Object.hasOwn(moduleAreas, module) ? moduleAreas[module] : null;
  if ((module === 'tracking' && key === 'location/update') || key === 'student/push/subscriptions') return null;
  if (module === 'users' && key === 'logout') return ['sign-out', 'account', 'Signed out'];
  if (req.method === 'GET') {
    const attachment = /^attachment(?:;|$)/i.test(String(res.getHeader('Content-Disposition') || ''));
    if (!attachment && !segments.some((segment) => segment === 'download' || segment === 'export')) return null;
    return ['download', moduleArea || 'documents', segments.includes('certificate') || module === 'certificate' ? 'Downloaded certificate' : 'Downloaded a file'];
  }

  const [type, verb] = methodTypes[req.method] || [];
  if (!type) return null;
  const resourceArea = segments.find((segment) => Object.hasOwn(resourceAreas, segment));
  const area = moduleArea || resourceAreas[resourceArea] || 'general';
  if (module === 'users' && key === 'profile/password') return ['update', area, 'Changed account password'];
  if (module === 'users' && key === 'profile/picture') return ['update', area, 'Updated profile picture'];
  if (module === 'users' && key === 'activation/set-password') return ['update', area, 'Set permanent account password'];
  if (module === 'users' && key === 'terms/accept') return ['action', area, 'Accepted Terms and Agreement'];
  if (module === 'users' && key === 'verification/send') return ['action', area, 'Requested device verification'];
  if (module === 'users' && key === 'verification/confirm') return ['action', area, 'Verified current device'];
  if (module === 'users' && key === 'logout-others') return ['action', area, 'Signed out other devices'];
  if (module === 'evaluation' && last === 'submit') return ['action', area, key === 'immersion-feedback/submit' ? 'Submitted placement evaluation' : 'Submitted student evaluation'];
  if (module === 'evaluation' && last === 'criteria') return ['update', area, 'Updated evaluation criteria'];
  if (module === 'attendance' && ['open', 'close'].includes(last)) return ['action', area, `${last === 'open' ? 'Opened' : 'Closed'} batch attendance`];
  if (module === 'documentation' && last === 'grade') return ['action', area, 'Graded daily documentation'];
  if (module === 'documentation' && last === 'submit') return ['action', area, 'Submitted daily documentation'];
  if (module === 'chat' && last === 'messages' && type === 'create') return ['create', area, 'Sent a message'];
  if (module === 'coordinator' && key === 'documents/upload') return ['create', 'requirements', 'Uploaded a requirement document'];
  if (module === 'coordinator' && key === 'students' && type === 'delete') return ['action', area, 'Archived a student account'];
  if (key === 'requirements/submit') return ['action', area, 'Submitted requirements'];
  const command = Object.hasOwn(commandLabels, last) ? commandLabels[last] : null;
  const resource = segments.filter((segment) => !['me', 'my', 'bulk', 'batch', 'teacher', 'student'].includes(segment) && segment !== last).at(-1) || segments[0];
  const subject = resource?.replaceAll('-', ' ') || areas[area].toLowerCase();
  if (command) return ['action', area, command.includes(' ') || !resource ? command : `${command} ${subject}`];
  const description = segments.filter((segment) => !['me', 'my', 'batch', 'teacher', 'student'].includes(segment)).slice(-2).join(' ').replaceAll('-', ' ');
  return [type, area, `${verb} ${description || subject}`];
}

const observed = Symbol('activityHistoryObserver');
function observeActivity(req, res) {
  if (!roles.includes(req.user?.role) || res[observed]) return;
  res[observed] = true;
  const actor = req.user;
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const event = requestActivity(req, res);
    if (event) void recordActivity(actor, ...event).catch(reportActivityError);
  });
}

function reportActivityError(error) {
  console.error('Personal activity history:', error.message);
}

async function listActivity(userId, type, area, before) {
  await ensureHistorySchema();
  const { rows } = await pool.query(`SELECT id, activity_type AS type, area, label, occurred_at,
    occurred_at + ${retention} AS expires_at
    FROM public.personal_activity_history WHERE user_id = $1
      AND occurred_at > now() - ${retention}
      AND ($2::text IS NULL OR activity_type = $2) AND ($3::text IS NULL OR area = $3)
      AND ($4::bigint IS NULL OR id < $4) ORDER BY id DESC LIMIT $5`, [userId, type, area, before, pageSize + 1]);
  const entries = rows.slice(0, pageSize);
  return { entries, next: rows.length > pageSize ? entries.at(-1).id : null, types, areas };
}

function startActivityHistoryCleanup() {
  let running = false;
  async function cleanup() {
    if (running) return;
    running = true;
    try {
      await ensureHistorySchema();
      await pool.query(`DELETE FROM public.personal_activity_history WHERE occurred_at <= now() - ${retention}`);
    } catch (error) {
      reportActivityError(error);
    } finally {
      running = false;
    }
  }

  void cleanup();
  const timer = setInterval(cleanup, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { roles, types, areas, pageActivity, observeActivity, recordActivity, listActivity, reportActivityError, startActivityHistoryCleanup };
