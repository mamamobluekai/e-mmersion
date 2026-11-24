SELECT pg_advisory_xact_lock(50024);

CREATE TABLE IF NOT EXISTS public.personal_activity_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('page', 'sign-in', 'sign-out', 'create', 'update', 'delete', 'download', 'action')),
  area text NOT NULL,
  label text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_activity_user_recent ON public.personal_activity_history (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_personal_activity_user_type ON public.personal_activity_history (user_id, activity_type, id DESC);
CREATE INDEX IF NOT EXISTS idx_personal_activity_expiry ON public.personal_activity_history (occurred_at);
ALTER TABLE public.personal_activity_history ENABLE ROW LEVEL SECURITY;
