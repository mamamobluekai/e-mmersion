const express = require('express');
const multer = require('multer');

const {
  getMySubmissionStatus,
  getProgress,
  getMyPlacementInfo,
} = require('../controllers/studentControllers/student.controller');
const {
  getRequirements,
  upsertRequirements,
  submitRequirements,
  uploadDocument,
  deleteDocument,
} = require('../controllers/coordinatorControllers/requirements.controller');
const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');
const { getStudentJourney } = require('../services/studentJourney.service');
const { requireImmersion, requirePostImmersion } = require('../middleware/studentJourneyAccess');

const router = express.Router();
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(authenticate);

router.get('/requirements/me', authorize('student'), getRequirements);
router.get('/requirements/me/status', authorize('student'), getMySubmissionStatus);
router.get('/journey', authorize('student'), async (req, res) => {
  try {
    res.json(await getStudentJourney(req.user.id));
  } catch (error) {
    console.error('Could not load student journey:', error);
    res.status(503).json({ error: 'Could not load your immersion journey. Try again.' });
  }
});
router.get('/progress', authorize('student'), requirePostImmersion, getProgress);
router.get('/placement/me', authorize('student'), requireImmersion, getMyPlacementInfo);
router.put('/requirements/me', authorize('student'), upsertRequirements);
router.post('/requirements/me/submit', authorize('student'), submitRequirements);
router.post('/documents/me/upload', authorize('student'), uploadMemory.single('file'), uploadDocument);
router.delete('/documents/me/:id', authorize('student'), deleteDocument);

module.exports = router;
