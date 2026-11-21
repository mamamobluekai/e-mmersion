ALTER TABLE users
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMPTZ;
