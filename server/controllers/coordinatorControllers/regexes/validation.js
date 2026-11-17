const { requiredInfoFields, emailRegex, phoneRegex } = require('../helpers/constant');

// A work immersion student is Grade 12, so the youngest accepted age is 17.
const MIN_AGE = 17;
const MAX_AGE = 120;

const normalize = (value) => (typeof value === 'string' ? value.trim() : value);

const validateStudentPayload = (body, partial = false) => {
  const errors = {};
  const source = body || {};

  if (!partial) {
    requiredInfoFields.forEach((field) => {
      if (!normalize(source[field])) errors[field] = 'This field is required.';
    });
  }

  ['email', 'guardian_email'].forEach((field) => {
    if (source[field] && !emailRegex.test(source[field])) errors[field] = 'Enter a valid email address.';
  });

  ['contact_number', 'guardian_contact', 'emergency_contact_number'].forEach((field) => {
    if (source[field] && !phoneRegex.test(source[field])) errors[field] = 'Enter a valid phone number.';
  });

  if (source.age) {
    const age = Number(source.age);
    if (!Number.isFinite(age) || !Number.isInteger(age)) errors.age = 'Age must be a whole number.';
    else if (age < MIN_AGE) errors.age = `Age must be ${MIN_AGE} or above.`;
    else if (age > MAX_AGE) errors.age = `Age must be ${MAX_AGE} or below.`;
  }

  return errors;
};

module.exports = {
  normalize,
  validateStudentPayload,
};