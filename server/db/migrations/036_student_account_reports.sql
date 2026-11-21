CREATE TABLE IF NOT EXISTS student_account_reports (
  id BIGSERIAL PRIMARY KEY,
  student_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (
    reason IN ('remove_account', 'duplicate_account', 'incorrect_information', 'access_problem', 'other')
  ),
  comments TEXT NOT NULL CHECK (char_length(btrim(comments)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_note TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_account_reports_status_created
  ON student_account_reports (status, created_at DESC);
