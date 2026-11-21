BEGIN;

-- A batch can schedule more than ten days. The submission controller derives
-- the day number from the assigned schedule and enforces its actual bounds.
ALTER TABLE student_daily_documentation
  DROP CONSTRAINT IF EXISTS student_daily_documentation_day_number_check;
ALTER TABLE student_daily_documentation
  ADD CONSTRAINT student_daily_documentation_day_number_check CHECK (day_number >= 1);

COMMIT;
