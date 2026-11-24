-- Run on the same test database as seed_evaluation_test_students.sql.
-- Foreign keys cascade to the fixtures' placements, requirements, attendance,
-- daily documentation, and any supervisor evaluations submitted during testing.
-- Also removes an empty temporary deployment created by the seed.
BEGIN;
SELECT pg_advisory_xact_lock(75609143);

DELETE FROM public.users AS account
USING public.students AS student, generate_series(1, 10) AS fixture(n)
WHERE account.id = student.user_id
  AND account.role = 'student'
  AND lower(account.email) = 'example' || fixture.n || '@gmail.com'
  AND student.student_number = (999900000000 + fixture.n)::text
  AND student.academic_notes = 'wims-evaluation-fixture-v1'
RETURNING account.email;

DO $cleanup$
DECLARE
  fixture_batch_id integer;
BEGIN
  FOR fixture_batch_id IN
    DELETE FROM public.deployment_requests dr
    WHERE dr.workflow_version = 2 AND dr.creation_key = 'c05df542-1bbf-4d07-bd75-b9e6cd31a86b'
      AND NOT EXISTS (SELECT 1 FROM public.partner_student_assignments a WHERE a.deployment_request_id = dr.id)
      AND NOT EXISTS (SELECT 1 FROM public.teacher_batch_students tbs WHERE tbs.teacher_batch_id = dr.teacher_batch_id)
    RETURNING dr.teacher_batch_id
  LOOP
    DELETE FROM public.teacher_batches tb
    WHERE tb.id = fixture_batch_id AND tb.batch_label = 'Evaluation Test Deployment'
      AND NOT EXISTS (SELECT 1 FROM public.deployment_requests dr WHERE dr.teacher_batch_id = tb.id);
  END LOOP;
END;
$cleanup$;

COMMIT;
