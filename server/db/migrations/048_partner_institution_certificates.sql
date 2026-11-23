SELECT pg_advisory_xact_lock(48024);

ALTER TABLE certificate_templates ADD COLUMN IF NOT EXISTS teacher_batch_id integer
  REFERENCES teacher_batches(id) ON DELETE CASCADE;
ALTER TABLE certificate_templates ADD COLUMN IF NOT EXISTS partner_institution_id integer
  REFERENCES partner_institutions(id) ON DELETE CASCADE;
ALTER TABLE certificate_templates DROP CONSTRAINT IF EXISTS certificate_templates_supervisor_id_key;
DROP INDEX IF EXISTS ux_certificate_templates_supervisor_default;
CREATE UNIQUE INDEX IF NOT EXISTS ux_certificate_templates_supervisor_fallback
  ON certificate_templates (supervisor_id)
  WHERE teacher_batch_id IS NULL AND partner_institution_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_certificate_templates_institution
  ON certificate_templates (supervisor_id, partner_institution_id)
  WHERE partner_institution_id IS NOT NULL;

ALTER TABLE certificates ADD COLUMN IF NOT EXISTS teacher_batch_id integer
  REFERENCES teacher_batches(id) ON DELETE SET NULL;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS deployment_request_id integer
  REFERENCES deployment_requests(id) ON DELETE SET NULL;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS partner_institution_id integer
  REFERENCES partner_institutions(id) ON DELETE SET NULL;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS template_snapshot jsonb;

CREATE INDEX IF NOT EXISTS idx_certificates_student_deployment
  ON certificates (student_id, deployment_request_id);

UPDATE certificates c
SET deployment_request_id = dr.id, partner_institution_id = dr.partner_institution_id
FROM deployment_requests dr
WHERE c.deployment_request_id IS NULL AND dr.workflow_version = 2
  AND dr.partner_institution_id IS NOT NULL AND c.teacher_batch_id = dr.teacher_batch_id
  AND (c.issued_by = dr.supervisor_id OR EXISTS (
    SELECT 1 FROM users issuer WHERE issuer.id = c.issued_by AND issuer.role = 'admin'
  ))
  AND EXISTS (
    SELECT 1 FROM teacher_batch_students member
    WHERE member.teacher_batch_id = dr.teacher_batch_id AND member.student_id = c.student_id
  );

-- Carry over the most recent design from a confirmed legacy placement at each institution.
INSERT INTO certificate_templates (supervisor_id, partner_institution_id, school_name, company_name,
  program_name, footer_text, border_color, title_text)
SELECT DISTINCT ON (ct.supervisor_id, dr.partner_institution_id) ct.supervisor_id, dr.partner_institution_id,
  ct.school_name, ct.company_name, ct.program_name, ct.footer_text, ct.border_color, ct.title_text
FROM certificate_templates ct
JOIN deployment_requests dr ON dr.teacher_batch_id = ct.teacher_batch_id
  AND dr.workflow_version = 2 AND dr.supervisor_id = ct.supervisor_id
WHERE ct.partner_institution_id IS NULL AND dr.partner_institution_id IS NOT NULL
ORDER BY ct.supervisor_id, dr.partner_institution_id, ct.updated_at DESC NULLS LAST, ct.id DESC
ON CONFLICT (supervisor_id, partner_institution_id) WHERE partner_institution_id IS NOT NULL
DO NOTHING;
