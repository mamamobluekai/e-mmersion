const assert = require('assert');
const { validateStudentPayload } = require('../controllers/coordinatorControllers/regexes/validation');
const {
  studentSubmissionBlockMessage,
  reviewStatusTransitionError,
} = require('../controllers/coordinatorControllers/requirementsSubmissionPolicy');

assert.deepStrictEqual(validateStudentPayload({ age: '16' }, true), {});
assert(validateStudentPayload({ age: '0' }, true).age);
assert(studentSubmissionBlockMessage('Approved'));
assert(studentSubmissionBlockMessage('Hold'));
assert.strictEqual(studentSubmissionBlockMessage('Needs Revision'), null);
assert.strictEqual(studentSubmissionBlockMessage('Pending'), null);
assert.strictEqual(reviewStatusTransitionError('Hold', 'Pending'), null);
assert(reviewStatusTransitionError('Hold', 'Approved'));
assert.strictEqual(reviewStatusTransitionError('Approved', 'Hold'), null);
assert(reviewStatusTransitionError('Approved', 'Pending'));

console.log('Requirements self-test passed.');
