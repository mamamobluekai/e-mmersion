const express = require('express');
const router = express.Router();
const { requireImmersion } = require('../middleware/studentJourneyAccess');
const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');
const {
  getStudentDailyDocs,
  submitDailyDoc,
  gradeDailyDoc,
  getDocumentationCriteria,
  saveDocumentationCriteria,
  getDailyDocSummary,
} = require('../controllers/documentationController');

router.use(authenticate);

const reviewers = ['teacher', 'supervisor', 'coordinator', 'admin'];

router.get('/daily', authorize(...reviewers, 'student'), requireImmersion, getStudentDailyDocs);
router.post('/daily/submit', authorize('student'), requireImmersion, submitDailyDoc);
router.post('/daily/:docId/grade', authorize(...reviewers), gradeDailyDoc);
router.get('/criteria', authorize(...reviewers, 'student'), requireImmersion, getDocumentationCriteria);
router.put('/criteria', authorize('teacher', 'coordinator', 'admin'), saveDocumentationCriteria);
router.get('/batch/:batchId/summary', authorize(...reviewers), getDailyDocSummary);
router.get('/partner-institutions/:institutionId/summary', authorize(...reviewers), getDailyDocSummary);

module.exports = router;
