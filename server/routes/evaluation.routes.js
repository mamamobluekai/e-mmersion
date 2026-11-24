const express = require('express');
const router = express.Router();
const evaluation = require('../controllers/evaluationControllers/evaluation.controller');
const immersionFeedback = require('../controllers/evaluationControllers/immersionFeedback.controller');
const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');

const { requirePostImmersion } = require('../middleware/studentJourneyAccess');

router.use(authenticate);

router.get('/immersion-feedback/form', authorize('student'), requirePostImmersion, immersionFeedback.getMyFeedbackForm);
router.post('/immersion-feedback/submit', authorize('student'), requirePostImmersion, immersionFeedback.submitMyFeedback);
router.get('/immersion-feedback/criteria', authorize('coordinator'), immersionFeedback.getCriteria);
router.put('/immersion-feedback/criteria', authorize('coordinator'), immersionFeedback.saveCriteria);
router.get('/immersion-feedback/institutions', authorize('coordinator'), immersionFeedback.getInstitutionRatings);
router.get('/immersion-feedback/supervisor', authorize('supervisor'), immersionFeedback.getMySupervisorRatings);

router.get('/criteria', requirePostImmersion, evaluation.getCriteria);

router.put('/criteria', authorize('supervisor', 'coordinator', 'admin'), evaluation.saveCriteria);

router.post('/submit', authorize('supervisor'), evaluation.submitEvaluation);

router.get('/student/:studentId', authorize('supervisor', 'coordinator', 'teacher', 'admin'), evaluation.getStudentEvaluation);

router.get('/batch/:batchId', authorize('supervisor', 'coordinator', 'teacher', 'admin'), evaluation.listBatchEvaluations);

router.get('/my-students', authorize('supervisor'), evaluation.listMyStudents);

router.get('/me', authorize('student'), requirePostImmersion, evaluation.getMyEvaluation);

router.get('/teacher/my-batch', authorize('teacher'), evaluation.getTeacherBatchEvaluations);

module.exports = router;
