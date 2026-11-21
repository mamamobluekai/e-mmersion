const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  getPendingStudents,
  getStudentStrands,
  approveStudent,
  disapproveStudent,
  resendStudentApprovalLink,
  bulkApproveStudents,
  bulkDisapproveStudents,
  upsertRequirements,
  submitRequirements,
  getRequirements,
  uploadDocument,
  deleteDocument,
  listSubmissions,
  reviewSubmission,
  reviewRequirement,
  bulkReviewSubmissions,
  listDocumentTypes,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  restoreDocumentType,
  permanentDeleteDocumentType,
  createTeacherBatch,
  updateTeacherBatch,
  deleteTeacherBatch,
  archiveTeacherBatch,
  restoreTeacherBatch,
  assignApprovedStudentsToBatch,
  getMyTeacherBatches,
  getTeacherBatchStudents,
  getTeacherBatchById,
  getTeachersListForCoordinator,
  getSupervisorsListForCoordinator,
  listPartnerInstitutions,
  createPartnerInstitution,
  updatePartnerInstitution,
  deactivatePartnerInstitution,
  reactivatePartnerInstitution,
  replacePartnerSupervisor,
  updatePartnerSupervisor,
  deactivatePartnerSupervisor,
  resendPartnerSupervisorActivation,
  getCoordinatorsForSupervisor,
  getCoordinatorBatchesWithAssignedStudents,
  getArchivedCoordinatorBatches,
  getRequirementCompletedStudentsForCoordinator,
  createSupervisorRequest,
  createDeploymentRequest,
  getMyDeploymentRequests,
  getSupervisorDeploymentRequests,
  getDeploymentRequestStudents,
  approveDeploymentRequest,
  rejectDeploymentRequest,
  deleteDeploymentRequest,
  fulfillSupervisorRequest,
  getCoordinatorDashboard,
  getCoordinatorProfile,
  archiveStudent,
  restoreStudent,
  permanentDeleteStudent,
  getArchivedStudents,
  bulkArchiveStudents,
  bulkRestoreStudents,
  bulkPermanentDeleteStudents,
  updateStudentEmail,
  getAllStudents,
  getSpecialNeedsStudents,
} = require('../controllers/coordinatorControllers');
const { getTeacherReportsConcerns, confirmReportConcern } = require('../controllers/supervisorControllers/supervisor.controller');
const { uploadStudentsExcel } = require('../controllers/coordinatorControllers/uploadStudents.controller');
const { createStudentAccountReport } = require('../controllers/accountProblem.controller');
const partnerDeployment = require('../controllers/coordinatorControllers/partnerDeployment.controller');
const { requireLegacyBatch } = require('../middleware/requireLegacyBatch');

const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');

const router = express.Router();
const uploadsDir = path.join(__dirname, '../uploads/requirements');
fs.mkdirSync(uploadsDir, { recursive: true });
const uploadExcel = multer({ storage: multer.memoryStorage() });
const uploadDoc = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(authenticate);

router.get('/dashboard', authorize('coordinator', 'admin'), getCoordinatorDashboard);
router.get('/profile', authorize('coordinator', 'admin'), getCoordinatorProfile);

