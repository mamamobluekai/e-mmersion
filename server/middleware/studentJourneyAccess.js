const { getPreImmersion, getStudentJourney } = require('../services/studentJourney.service');

function requireStudentStage(stage) {
  return async (req, res, next) => {
    if (req.user.role !== 'student') return next();

    try {
      const pre = await getPreImmersion(req.user.id);
      if (!pre.complete) {
        return res.status(403).json({
          code: 'STUDENT_STAGE_LOCKED',
          error: 'Complete coordinator approval in Pre-Immersion first.',
        });
      }
      if (stage === 'post') {
        const journey = await getStudentJourney(req.user.id, pre);
        if (journey.stages.post === 'locked') {
          return res.status(403).json({
            code: 'STUDENT_STAGE_LOCKED',
            error: 'Complete the Immersion Proper missions and required hours first.',
          });
        }
        res.locals.studentJourney = journey;
      }
      return next();
    } catch (error) {
      console.error('Student stage access check failed:', error);
      return res.status(503).json({ error: 'Could not verify your immersion stage. Try again.' });
    }
  };
}

module.exports = {
  requireImmersion: requireStudentStage('immersion'),
  requirePostImmersion: requireStudentStage('post'),
};
