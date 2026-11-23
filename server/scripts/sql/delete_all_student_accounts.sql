-- Permanent student-account reset for the development/test database.
-- Run the entire DO block first with apply_changes set to false. That tests
-- the cleanup and rolls it back. Back up the database before setting it to true.
-- The November 23, 2026 scan found seven student accounts.
-- Student-owned database records are deleted through existing foreign keys.
-- External uploads and archive snapshots are outside the scope of this SQL.

DO $$
DECLARE
  apply_changes CONSTANT boolean := false;
  expected_accounts CONSTANT integer := 7;
  account_ids integer[];
  profile_ids integer[];
  deleted_submissions integer;
  deleted_accounts integer;
BEGIN
  SET LOCAL lock_timeout = '5s';
  SET LOCAL row_security = off;

  LOCK TABLE public.users, public.students, public.teacher_batches,
    public.teacher_batch_students, public.partner_student_assignments,
    public.student_requirement_submissions, public.batch_group_messages,
    public.batch_group_message_replies IN SHARE ROW EXCLUSIVE MODE;

  account_ids := ARRAY(SELECT id FROM public.users WHERE role = 'student');
  IF cardinality(account_ids) <> expected_accounts THEN
    RAISE EXCEPTION 'Found % student accounts, expected %. Rescan before updating the expected count.',
      cardinality(account_ids), expected_accounts;
  END IF;

  profile_ids := ARRAY(SELECT id FROM public.students WHERE user_id = ANY(account_ids));

  IF EXISTS (
    SELECT 1
    FROM public.teacher_batch_students roster
    JOIN public.teacher_batches batch ON batch.id = roster.teacher_batch_id
    WHERE roster.student_id = ANY(profile_ids) AND batch.archived_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.partner_student_assignments assignment
    WHERE assignment.student_id = ANY(profile_ids)
      AND assignment.status IN ('pending', 'accepted', 'rejected')
  ) THEN
    RAISE EXCEPTION 'Student accounts are linked to open batches or deployment assignments. Review those assignments before purging.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_requirement_submissions submission
    WHERE (submission.user_id = ANY(account_ids)) <> (submission.student_id = ANY(profile_ids))
  ) THEN
    RAISE EXCEPTION 'A requirement submission has inconsistent student ownership. Review it before purging.';
  END IF;

  IF EXISTS (
    WITH RECURSIVE messages AS (
      SELECT m.id, m.user_id
      FROM public.batch_group_messages m
      WHERE m.user_id = ANY(account_ids)
      UNION
      SELECT m.id, m.user_id
      FROM public.batch_group_messages m
      JOIN messages parent ON parent.id = m.parent_message_id
    ), affected_authors AS (
      SELECT user_id FROM messages
      UNION
      SELECT r.user_id
      FROM public.batch_group_message_replies r
      JOIN messages m ON m.id = r.parent_message_id
    )
    SELECT 1
    FROM affected_authors author
    WHERE author.user_id <> ALL(account_ids)
  ) THEN
    RAISE EXCEPTION 'Deleting student messages would also delete staff replies. Review those threads before purging.';
  END IF;

  BEGIN
    -- Clear the logs tied to student-owned submissions before deleting the
    -- accounts referenced by submission_logs.actor_id.
    DELETE FROM public.student_requirement_submissions WHERE user_id = ANY(account_ids);
    GET DIAGNOSTICS deleted_submissions = ROW_COUNT;

    DELETE FROM public.users WHERE id = ANY(account_ids) AND role = 'student';
    GET DIAGNOSTICS deleted_accounts = ROW_COUNT;

    IF deleted_accounts <> expected_accounts THEN
      RAISE EXCEPTION 'Deleted % of % expected student accounts. The delete was rolled back.',
        deleted_accounts, expected_accounts;
    END IF;

    IF NOT apply_changes THEN
      RAISE SQLSTATE 'ZX001' USING MESSAGE = 'Roll back the student account preview';
    END IF;

    RAISE NOTICE 'Deleted % student accounts and % requirement submissions.',
      deleted_accounts, deleted_submissions;
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    RAISE NOTICE 'Preview rolled back. Would delete % student accounts and % requirement submissions.',
      deleted_accounts, deleted_submissions;
  END;
END;
$$;
