SELECT pg_advisory_xact_lock(55024);

-- The new column also marks completion of the one-time legacy session update.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'login_otp_verifications' AND column_name = 'remember_me') THEN
    ALTER TABLE public.login_otp_verifications ADD COLUMN remember_me boolean NOT NULL DEFAULT false;

    UPDATE public.account_sessions s
    SET expires_at = LEAST(s.expires_at, COALESCE(
      (SELECT min(r.created_at)::timestamptz FROM public.refresh_tokens r WHERE r.session_id = s.id),
      s.last_active_at
    ) + interval '7 days')
    WHERE s.ended_at IS NULL;
  END IF;
END;
$$;
