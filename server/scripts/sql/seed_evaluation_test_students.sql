-- Run this entire query in the PostgreSQL or Supabase SQL editor on a test database.
-- Login: example1@gmail.com through example10@gmail.com. Password: password123.
-- For local sign-in without email OTP, add these exact addresses to
-- LOGIN_OTP_TEST_ACCOUNTS in server/.env and run the backend in development mode.
-- Set target_request_id to the numeric part of a specific WI request, or keep
-- NULL to select a deployment automatically. If there is no finished schedule,
-- the query creates a temporary deployment for an existing partner and supervisor.
-- Set target_supervisor_email to use a specific approved supervisor.
-- Open the app's Requirements page once on a freshly migrated database.
BEGIN;
SELECT pg_advisory_xact_lock(75609143);

DO $seed$
DECLARE
  target_request_id integer := NULL;
  target_supervisor_email text := NULL;
  fixture_marker constant text := 'wims-evaluation-fixture-v1';
  fixture_deployment_key constant uuid := 'c05df542-1bbf-4d07-bd75-b9e6cd31a86b';
  bcrypt_password constant text := '$2b$12$LlQZL2fNeknqQiwv7BvKI.WYkaId0g9A18r/uU6eMU3.1gr4ucNry';
  today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  target record;
  placement record;
  test_schedule jsonb;
  test_email text;
  new_user_id integer;
  new_student_id integer;
  new_submission_id integer;