router.get('/students/pending', authorize('coordinator', 'admin'), getPendingStudents);
router.get('/students/all', authorize('coordinator', 'admin'), getAllStudents);
router.get('/students/special', authorize('coordinator'), getSpecialNeedsStudents);
router.get('/students/strands', authorize('coordinator', 'admin'), getStudentStrands);
router.post('/students/:studentId/reports', authorize('coordinator'), createStudentAccountReport);
router.post('/students/upload', authorize('coordinator', 'admin'), uploadExcel.single('file'), uploadStudentsExcel);
// Register literal bulk paths before the matching parameterized :id paths.
router.put('/students/bulk/approve', authorize('coordinator', 'admin'), bulkApproveStudents);
router.put('/students/bulk/disapprove', authorize('coordinator', 'admin'), bulkDisapproveStudents);
router.post('/students/bulk/archive', authorize('coordinator', 'admin'), bulkArchiveStudents);
router.post('/students/bulk/restore', authorize('coordinator', 'admin'), bulkRestoreStudents);
router.delete('/students/bulk/permanent', authorize('coordinator', 'admin'), bulkPermanentDeleteStudents);
router.put('/students/:id/approve', authorize('coordinator', 'admin'), approveStudent);
router.put('/students/:id/disapprove', authorize('coordinator', 'admin'), disapproveStudent);
router.post('/students/:id/resend-approval', authorize('coordinator', 'admin'), resendStudentApprovalLink);
router.put('/students/:id/email', authorize('coordinator', 'admin'), updateStudentEmail);
router.post('/students/:id/restore', authorize('coordinator', 'admin'), restoreStudent);
router.delete('/students/:id/permanent', authorize('coordinator', 'admin'), permanentDeleteStudent);
router.delete('/students/:id', authorize('coordinator', 'admin'), archiveStudent);
router.get('/students/archived', authorize('coordinator', 'admin'), getArchivedStudents);

router.put('/requirements', authorize('student', 'coordinator', 'admin'), upsertRequirements);
router.post('/requirements/submit', authorize('student', 'coordinator', 'admin'), submitRequirements);
router.get('/requirements/:studentId', authorize('student', 'coordinator', 'admin'), getRequirements);
router.post('/documents/upload', authorize('student', 'coordinator', 'admin'), uploadDoc.single('file'), uploadDocument);
router.delete('/documents/:id', authorize('student', 'coordinator', 'admin'), deleteDocument);

router.get('/submissions', authorize('coordinator', 'admin'), listSubmissions);
// Registered before '/submissions/:id/review' so the literal segment wins over
// the parametric one.
router.post('/submissions/bulk-review', authorize('coordinator', 'admin'), bulkReviewSubmissions);
router.put('/submissions/:submissionId/requirements/:documentTypeId/review', authorize('coordinator', 'admin'), reviewRequirement);
router.post('/submissions/:id/review', authorize('coordinator', 'admin'), reviewSubmission);

router.get('/document-types', authorize('student', 'coordinator', 'admin', 'teacher', 'supervisor'), listDocumentTypes);
router.post('/document-types', authorize('coordinator', 'admin'), createDocumentType);
router.put('/document-types/:id', authorize('coordinator', 'admin'), updateDocumentType);
router.delete('/document-types/:id', authorize('coordinator', 'admin'), deleteDocumentType);

router.put('/document-types/:id/restore', authorize('coordinator', 'admin'), restoreDocumentType);
router.delete('/document-types/:id/permanent', authorize('coordinator', 'admin'), permanentDeleteDocumentType);

