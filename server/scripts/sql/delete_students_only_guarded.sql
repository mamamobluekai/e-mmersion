-- Deletes all student profiles only if no foreign-key dependents exist.
-- User accounts remain. The app may recreate profiles for those accounts.
BEGIN;

LOCK TABLE public.students IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
  dependency record;
  has_dependent_rows boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.students'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Students has an enabled custom trigger. Review it before attempting a students-only reset.';
  END IF;

  FOR dependency IN
    SELECT fk.conrelid::regclass AS child_table,
           string_agg(format('child.%I = student.%I', child_column.attname, parent_column.attname),
             ' AND ' ORDER BY columns.ordinality) AS join_condition
    FROM pg_constraint fk
    CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY
      AS columns(child_number, parent_number, ordinality)
    JOIN pg_attribute child_column ON child_column.attrelid = fk.conrelid AND child_column.attnum = columns.child_number
    JOIN pg_attribute parent_column ON parent_column.attrelid = fk.confrelid AND parent_column.attnum = columns.parent_number
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.students'::regclass
    GROUP BY fk.oid, fk.conrelid
    ORDER BY fk.conrelid, fk.oid
  LOOP
    EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', dependency.child_table);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s child JOIN public.students student ON %s)',
      dependency.child_table, dependency.join_condition) INTO has_dependent_rows;
    IF has_dependent_rows THEN
      RAISE EXCEPTION 'Students-only reset stopped because % contains dependent rows.', dependency.child_table;
    END IF;
  END LOOP;
END;
$guard$;

DELETE FROM public.students;

COMMIT;
