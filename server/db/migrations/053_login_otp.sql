SELECT pg_advisory_xact_lock(53024);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS login_security_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login timestamp;
ALTER TABLE public.account_devices
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_token_hash text,
  ADD COLUMN IF NOT EXISTS trusted_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_revoked_at timestamptz;
ALTER TABLE public.account_devices ALTER COLUMN created_at SET DEFAULT now();
UPDATE public.account_devices SET created_at = last_login_at WHERE created_at IS NULL;
ALTER TABLE public.account_devices ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.account_sessions ADD COLUMN IF NOT EXISTS authentication_method text
  CHECK (authentication_method IN ('otp', 'trusted'));
-- Pre-OTP sessions cannot satisfy the new login policy.
UPDATE public.account_sessions SET ended_at = now()
  WHERE authentication_method IS NULL AND ended_at IS NULL;
UPDATE public.refresh_tokens r SET revoked_at = now()
  WHERE r.revoked_at IS NULL AND (r.session_id IS NULL OR EXISTS (
    SELECT 1 FROM public.account_sessions s WHERE s.id = r.session_id AND s.authentication_method IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_account_session ON public.account_sessions (user_id) WHERE ended_at IS NULL;

ALTER TABLE public.account_login_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.account_login_events DROP CONSTRAINT IF EXISTS account_login_events_event_type_check;
ALTER TABLE public.account_login_events ADD CONSTRAINT account_login_events_event_type_check
  CHECK (event_type IN ('login', 'new_device', 'failed', 'otp_required', 'otp_failed', 'logout', 'terminated'));
ALTER TABLE public.account_login_events
  ADD COLUMN IF NOT EXISTS attempted_email varchar(255),
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.account_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS otp_status text CHECK (otp_status IN ('pending', 'verified', 'failed', 'not_required')),
  ADD COLUMN IF NOT EXISTS was_trusted boolean,
  ADD COLUMN IF NOT EXISTS flags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_account_login_events_time ON public.account_login_events (occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.login_otp_verifications (
  user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE,
  registration_hash text NOT NULL,
  security_version integer NOT NULL,
  nonce uuid NOT NULL,
  code_hash text NOT NULL,
  flags text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  sends integer NOT NULL DEFAULT 1 CHECK (sends BETWEEN 1 AND 3),
  started_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
ALTER TABLE public.login_otp_verifications ADD COLUMN IF NOT EXISTS previous_code_hashes text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.login_otp_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_otp_verifications FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.login_otp_verifications FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.login_otp_verifications FROM authenticated;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_changed_account_security() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.password IS DISTINCT FROM NEW.password OR OLD.email IS DISTINCT FROM NEW.email
      OR OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.login_security_version := OLD.login_security_version + 1;
    DELETE FROM public.login_otp_verifications WHERE user_id = OLD.id;
    UPDATE public.account_devices SET trust_token_hash = NULL, trust_expires_at = NULL, trust_revoked_at = now()
      WHERE user_id = OLD.id AND trust_token_hash IS NOT NULL;
    -- Temporary-password activation continues in the session that already passed OTP.
    IF NOT (OLD.status = 'pending_activation' AND NEW.status IN ('approved', 'active')
      AND OLD.role = NEW.role AND OLD.email = NEW.email AND OLD.password IS DISTINCT FROM NEW.password) THEN
      WITH ended AS (
        UPDATE public.account_sessions SET ended_at = now() WHERE user_id = OLD.id AND ended_at IS NULL
        RETURNING id, device_id
      ), revoked AS (
        UPDATE public.refresh_tokens SET revoked_at = now()
        WHERE user_id = OLD.id AND revoked_at IS NULL AND session_id IN (SELECT id FROM ended)
      )
      INSERT INTO public.account_login_events (user_id, device_id, session_id, event_type, info, flags)
      SELECT OLD.id, d.id, e.id, 'terminated', d.info, ARRAY['account_security_changed']
      FROM ended e JOIN public.account_devices d ON d.id = e.device_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invalidate_changed_account_security ON public.users;
CREATE TRIGGER invalidate_changed_account_security BEFORE UPDATE OF password, email, role, status ON public.users
FOR EACH ROW EXECUTE FUNCTION public.invalidate_changed_account_security();
