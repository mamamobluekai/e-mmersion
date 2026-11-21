const express = require('express');
const authenticate = require('../middleware/verifyToken');
const controller = require('../controllers/appeal.controller');

const router = express.Router();
const { requirePostImmersion } = require('../middleware/studentJourneyAccess');

router.use(authenticate);

// Student routes
router.post('/', requirePostImmersion, controller.submitAppeal);
router.get('/my', requirePostImmersion, controller.getMyAppeals);

// Supervisor routes
router.get('/supervisor', controller.getSupervisorAppeals);
router.patch('/:appealId/respond', controller.respondToAppeal);

module.exports = router;