router.post('/teacher-batches', authorize('coordinator', 'admin'), createTeacherBatch);
router.put('/teacher-batches/:batchId', authorize('coordinator', 'admin'), requireLegacyBatch, updateTeacherBatch);
router.delete('/teacher-batches/:batchId', authorize('coordinator', 'admin'), requireLegacyBatch, deleteTeacherBatch);
router.post('/teacher-batches/:batchId/archive', authorize('coordinator', 'admin'), requireLegacyBatch, archiveTeacherBatch);
router.post('/teacher-batches/:batchId/restore', authorize('coordinator', 'admin'), requireLegacyBatch, restoreTeacherBatch);
router.post('/teacher-batches/:batchId/assign', authorize('coordinator', 'admin'), requireLegacyBatch, assignApprovedStudentsToBatch);
router.get('/teacher-batches/me', authorize('teacher', 'coordinator', 'admin'), getMyTeacherBatches);
router.get('/teacher-batches/:batchId', authorize('coordinator', 'admin'), getTeacherBatchById);
router.get('/teacher-batches/:batchId/students', authorize('teacher', 'coordinator', 'admin'), getTeacherBatchStudents);
router.get('/teacher/reports-concerns', authorize('teacher', 'coordinator', 'admin'), getTeacherReportsConcerns);
router.patch('/teacher/reports-concerns/:reportId/confirm', authorize('teacher', 'coordinator', 'admin'), confirmReportConcern);
router.get('/teachers', authorize('coordinator', 'admin'), getTeachersListForCoordinator);
router.get('/supervisors', authorize('coordinator', 'admin'), getSupervisorsListForCoordinator);
router.get('/partner-institutions', authorize('coordinator'), listPartnerInstitutions);
router.post('/partner-institutions', authorize('coordinator'), createPartnerInstitution);
router.put('/partner-institutions/:id', authorize('coordinator'), updatePartnerInstitution);
router.post('/partner-institutions/:id/deactivate', authorize('coordinator'), deactivatePartnerInstitution);
router.post('/partner-institutions/:id/reactivate', authorize('coordinator'), reactivatePartnerInstitution);
router.post('/partner-institutions/:id/supervisors', authorize('coordinator'), replacePartnerSupervisor);
router.put('/partner-institutions/:id/supervisors/:userId', authorize('coordinator'), updatePartnerSupervisor);
router.post('/partner-institutions/:id/supervisors/:userId/deactivate', authorize('coordinator'), deactivatePartnerSupervisor);
router.post('/partner-institutions/:id/supervisors/:userId/resend-activation', authorize('coordinator'), resendPartnerSupervisorActivation);
router.get('/coordinators', authorize('supervisor', 'coordinator', 'admin'), getCoordinatorsForSupervisor);
router.get('/batches/assigned', authorize('coordinator', 'admin'), getCoordinatorBatchesWithAssignedStudents);
router.get('/batches/archived', authorize('coordinator', 'admin'), getArchivedCoordinatorBatches);
router.get('/students/completed', authorize('coordinator', 'admin'), getRequirementCompletedStudentsForCoordinator);

router.post('/supervisor-requests', authorize('supervisor', 'coordinator', 'admin'), createSupervisorRequest);
router.post('/deployment-requests', authorize('coordinator', 'admin'), createDeploymentRequest);
router.get('/deployment-requests/me', authorize('coordinator', 'admin'), getMyDeploymentRequests);
router.get('/deployment-requests/supervisor', authorize('supervisor', 'coordinator', 'admin'), getSupervisorDeploymentRequests);
router.get('/deployment-requests/:requestId/students', authorize('coordinator', 'supervisor', 'admin'), getDeploymentRequestStudents);
router.put('/deployment-requests/:requestId/approve', authorize('supervisor', 'coordinator', 'admin'), approveDeploymentRequest);
router.put('/deployment-requests/:requestId/reject', authorize('supervisor', 'coordinator', 'admin'), rejectDeploymentRequest);
router.delete('/deployment-requests/:requestId', authorize('coordinator', 'admin'), deleteDeploymentRequest);
router.post('/deployment-requests/:requestId/fulfill', authorize('coordinator', 'admin'), fulfillSupervisorRequest);

const schoolRoles = authorize('coordinator', 'admin');
router.get('/partner-deployments/options', schoolRoles, partnerDeployment.options);
router.get('/partner-deployments/partners', schoolRoles, partnerDeployment.partners);
router.get('/partner-deployments/partners/:partnerId', schoolRoles, partnerDeployment.partnerDetail);
router.get('/partner-deployments', schoolRoles, partnerDeployment.list);
router.post('/partner-deployments', schoolRoles, partnerDeployment.create);
router.get('/partner-deployments/:id', schoolRoles, partnerDeployment.detail);
router.put('/partner-deployments/:id/resubmit', schoolRoles, partnerDeployment.resubmit);
router.put('/partner-deployments/:id/clearance', schoolRoles, partnerDeployment.schoolClearance);
router.put('/partner-deployments/:id/return-schedule', schoolRoles, partnerDeployment.returnSchedule);
router.put('/partner-deployments/:id/cancel', schoolRoles, partnerDeployment.cancel);
router.get('/partner-deployments/:id/candidates', schoolRoles, partnerDeployment.candidates);
router.put('/partner-deployments/:id/roster', schoolRoles, partnerDeployment.updateRoster);
router.put('/partner-deployments/:id/review', authorize('admin'), partnerDeployment.review);
router.put('/partner-deployments/:id/schedule', authorize('admin'), partnerDeployment.setSchedule);

module.exports = router;
