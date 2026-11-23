const { requiredInfoFields } = require('../helpers/constant');

/**
 * Form requirements.
 *
 * Most requirements are files the student uploads. Two of them are not: the
 * Personal Information and Guardian & Emergency sections are typed into the
 * Requirements page itself. They are stored as ordinary `document_types` rows
 * (so coordinators can rename, reorder, deactivate or delete them like any
 * other requirement) with `input_type = 'form'` instead of `'file'`.
 *
 * A form requirement counts as complete once every field it covers has a value
 * on the student record - there is no upload behind it, so completeness is
 * computed from the columns instead of from `student_documents`.
 */

const FIELD_LABELS = {
  student_number: 'Student Number',
  first_name: 'First Name',
  middle_name: 'Middle Name',
  last_name: 'Last Name',
  suffix: 'Suffix',
  gender: 'Gender',
  has_special_needs: 'Do you have a disability or special needs?',
  birthdate: 'Birthdate',
  age: 'Age',
  contact_number: 'Contact Number',
  email: 'Email',
  home_address: 'Home Address',
  grade_level: 'Grade Level',
  section: 'Section Name',
  track_strand: 'Track & Strand',
  school: 'School',
  preferred_industry: 'Preferred Industry',
  preferred_company: 'Preferred Company',
  career_goal: 'Career Goal',
  industry_reason: 'Reason for your preference',
  guardian_name: 'Guardian/Parent Name',
  guardian_relationship: 'Relationship',
  guardian_contact: 'Guardian Contact',
  guardian_email: 'Guardian Email',
  guardian_address: 'Guardian Address',
  emergency_contact: 'Emergency Contact Person',
  emergency_contact_number: 'Emergency Contact Number',
};

// `requiredInfoFields` is the single list of profile fields the student must
// fill in; the two sections below are the split the Requirements page shows.
const PERSONAL_FIELDS = [
  ...requiredInfoFields.filter(
    (field) => !field.startsWith('guardian_') && !field.startsWith('emergency_')
  ),
  'has_special_needs',
];

const GUARDIAN_FIELDS = requiredInfoFields.filter(
  (field) => field.startsWith('guardian_') || field.startsWith('emergency_')
);

const FORM_REQUIREMENTS = {
  personal_information: {
    name: 'Personal Information',
    section: 'personal',
    sort_order: 5,
    description: 'Filled in by the student under Personal Information.',
    fields: PERSONAL_FIELDS,
  },
  guardian_emergency: {
    name: 'Guardian & Emergency',
    section: 'guardian',
    sort_order: 15,
    description: 'Filled in by the student under Guardian & Emergency.',
    fields: GUARDIAN_FIELDS,
  },
};

const humanize = (field) =>
  String(field || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const fieldLabel = (field) => FIELD_LABELS[field] || humanize(field);

const definitionFor = (code) => FORM_REQUIREMENTS[String(code || '')] || null;

const isFormRequirementCode = (code) => !!definitionFor(code);

/**
 * A requirement is form-based when the row says so. Rows created before the
 * column existed default to files, except the two known form codes, which are
 * form-based however they were stored.
 */
const isFormRequirement = (type) =>
  String(type?.input_type || 'file').toLowerCase() === 'form' || isFormRequirementCode(type?.code);

const isFilled = (value) => {
  if (value === null || value === undefined) return false;
  // Students rows store cleared inputs as NULL; older rows may hold ''.
  return String(value).trim().length > 0;
};

/**
 * The profile fields of `code` that still have no value. An unknown form code
 * has no fields to check, so it reports nothing missing and never blocks.
 */
const missingFormFields = (student, code) => {
  const definition = definitionFor(code);
  if (!definition) return [];
  return definition.fields.filter((field) => !isFilled(student?.[field]));
};

const missingFormFieldLabels = (student, code) =>
  missingFormFields(student, code).map(fieldLabel);

/**
 * The fields a form requirement covers, as `{ key, label }` pairs. Sent to the
 * client so the "fill up before submitting" list can be rechecked against what
 * the student is typing instead of waiting for a save.
 */
const formFieldsFor = (code) => {
  const definition = definitionFor(code);
  if (!definition) return [];
  return definition.fields.map((key) => ({ key, label: fieldLabel(key) }));
};

const personalInformationComplete = (student) => missingFormFields(student, 'personal_information').length === 0;

const guardianEmergencyComplete = (student) => missingFormFields(student, 'guardian_emergency').length === 0;

/**
 * Seeds the two form requirements. Idempotent: `code` is UNIQUE and a row a
 * coordinator has since renamed or deactivated is left exactly as it is, so a
 * removed requirement is never silently brought back.
 */
const seedFormRequirements = async (client) => {
  const values = Object.entries(FORM_REQUIREMENTS).flatMap(([code, definition]) => [
    code,
    definition.name,
    definition.section,
    definition.sort_order,
    definition.description,
  ]);

  const placeholders = Object.keys(FORM_REQUIREMENTS)
    .map((_, index) => {
      const base = index * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, 'form', TRUE, $${base + 4}, $${base + 5})`;
    })
    .join(', ');

  await client.query(
    `INSERT INTO document_types (code, name, section, input_type, is_active, sort_order, description)
     VALUES ${placeholders}
     ON CONFLICT (code) DO NOTHING`,
    values
  );
};

module.exports = {
  FIELD_LABELS,
  FORM_REQUIREMENTS,
  GUARDIAN_FIELDS,
  PERSONAL_FIELDS,
  fieldLabel,
  formFieldsFor,
  guardianEmergencyComplete,
  isFormRequirement,
  isFormRequirementCode,
  missingFormFieldLabels,
  missingFormFields,
  personalInformationComplete,
  seedFormRequirements,
};
