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

module.exports = {
  studentSubmissionBlockMessage,
  reviewStatusTransitionError,
};
