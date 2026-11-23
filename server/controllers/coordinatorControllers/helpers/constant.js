// Grade Level is not listed here: it is fixed at "Grade 12" for every student
// (see ensureDefaultGradeLevel in regexes/requirementsHelpers.js), so the
// student is never asked for it and never blocked on it.
const requiredInfoFields = [
  'student_number', 'first_name', 'last_name', 'gender', 'birthdate', 'age',
  'contact_number', 'email', 'home_address', 'section',
  'track_strand', 'school', 'career_goal', 'industry_reason',
  'guardian_name', 'guardian_relationship', 'guardian_contact', 'guardian_email',
  'guardian_address', 'emergency_contact', 'emergency_contact_number',
];

// Every student on work immersion is Grade 12; the value is stored rather than
// asked for, because coordinator and admin views list and group by it.
const DEFAULT_GRADE_LEVEL = 'Grade 12';
const DEFAULT_STUDENT_SCHOOL = 'Marinduque National High School';

const requiredDocumentCodes = [
  'guardian_consent',
  'medical_certificate',
  'accident_insurance',
  'vaccination_record',
  'emergency_contact_form',
  'form_138',
  'good_moral',
  'psa_birth_certificate',
  'id_picture',
  'student_profile_form',
];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[0-9+\-\s()]{7,20}$/;

module.exports = {
  requiredInfoFields,
  requiredDocumentCodes,
  DEFAULT_GRADE_LEVEL,
  DEFAULT_STUDENT_SCHOOL,
  emailRegex,
  phoneRegex,
};
