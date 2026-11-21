-- Add last_login column to users table to track when a user last logged in
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;