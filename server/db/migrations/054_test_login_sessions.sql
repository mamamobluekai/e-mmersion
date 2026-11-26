SELECT pg_advisory_xact_lock(54024);

ALTER TABLE public.account_sessions DROP CONSTRAINT IF EXISTS account_sessions_authentication_method_check;
ALTER TABLE public.account_sessions DROP CONSTRAINT IF EXISTS account_sessions_authentication_method_with_test_check;
ALTER TABLE public.account_sessions ADD CONSTRAINT account_sessions_authentication_method_with_test_check
  CHECK (authentication_method IN ('otp', 'trusted', 'test'));