BEGIN
  IF to_regclass('public.student_requirement_statuses') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'document_types' AND column_name = 'input_type'
  ) THEN
    RAISE EXCEPTION 'Open the Requirements page to initialize the requirement types and reviews, then rerun this query.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u, generate_series(1, 10) AS fixture(n)
    WHERE lower(u.email) = 'example' || fixture.n || '@gmail.com'
  ) THEN
    RAISE EXCEPTION 'An example account already exists. Run the matching cleanup query to reset a previous seed.';
  END IF;

  SELECT dr.id, dr.teacher_batch_id, dr.immersion_period_id, dr.coordinator_id,
         dr.supervisor_id, dr.partner_institution_id, pi.name AS partner_name,
         supervisor.email AS supervisor_email, teacher.user_id AS teacher_user_id,
         dates.workdays, dates.first_day,
         COALESCE(dr.confirmed_schedule->'strands'->>0, dr.strand, 'ICT') AS strand,
         COALESCE(ac.time_in_open, TIME '08:00') AS time_in,
         COALESCE(ac.time_out_open, TIME '17:00') AS time_out
    INTO target
  FROM public.deployment_requests dr
  JOIN public.teacher_batches tb ON tb.id = dr.teacher_batch_id AND tb.archived_at IS NULL
    AND tb.supervisor_id = dr.supervisor_id
  JOIN public.teachers teacher ON teacher.id = tb.teacher_id
  JOIN public.partner_institutions pi ON pi.id = dr.partner_institution_id
  JOIN public.supervisors sv ON sv.user_id = dr.supervisor_id
  JOIN public.users supervisor ON supervisor.id = sv.user_id
  LEFT JOIN public.attendance_config ac ON ac.teacher_batch_id = tb.id
  CROSS JOIN LATERAL (
    SELECT array_agg(workday::date ORDER BY position) AS workdays,
           min(workday::date) AS first_day, max(workday::date) AS last_day,
           count(DISTINCT workday) AS distinct_days
    FROM jsonb_array_elements_text(CASE
      WHEN jsonb_typeof(dr.confirmed_schedule->'dates') = 'array' THEN dr.confirmed_schedule->'dates'
      ELSE '[]'::jsonb END) WITH ORDINALITY AS scheduled(workday, position)
  ) dates
  WHERE dr.workflow_version = 2 AND dr.status = 'approved' AND dr.agreement IS NOT NULL
    AND lower(supervisor.status) IN ('approved', 'active')
    AND dates.last_day < today
    AND dates.distinct_days = cardinality(dates.workdays)
    AND (target_request_id IS NULL OR dr.id = target_request_id)
    AND (target_supervisor_email IS NULL OR lower(supervisor.email) = lower(target_supervisor_email))
    AND dates.distinct_days * (dr.confirmed_schedule->>'daily_hours')::numeric
      >= (dr.confirmed_schedule->>'required_hours')::numeric
    AND EXTRACT(EPOCH FROM (COALESCE(ac.time_out_open, TIME '17:00') - COALESCE(ac.time_in_open, TIME '08:00'))) / 3600
      >= (dr.confirmed_schedule->>'daily_hours')::numeric
  ORDER BY dates.last_day DESC, dr.id DESC
  LIMIT 1
  FOR UPDATE OF dr, tb;

  IF NOT FOUND THEN
    SELECT pi.id AS partner_id, pi.name AS partner_name, supervisor.id AS supervisor_id,
           supervisor.email AS supervisor_email, coordinator.id AS coordinator_profile_id,
           coordinator.user_id AS coordinator_id, teacher.id AS teacher_id,
           teacher.user_id AS teacher_user_id, period.id AS period_id
      INTO placement
    FROM public.partner_institutions pi
    JOIN (
      SELECT institution_id, supervisor_user_id FROM public.partner_institution_supervisor_history WHERE ended_at IS NULL
      UNION
      SELECT institution_id, supervisor_user_id FROM public.partner_deployment_supervisors
      UNION
      SELECT partner_institution_id, supervisor_id FROM public.deployment_requests
      WHERE workflow_version = 2 AND status <> 'cancelled'
    ) affiliation ON affiliation.institution_id = pi.id
    JOIN public.supervisors sv ON sv.user_id = affiliation.supervisor_user_id
    JOIN public.users supervisor ON supervisor.id = sv.user_id
    LEFT JOIN public.deployment_requests requested ON requested.id = target_request_id
      AND requested.workflow_version = 2 AND requested.partner_institution_id = pi.id
      AND requested.supervisor_id = supervisor.id AND requested.status <> 'cancelled'
    CROSS JOIN LATERAL (
      SELECT c.id, c.user_id FROM public.coordinators c JOIN public.users u ON u.id = c.user_id
      WHERE lower(u.status) IN ('approved', 'active')
      ORDER BY (c.user_id = requested.coordinator_id) DESC NULLS LAST, c.id LIMIT 1
    ) coordinator
    LEFT JOIN LATERAL (
      SELECT t.id, t.user_id FROM public.teachers t JOIN public.users u ON u.id = t.user_id
      WHERE lower(u.status) IN ('approved', 'active')
      ORDER BY (t.id = requested.teacher_id) DESC NULLS LAST, t.id LIMIT 1
    ) teacher ON true
    LEFT JOIN LATERAL (
      SELECT id FROM public.immersion_periods
      WHERE is_active AND today BETWEEN start_date AND end_date
      ORDER BY start_date DESC, id DESC LIMIT 1
    ) period ON true
    WHERE pi.is_active AND lower(supervisor.status) IN ('approved', 'active')
      AND (target_supervisor_email IS NULL OR lower(supervisor.email) = lower(target_supervisor_email))
      AND (target_request_id IS NULL OR requested.id IS NOT NULL)
    ORDER BY pi.id, supervisor.id LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No matching partner and approved supervisor found for the test deployment. Check the WI request or supervisor filter, the partner affiliation, and that an approved coordinator exists.';
    END IF;

    SELECT NULL::integer AS id, NULL::integer AS teacher_batch_id, placement.period_id AS immersion_period_id,
           placement.coordinator_id, placement.supervisor_id, placement.partner_id AS partner_institution_id,
           placement.partner_name, placement.supervisor_email, placement.teacher_user_id,
           array_agg(workday ORDER BY workday) AS workdays, min(workday) AS first_day,
           'ICT'::text AS strand, TIME '08:00' AS time_in, TIME '17:00' AS time_out
      INTO target
    FROM (
      SELECT today - offset_days AS workday
      FROM generate_series(1, 30) AS past(offset_days)
      WHERE extract(isodow FROM today - offset_days) BETWEEN 1 AND 5
      ORDER BY offset_days LIMIT 10
    ) dates;

    test_schedule := jsonb_build_object(
      'start', target.first_day, 'end', target.workdays[10], 'dates', target.workdays,
      'required_hours', 80, 'daily_hours', 8, 'capacity', 10, 'strands', jsonb_build_array(target.strand),
      'windows', jsonb_build_object('time_in_open', '08:00', 'time_in_close', '08:30',
                                    'time_out_open', '17:00', 'time_out_close', '17:30')
    );

    INSERT INTO public.teacher_batches
      (coordinator_id, teacher_id, batch_label, max_students, supervisor_id, immersion_period_id, partner_institution_id)
    VALUES (placement.coordinator_profile_id, placement.teacher_id, 'Evaluation Test Deployment', 10,
            target.supervisor_id, target.immersion_period_id, target.partner_institution_id)
    RETURNING id INTO target.teacher_batch_id;

    INSERT INTO public.deployment_requests
      (coordinator_id, supervisor_id, batch_label, num_students, strand, direction, status, workflow_version,
       partner_institution_id, teacher_id, immersion_period_id, teacher_batch_id, creation_key, proposal, confirmed_schedule, agreement)
    VALUES (target.coordinator_id, target.supervisor_id, 'Evaluation Test Deployment', 10, target.strand,
            'coordinator_to_supervisor', 'approved', 2, target.partner_institution_id, placement.teacher_id,
            target.immersion_period_id, target.teacher_batch_id, fixture_deployment_key, test_schedule, test_schedule,
            jsonb_build_object('notes', 'Temporary deployment for supervisor evaluation testing.'))
    RETURNING id INTO target.id;

    INSERT INTO public.partner_deployment_teachers (deployment_request_id, teacher_id)
    SELECT target.id, placement.teacher_id WHERE placement.teacher_id IS NOT NULL;

    INSERT INTO public.attendance_config (teacher_batch_id) VALUES (target.teacher_batch_id);

    INSERT INTO public.work_immersion_schedules
      (teacher_batch_id, supervisor_id, duration_type, duration_value, start_date, end_date, created_by)
    VALUES (target.teacher_batch_id, target.supervisor_id, 'days', 10, target.first_day, target.workdays[10], target.coordinator_id);
  END IF;

  FOR n IN 1..10 LOOP
    test_email := 'example' || n || '@gmail.com';

    INSERT INTO public.users (email, password, role, status, immersion_period_id, terms_accepted, terms_accepted_at)
    VALUES (test_email, bcrypt_password, 'student', 'approved', target.immersion_period_id, true, now())
    RETURNING id INTO new_user_id;

    INSERT INTO public.students
      (user_id, student_number, first_name, last_name, email, grade_level, section,
       track_strand, preferred_partner_institution_id, academic_notes)
    VALUES (new_user_id, (999900000000 + n)::text, 'Example ' || n, 'Student', test_email,
            'Grade 12', 'Evaluation Test', target.strand, target.partner_institution_id, fixture_marker)
    RETURNING id INTO new_student_id;

    INSERT INTO public.student_requirement_submissions
      (student_id, user_id, status, progress, reviewed_by, submitted_at, reviewed_at)
    VALUES (new_student_id, new_user_id, 'Approved', 100, target.coordinator_id, now(), now())
    RETURNING id INTO new_submission_id;

    INSERT INTO public.student_requirement_statuses (submission_id, document_type_id, status, updated_by)
    SELECT new_submission_id, id, 'APPROVED', target.coordinator_id
    FROM public.document_types WHERE COALESCE(is_active, true);

    INSERT INTO public.partner_student_assignments
      (deployment_request_id, student_id, status, submitted_by, decided_by, submitted_at, decided_at)
    VALUES (target.id, new_student_id, 'accepted', target.coordinator_id, target.supervisor_id,
            target.first_day + target.time_in, target.first_day + target.time_in);

    INSERT INTO public.teacher_batch_students (teacher_batch_id, student_id, deployment_started_on)
    VALUES (target.teacher_batch_id, new_student_id, target.first_day);

    INSERT INTO public.student_attendance (student_id, teacher_batch_id, date, status, check_in_time, check_out_time)
    SELECT new_student_id, target.teacher_batch_id, workday, 'present',
           workday + target.time_in, workday + target.time_out
    FROM unnest(target.workdays) AS scheduled(workday);

    INSERT INTO public.student_daily_documentation
      (student_id, teacher_batch_id, date, day_number, reasoning, status, graded_by, graded_at)
    SELECT new_student_id, target.teacher_batch_id, workday, position::integer,
           'Sample daily documentation for supervisor evaluation testing.', 'reviewed',
           target.teacher_user_id, workday + target.time_out
    FROM unnest(target.workdays) WITH ORDINALITY AS scheduled(workday, position);
  END LOOP;

  RAISE NOTICE 'Created 10 students for WI-%, partner %, batch %, supervisor %, with % completed workdays each.',
    target.id, target.partner_name, target.teacher_batch_id, target.supervisor_email, cardinality(target.workdays);
END;
$seed$;

COMMIT;

SELECT DISTINCT dr.id AS deployment_request_id, pi.name AS partner_institution,
       supervisor.email AS supervisor_email, tb.batch_label
FROM public.students s
JOIN public.teacher_batch_students tbs ON tbs.student_id = s.id
JOIN public.teacher_batches tb ON tb.id = tbs.teacher_batch_id
JOIN public.deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2
JOIN public.partner_institutions pi ON pi.id = dr.partner_institution_id
JOIN public.users supervisor ON supervisor.id = dr.supervisor_id
WHERE s.academic_notes = 'wims-evaluation-fixture-v1';
