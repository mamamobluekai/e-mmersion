-- Legacy requests and batches retain their existing workflow.
ALTER TABLE teacher_batches
  ADD COLUMN IF NOT EXISTS partner_institution_id INTEGER REFERENCES partner_institutions(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS idx_teacher_batches_supervisor_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_batches_legacy_supervisor
  ON teacher_batches (supervisor_id)
  WHERE supervisor_id IS NOT NULL AND partner_institution_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_teacher_batches_supervisor_lookup ON teacher_batches (supervisor_id);

ALTER TABLE deployment_requests
  ADD COLUMN IF NOT EXISTS workflow_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS partner_institution_id INTEGER REFERENCES partner_institutions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS immersion_period_id INTEGER REFERENCES immersion_periods(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS teacher_batch_id INTEGER REFERENCES teacher_batches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS creation_key UUID,
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proposal JSONB,
  ADD COLUMN IF NOT EXISTS confirmed_schedule JSONB,
  ADD COLUMN IF NOT EXISTS schedule_amendment JSONB,
  ADD COLUMN IF NOT EXISTS school_clearance JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_deployment_creation
  ON deployment_requests (coordinator_id, creation_key) WHERE creation_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_deployment_batch
  ON deployment_requests (teacher_batch_id) WHERE teacher_batch_id IS NOT NULL AND workflow_version = 2;
CREATE INDEX IF NOT EXISTS idx_partner_deployment_partner
  ON deployment_requests (partner_institution_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_partner_deployment_inbox
  ON deployment_requests (supervisor_id, id DESC) WHERE workflow_version = 2;

-- Additional approved affiliations supplement the institution's existing primary contact.
CREATE TABLE IF NOT EXISTS partner_deployment_supervisors (
  institution_id INTEGER NOT NULL REFERENCES partner_institutions(id) ON DELETE RESTRICT,
  supervisor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authorized_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, supervisor_user_id)
);

CREATE TABLE IF NOT EXISTS partner_deployment_events (
  id BIGSERIAL PRIMARY KEY,
  deployment_request_id INTEGER NOT NULL REFERENCES deployment_requests(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_deployment_events_request
  ON partner_deployment_events (deployment_request_id, id DESC);

ALTER TABLE teacher_batch_students
  ADD COLUMN IF NOT EXISTS deployment_started_on DATE,
  ADD COLUMN IF NOT EXISTS deployment_ended_on DATE;
CREATE INDEX IF NOT EXISTS idx_deployment_roster_student
  ON teacher_batch_students (student_id, deployment_ended_on);

ALTER TABLE partner_deployment_supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_deployment_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE archive_deployment_requests ADD COLUMN IF NOT EXISTS partner_deployment JSONB;
