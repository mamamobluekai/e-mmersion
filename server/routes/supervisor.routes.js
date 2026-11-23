const express = require('express');
const router = express.Router();

const supervisor = require('../controllers/supervisorControllers/supervisor.controller');
const supervisorDashboard = require('../controllers/supervisorControllers/dashboard.controller');
const immersionExclusions = require('../controllers/supervisorControllers/immersionExclusions.controller');
const partnerDeployment = require('../controllers/coordinatorControllers/partnerDeployment.controller');
const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');

router.use(authenticate);

router.get('/dashboard', authorize('supervisor'), supervisorDashboard.getSupervisorDashboard);
router.get('/partner-deployments', authorize('supervisor'), partnerDeployment.list);
router.get('/partner-deployments/student-approvals', authorize('supervisor'), partnerDeployment.studentAssignments);
router.put('/partner-deployments/:id/review-students', authorize('supervisor'), partnerDeployment.reviewStudentAssignments);
router.get('/partner-deployments/:id/review-options', authorize('supervisor'), partnerDeployment.options);
router.get('/partner-deployments/:id', authorize('supervisor'), partnerDeployment.detail);
router.put('/partner-deployments/:id/review', authorize('supervisor'), partnerDeployment.review);
router.put('/partner-deployments/:id/amendment', authorize('supervisor'), partnerDeployment.proposeAmendment);
router.put('/partner-deployments/:id/amendment-decision', authorize('supervisor'), partnerDeployment.decideAmendment);

// Supervisor: their partner institutions and the students assigned to each.
router.get('/partner-institutions', authorize('supervisor'), supervisor.getSupervisorPartnerInstitutions);
router.get('/partner-institutions/:institutionId/students', authorize('supervisor'), supervisor.getSupervisorPartnerInstitutionStudents);

// Legacy batch endpoints
router.get('/batches', authorize('supervisor'), supervisor.getSupervisorBatchStudents);
router.get('/batches/:requestId/attendance', authorize('supervisor'), supervisor.getBatchAttendance);

// Per-student progress (requirements, attendance, daily documentation).
// The controller scopes the student to the calling supervisor.
router.get(
  '/students/:studentId/progress',
  authorize('supervisor'),
  supervisor.getStudentProgress
);
router.get(
  '/batches/:batchId/blocked-dates',
  authorize('supervisor'),
  immersionExclusions.getBlockedDates
);
router.get('/holidays', authorize('supervisor'), immersionExclusions.getHolidays);
router.post('/holidays', authorize('supervisor'), immersionExclusions.addHoliday);
router.delete('/holidays/:id', authorize('supervisor'), immersionExclusions.removeHoliday);

router.get('/reports-concerns', authorize('supervisor'), supervisor.getReportsConcerns);
router.post('/reports-concerns', authorize('supervisor'), supervisor.createReportConcern);
router.delete('/reports-concerns/:id', authorize('supervisor'), supervisor.deleteReportConcern);

module.exports = router;
