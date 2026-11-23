BEGIN;

ALTER TABLE students ADD COLUMN IF NOT EXISTS preferred_partner_institution_id integer
  REFERENCES partner_institutions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS partner_student_assignments (
  deployment_request_id integer NOT NULL REFERENCES deployment_requests(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'released')),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_by integer REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decided_by integer REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason text,
  PRIMARY KEY (deployment_request_id, student_id),
  CHECK (status <> 'rejected' OR NULLIF(btrim(rejection_reason), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_student_open_assignment
  ON partner_student_assignments (student_id) WHERE status IN ('pending', 'accepted', 'rejected');

COMMIT;
