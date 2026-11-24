SELECT pg_advisory_xact_lock(51024);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS new_login_email_alerts boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.account_devices (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  registration_hash text NOT NULL,
  info jsonb NOT NULL,
  last_login_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  removed_at timestamptz,
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_device_recognition ON public.account_devices (user_id, registration_hash) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.account_sessions (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  FOREIGN KEY (device_id, user_id) REFERENCES public.account_devices(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_owner_device ON public.account_sessions (user_id, device_id);

ALTER TABLE public.refresh_tokens ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.account_sessions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON public.refresh_tokens (session_id);

CREATE TABLE IF NOT EXISTS public.account_login_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('login', 'new_device', 'failed', 'logout', 'terminated')),
  info jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (device_id, user_id) REFERENCES public.account_devices(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_account_login_events_owner ON public.account_login_events (user_id, id DESC);

CREATE TABLE IF NOT EXISTS public.device_verification_challenges (
  session_id uuid PRIMARY KEY REFERENCES public.account_sessions(id) ON DELETE CASCADE,
  nonce uuid NOT NULL,
  code_hash text NOT NULL,
  email text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.account_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_devices, public.account_sessions, public.account_login_events,
  public.device_verification_challenges, public.refresh_tokens FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.account_devices, public.account_sessions, public.account_login_events,
      public.device_verification_challenges, public.refresh_tokens FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.account_devices, public.account_sessions, public.account_login_events,
      public.device_verification_challenges, public.refresh_tokens FROM authenticated;
  END IF;
END;
$$;
