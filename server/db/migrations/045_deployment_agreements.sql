-- Apply after 044_partner_deployments.sql with:
--   node scripts/runMigration.js db/migrations/045_deployment_agreements.sql
-- Retires batch-first requests after snapshotting them; published batches and
-- their academic records remain available.
ALTER TABLE deployment_requests
  ADD COLUMN IF NOT EXISTS original_proposal JSONB,
  ADD COLUMN IF NOT EXISTS counterproposal JSONB,
  ADD COLUMN IF NOT EXISTS agreement JSONB;

ALTER TABLE teacher_batches ALTER COLUMN teacher_id DROP NOT NULL;
ALTER TABLE attendance_appeals ALTER COLUMN teacher_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS partner_deployment_teachers (
  deployment_request_id INTEGER NOT NULL REFERENCES deployment_requests(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY (deployment_request_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_deployment_teachers_lookup ON partner_deployment_teachers (teacher_id, deployment_request_id);
ALTER TABLE partner_deployment_teachers ENABLE ROW LEVEL SECURITY;

INSERT INTO partner_deployment_teachers (deployment_request_id, teacher_id)
SELECT id, teacher_id FROM deployment_requests WHERE workflow_version = 2 AND teacher_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Keep already-published schedules and their academic records. An unpublished
-- confirmation must return to the coordinator for explicit bilateral agreement.
WITH returned AS (
  UPDATE deployment_requests
  SET original_proposal = COALESCE(proposal, '{}'::jsonb), status = 'changes_requested', confirmed_schedule = NULL,
      schedule_amendment = NULL, counterproposal = NULL, school_clearance = NULL,
      revision = revision + 1, updated_at = now()
  WHERE workflow_version = 2 AND original_proposal IS NULL AND teacher_batch_id IS NULL AND agreement IS NULL
    AND status IN ('pending', 'approved')
  RETURNING id, proposal
)
INSERT INTO partner_deployment_events (deployment_request_id, action, after_state, reason)
SELECT id, 'agreement_required', proposal, 'Submit the dates and capacity for agreement under the new workflow.'
FROM returned;

UPDATE deployment_requests
SET original_proposal = proposal
WHERE workflow_version = 2 AND original_proposal IS NULL AND status <> 'draft' AND proposal IS NOT NULL;

WITH old_amendments AS (
  SELECT id, schedule_amendment FROM deployment_requests
  WHERE workflow_version = 2 AND agreement IS NULL AND schedule_amendment IS NOT NULL
), cleared AS (
  UPDATE deployment_requests dr SET schedule_amendment = NULL, revision = revision + 1
  FROM old_amendments old WHERE old.id = dr.id
  RETURNING dr.id, old.schedule_amendment
)
INSERT INTO partner_deployment_events (deployment_request_id, action, before_state, reason)
SELECT id, 'amendment_requires_agreement', schedule_amendment, 'The amendment must be proposed again for bilateral agreement.'
FROM cleared;

CREATE INDEX IF NOT EXISTS idx_partner_deployment_students_schedule
  ON teacher_batch_students (student_id, teacher_batch_id, deployment_started_on, deployment_ended_on);

CREATE TABLE IF NOT EXISTS retired_deployment_requests (
  original_request_id INTEGER PRIMARY KEY,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot JSONB NOT NULL
);
ALTER TABLE retired_deployment_requests ENABLE ROW LEVEL SECURITY;

-- Explicitly retire only the batch-first workflow. Keep batch IDs and foreign
-- keys so attendance, documentation, evaluations and certificates stay intact.
INSERT INTO retired_deployment_requests (original_request_id, snapshot)
SELECT dr.id, jsonb_build_object('request', to_jsonb(dr), 'students', COALESCE((
  SELECT jsonb_agg(to_jsonb(student) ORDER BY student.id)
  FROM deployment_request_students student WHERE student.deployment_request_id = dr.id
), '[]'::jsonb))
FROM deployment_requests dr WHERE dr.workflow_version = 1
ON CONFLICT DO NOTHING;

DELETE FROM deployment_requests WHERE workflow_version = 1;

UPDATE teacher_batches SET archived_at = now()
WHERE partner_institution_id IS NULL AND archived_at IS NULL;

ALTER TABLE deployment_requests DROP CONSTRAINT IF EXISTS deployment_requests_agreement_state;
ALTER TABLE deployment_requests ADD CONSTRAINT deployment_requests_agreement_state CHECK (
  workflow_version <> 2 OR NOT (proposal ? 'dates') OR (
    status IN ('draft', 'pending', 'changes_requested', 'pending_coordinator_agreement', 'approved', 'rejected', 'cancelled', 'ongoing', 'completed')
    AND (status <> 'pending_coordinator_agreement' OR counterproposal IS NOT NULL)
    AND (status <> 'approved' OR teacher_batch_id IS NOT NULL OR (agreement IS NOT NULL AND confirmed_schedule IS NOT NULL))
    AND (teacher_batch_id IS NULL OR confirmed_schedule IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION enforce_deployment_attendance_day() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM deployment_requests dr WHERE dr.teacher_batch_id = NEW.teacher_batch_id AND dr.workflow_version = 2)
     AND NOT EXISTS (
       SELECT 1 FROM deployment_requests dr
       JOIN teacher_batch_students tbs ON tbs.teacher_batch_id = dr.teacher_batch_id AND tbs.student_id = NEW.student_id
       WHERE dr.teacher_batch_id = NEW.teacher_batch_id AND dr.workflow_version = 2
         AND (dr.confirmed_schedule->'dates') ? NEW.date::text
         AND (tbs.deployment_started_on IS NULL OR NEW.date >= tbs.deployment_started_on)
         AND (tbs.deployment_ended_on IS NULL OR NEW.date < tbs.deployment_ended_on)
     ) THEN
    RAISE EXCEPTION 'Attendance must belong to an agreed workday for this student' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_deployment_attendance_day ON student_attendance;
CREATE TRIGGER enforce_deployment_attendance_day BEFORE INSERT OR UPDATE OF date, student_id, teacher_batch_id
ON student_attendance FOR EACH ROW EXECUTE FUNCTION enforce_deployment_attendance_day();
