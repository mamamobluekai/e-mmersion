ALTER TABLE partner_institution_supervisor_history
  ADD COLUMN IF NOT EXISTS supervisor_first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supervisor_last_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supervisor_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS supervisor_phone VARCHAR(50);

UPDATE partner_institution_supervisor_history h
SET supervisor_first_name = COALESCE(h.supervisor_first_name, s.first_name, 'Unknown'),
    supervisor_last_name = COALESCE(h.supervisor_last_name, s.last_name, 'Unknown'),
    supervisor_email = COALESCE(h.supervisor_email, u.email),
    supervisor_phone = COALESCE(h.supervisor_phone, u.phone)
FROM users u
LEFT JOIN supervisors s ON s.user_id = u.id
WHERE u.id = h.supervisor_user_id
  AND (
    h.supervisor_first_name IS NULL
    OR h.supervisor_last_name IS NULL
    OR h.supervisor_email IS NULL
  );

ALTER TABLE partner_institution_supervisor_history
  ALTER COLUMN supervisor_first_name SET NOT NULL,
  ALTER COLUMN supervisor_last_name SET NOT NULL,
  ALTER COLUMN supervisor_email SET NOT NULL;
