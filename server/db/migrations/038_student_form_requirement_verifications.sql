CREATE TABLE IF NOT EXISTS student_form_requirement_verifications (
  submission_id INTEGER NOT NULL REFERENCES student_requirement_submissions(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (submission_id, document_type_id)
);
