const express = require('express');
const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');
const controller = require('../controllers/appeal.controller');

const router = express.Router();
const { requirePostImmersion } = require('../middleware/studentJourneyAccess');

router.use(authenticate);

// Student routes
router.post('/', authorize('student'), requirePostImmersion, controller.submitAppeal);
router.get('/my', authorize('student'), requirePostImmersion, controller.getMyAppeals);

// Supervisor routes
router.get('/supervisor', authorize('supervisor'), controller.getSupervisorAppeals);
router.patch('/:appealId/respond', authorize('supervisor'), controller.respondToAppeal);

module.exports = router;
