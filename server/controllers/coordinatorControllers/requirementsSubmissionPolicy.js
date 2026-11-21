const studentSubmissionBlockMessage = (status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedStatus === 'approved') {
    return 'Approved requirements cannot be resubmitted by the student.';
  }
  if (normalizedStatus === 'hold') {
    return 'A coordinator must release this submission from hold before it can be resubmitted.';
  }
  return null;
};

const isMissingRequirementFile = (status, hasDocument) =>
  !hasDocument && (!status || status === 'PENDING');

const canStudentUploadRequirementFile = (submissionStatus, requirementStatus, hasDocument) => {
  const normalizedStatus = String(submissionStatus || '').trim().toLowerCase();
  if (normalizedStatus === 'hold') return false;
  if (isMissingRequirementFile(requirementStatus, hasDocument)) return true;
  return normalizedStatus !== 'approved' && requirementStatus === 'NEEDS REVISION';
};

const reviewStatusTransitionError = (currentStatus, nextStatus) => {
  const current = String(currentStatus || '').trim().toLowerCase();
  const next = String(nextStatus || '').trim().toLowerCase();

  if (current === 'approved' && !['approved', 'hold'].includes(next)) {
    return 'An approved submission can only stay approved or be put on hold.';
  }
  if (current === 'hold' && next !== 'pending') {
    return 'A held submission must be unheld to Pending before it can be reviewed again.';
  }
  if (next === 'hold' && current !== 'approved') {
    return 'Only an approved submission can be put on hold.';
  }
  return null;
};

const STAFF_MANAGED_STUDENT_FIELDS = new Set([
  'first_name', 'middle_name', 'last_name', 'email', 'section', 'track_strand', 'school',
]);

const editableRequirementsPayload = (role, body = {}) => {
  if (role !== 'student') return body;
  return Object.fromEntries(
    Object.entries(body).filter(([field]) => !STAFF_MANAGED_STUDENT_FIELDS.has(field))
  );
};

module.exports = {
  editableRequirementsPayload,
  isMissingRequirementFile,
  canStudentUploadRequirementFile,
  studentSubmissionBlockMessage,
  reviewStatusTransitionError,
};
