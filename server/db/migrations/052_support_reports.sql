-- Apply with: node scripts/runMigration.js db/migrations/052_support_reports.sql

CREATE TABLE IF NOT EXISTS support_reports (
  id BIGSERIAL PRIMARY KEY,
  reference_id VARCHAR(20) NOT NULL UNIQUE,
  submitted_name VARCHAR(255) NOT NULL CHECK (char_length(btrim(submitted_name)) BETWEEN 1 AND 255),
  submitted_email VARCHAR(255) NOT NULL CHECK (submitted_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  role VARCHAR(50) NOT NULL CHECK (role IN ('student', 'teacher', 'supervisor', 'coordinator', 'admin')),
  submitted_role_id VARCHAR(100),
  category VARCHAR(100) NOT NULL CHECK (category IN (
    'Login or Account Access',
    'Forgot Password / Password Reset',
    'Technical Issue or System Error',
    'Page Not Loading',
    'Incorrect or Missing Information',
    'Feature Not Working Properly',
    'Account Information Concern',
    'General Inquiry',
    'Complaint or Feedback',
    'Other'
  )),
  category_other TEXT,
  subject VARCHAR(255) NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 255),
  description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 5000),
  attachment_url TEXT,
  attachment_name TEXT,
  attachment_size INTEGER,
  attachment_mime_type VARCHAR(100),
  priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE support_reports ADD COLUMN IF NOT EXISTS submitted_role_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_support_reports_reference_id ON support_reports (reference_id);
CREATE INDEX IF NOT EXISTS idx_support_reports_status_created ON support_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_reports_role ON support_reports (role);
CREATE INDEX IF NOT EXISTS idx_support_reports_category ON support_reports (category);
CREATE INDEX IF NOT EXISTS idx_support_reports_priority ON support_reports (priority);
CREATE INDEX IF NOT EXISTS idx_support_reports_assigned_to ON support_reports (assigned_to);

CREATE TABLE IF NOT EXISTS support_report_attachments (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
  cloudinary_public_id TEXT NOT NULL,
  cloudinary_url TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_report_attachments_report_id ON support_report_attachments (report_id);

CREATE TABLE IF NOT EXISTS support_report_replies (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('admin', 'system')),
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_report_replies_report_id ON support_report_replies (report_id, created_at);

CREATE TABLE IF NOT EXISTS support_report_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('admin', 'system')),
  action VARCHAR(100) NOT NULL,
  field VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_report_activity_logs_report_id ON support_report_activity_logs (report_id, created_at);

ALTER TABLE support_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_report_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_report_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_report_activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON support_reports, support_report_attachments, support_report_replies, support_report_activity_logs FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON support_reports, support_report_attachments, support_report_replies, support_report_activity_logs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON support_reports, support_report_attachments, support_report_replies, support_report_activity_logs FROM authenticated;
  END IF;
END $$;
