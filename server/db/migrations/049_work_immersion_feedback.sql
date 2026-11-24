-- Student feedback on placements. See DepEd Order 023, s. 2026, Annex C.
SELECT pg_advisory_xact_lock(49024);

CREATE TABLE IF NOT EXISTS public.work_immersion_feedback_criteria (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  institution jsonb NOT NULL CHECK (jsonb_typeof(institution) = 'array'),
  supervisor jsonb NOT NULL CHECK (jsonb_typeof(supervisor) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.work_immersion_feedback_criteria (institution, supervisor) VALUES (
  '["The institution oriented me on workplace rules and my duties.", "My tasks matched the goals in my training plan.", "The workplace was safe and suitable for learning.", "The placement helped me develop practical skills and good work habits."]',
  '["My supervisor explained the training plan and assigned tasks clearly.", "My supervisor gave me guidance throughout the placement.", "The feedback I received helped me improve my work.", "I felt comfortable raising concerns with my supervisor."]'
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.work_immersion_feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Period archiving removes the live student and deployment records. Keep the
  -- submitted scores for institutional reporting after those links are cleared.
  student_id integer REFERENCES public.students(id) ON DELETE CASCADE,
  deployment_request_id integer REFERENCES public.deployment_requests(id) ON DELETE SET NULL,
  partner_institution_id integer NOT NULL REFERENCES public.partner_institutions(id) ON DELETE CASCADE,
  supervisor_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  criteria_version integer NOT NULL CHECK (criteria_version > 0),
  institution_ratings jsonb NOT NULL CHECK (jsonb_typeof(institution_ratings) = 'array'),
  supervisor_ratings jsonb NOT NULL CHECK (jsonb_typeof(supervisor_ratings) = 'array'),
  institution_score numeric(5,4) NOT NULL CHECK (institution_score BETWEEN 1 AND 5),
  supervisor_score numeric(5,4) NOT NULL CHECK (supervisor_score BETWEEN 1 AND 5),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, deployment_request_id)
);

CREATE INDEX IF NOT EXISTS idx_work_immersion_feedback_institution ON public.work_immersion_feedback (partner_institution_id);
CREATE INDEX IF NOT EXISTS idx_work_immersion_feedback_supervisor ON public.work_immersion_feedback (supervisor_id, partner_institution_id);
CREATE INDEX IF NOT EXISTS idx_work_immersion_feedback_deployment ON public.work_immersion_feedback (deployment_request_id);

ALTER TABLE public.work_immersion_feedback_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_immersion_feedback ENABLE ROW LEVEL SECURITY;
