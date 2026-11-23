-- Run on a development database with the app schema through migration 046.
-- Change target_request_id to the numeric part of your approved WI request.
-- Login: deployment-fixture-01@example.test through deployment-fixture-10@example.test
-- Password for all ten test accounts: password1234
BEGIN;

DO $seed$
DECLARE
  target_request_id integer := 1;
  request_row public.deployment_requests%ROWTYPE;
  alternative_partner_id integer;
  accepted_strands text[];
  test_email text;
  test_number text;
  new_user_id integer;
  new_student_id integer;
  new_submission_id integer;
  bcrypt_password constant text := '$2b$12$8knf4am2KEXjxZ3otnXzwOrM/73qCxcUMOqaCNYEfI11pd6et.aA2';
BEGIN
  SELECT request.* INTO request_row
  FROM public.deployment_requests request
  JOIN public.immersion_periods period ON period.id = request.immersion_period_id
  JOIN public.partner_institutions partner ON partner.id = request.partner_institution_id
  WHERE request.id = target_request_id
    AND request.workflow_version = 2 AND request.status = 'approved'
    AND request.agreement IS NOT NULL AND request.schedule_amendment IS NULL
    AND period.is_active AND partner.is_active
    AND request.confirmed_schedule->>'end' >= to_char(now() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an approved deployment request with an active immersion period and a current or upcoming schedule.';
  END IF;

  IF to_regclass('public.student_requirement_statuses') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.document_types WHERE COALESCE(is_active, true)) THEN
    RAISE EXCEPTION 'Open the Requirements page once to initialize the active requirements before running this seed.';
  END IF;

  IF jsonb_typeof(request_row.confirmed_schedule->'strands') = 'array' THEN
    accepted_strands := ARRAY(SELECT jsonb_array_elements_text(request_row.confirmed_schedule->'strands'));
  ELSE
    accepted_strands := ARRAY['ABM', 'GAS', 'HUMSS', 'ICT', 'STEM'];
  END IF;
  IF cardinality(accepted_strands) = 0 THEN
    RAISE EXCEPTION 'The selected deployment has an empty accepted strand list.';
  END IF;

  SELECT id INTO alternative_partner_id
  FROM public.partner_institutions
  WHERE is_active AND id <> request_row.partner_institution_id
  ORDER BY id LIMIT 1;

  FOR n IN 1..10 LOOP
    test_email := 'deployment-fixture-' || lpad(n::text, 2, '0') || '@example.test';
    test_number := (99000000 + n)::text;

    INSERT INTO public.users (email, password, role, status, immersion_period_id, terms_accepted, terms_accepted_at)
    VALUES (test_email, bcrypt_password, 'student', 'approved', request_row.immersion_period_id, true, now())
    RETURNING id INTO new_user_id;

    INSERT INTO public.students (
      user_id, student_number, first_name, last_name, gender, birthdate, age, contact_number,
      email, home_address, grade_level, section, track_strand, school, preferred_partner_institution_id,
      career_goal, industry_reason, guardian_name, guardian_relationship, guardian_contact,
      guardian_email, guardian_address, emergency_contact, emergency_contact_number, academic_notes
    )
    VALUES (
      new_user_id, test_number, 'Test Student ' || lpad(n::text, 2, '0'), 'Deployment Fixture',
      'Female', (CURRENT_DATE - interval '18 years')::date, 18, '0917000' || lpad(n::text, 4, '0'),
      test_email, 'Test address', 'Grade 12', 'Test Section',
      accepted_strands[1 + (n - 1) % cardinality(accepted_strands)], 'Test Senior High School',
      CASE WHEN n <= 5 THEN request_row.partner_institution_id ELSE alternative_partner_id END,
      'Practice work immersion skills', 'Exercise the deployment assignment workflow',
      'Test Guardian', 'Parent', '0918000' || lpad(n::text, 4, '0'),
      'guardian-' || n || '@example.test', 'Test address', 'Test Emergency Contact',
      '0919000' || lpad(n::text, 4, '0'), 'deployment-fixture-seed-v1'
    )
    RETURNING id INTO new_student_id;

    INSERT INTO public.student_requirement_submissions
      (student_id, user_id, status, progress, submitted_at, reviewed_at)
    VALUES (new_student_id, new_user_id, 'Approved', 100, now(), now())
    RETURNING id INTO new_submission_id;

    INSERT INTO public.student_requirement_statuses (submission_id, document_type_id, status)
    SELECT new_submission_id, id, 'APPROVED'
    FROM public.document_types WHERE COALESCE(is_active, true);
  END LOOP;
END;
$seed$;

COMMIT;
