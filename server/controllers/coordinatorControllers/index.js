const studentApproval = require('./studentApproval.controller');
const requirements = require('./requirements.controller');
const teacherBatch = require('./teacherBatch.controller');
const dashboard = require('./dashboard.controller');
const partnerInstitution = require('./partnerInstitution.controller');

module.exports = {
  ...studentApproval,
  ...requirements,
  ...teacherBatch,
  ...dashboard,
  ...partnerInstitution,
};
