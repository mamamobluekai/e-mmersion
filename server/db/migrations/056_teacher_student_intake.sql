SELECT pg_advisory_xact_lock(56024);

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS intake_teacher_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uploaded_by_teacher_id integer REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_intake_teacher ON public.students(intake_teacher_id);
CREATE INDEX IF NOT EXISTS idx_students_uploaded_by_teacher ON public.students(uploaded_by_teacher_id);
