-- Deletes only the ten named fixture accounts and their FK-dependent records.
-- Apply in the same development database where the fixture was seeded.
BEGIN;

DELETE FROM public.users AS account
USING public.students AS student, generate_series(1, 10) AS fixture(n)
WHERE account.id = student.user_id
  AND account.role = 'student'
  AND account.email = 'deployment-fixture-' || lpad(fixture.n::text, 2, '0') || '@example.test'
  AND student.student_number = (99000000 + fixture.n)::text
  AND student.academic_notes = 'deployment-fixture-seed-v1'
RETURNING account.email;

COMMIT;
