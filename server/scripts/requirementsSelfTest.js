const assert = require('assert');
const { validateStudentPayload } = require('../controllers/coordinatorControllers/regexes/validation');
const {
  editableRequirementsPayload,
  canStudentUploadRequirementFile,
  studentSubmissionBlockMessage,
  reviewStatusTransitionError,
} = require('../controllers/coordinatorControllers/requirementsSubmissionPolicy');
const {
  formFieldsFor,
  missingFormFields,
} = require('../controllers/coordinatorControllers/regexes/formRequirements');
const {
  isStudentRequirementImage,
} = require('../controllers/coordinatorControllers/requirementsFilePolicy');

assert.deepStrictEqual(validateStudentPayload({ age: '16' }, true), {});
assert.deepStrictEqual(
  editableRequirementsPayload('student', { has_special_needs: false }),
  { has_special_needs: false }
);
assert(formFieldsFor('personal_information').some((field) => field.key === 'has_special_needs'));
assert(!missingFormFields({ has_special_needs: false }, 'personal_information').includes('has_special_needs'));
assert(validateStudentPayload({ age: '0' }, true).age);
assert(studentSubmissionBlockMessage('Approved'));
assert(studentSubmissionBlockMessage('Hold'));
assert.strictEqual(studentSubmissionBlockMessage('Needs Revision'), null);
assert.strictEqual(studentSubmissionBlockMessage('Pending'), null);
assert.strictEqual(reviewStatusTransitionError('Hold', 'Pending'), null);
assert(reviewStatusTransitionError('Hold', 'Approved'));
assert.strictEqual(reviewStatusTransitionError('Approved', 'Hold'), null);
assert(reviewStatusTransitionError('Approved', 'Pending'));
assert(canStudentUploadRequirementFile('Pending', null, false));
assert(canStudentUploadRequirementFile('Approved', null, false));
assert(canStudentUploadRequirementFile('Under Review', 'PENDING', false));
assert(!canStudentUploadRequirementFile('Pending', 'PENDING', true));
assert(!canStudentUploadRequirementFile('Approved', 'APPROVED', true));
assert(!canStudentUploadRequirementFile('Approved', 'APPROVED', false));
assert(!canStudentUploadRequirementFile('Hold', null, false));
assert(canStudentUploadRequirementFile('Pending', 'NEEDS REVISION', true));
assert(!canStudentUploadRequirementFile('Approved', 'NEEDS REVISION', true));

assert(isStudentRequirementImage({
  originalname: 'requirement.png',
  mimetype: 'image/png',
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
}));
assert(isStudentRequirementImage({
  originalname: 'requirement.jpeg',
  mimetype: 'image/jpeg',
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
}));
assert(!isStudentRequirementImage({
  originalname: 'requirement.jpg',
  mimetype: 'image/jpeg',
  buffer: Buffer.from('%PDF-1.7'),
}));
assert(!isStudentRequirementImage({
  originalname: 'requirement.gif',
  mimetype: 'image/gif',
  buffer: Buffer.from('GIF89a'),
}));

console.log('Requirements self-test passed.');
