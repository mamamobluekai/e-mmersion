CREATE TABLE IF NOT EXISTS partner_institutions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  industry VARCHAR(120) NOT NULL DEFAULT 'Other',
  description TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT partner_institutions_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_institutions_name_ci
  ON partner_institutions (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS partner_institution_supervisor_history (
  id SERIAL PRIMARY KEY,
  institution_id INTEGER NOT NULL
    REFERENCES partner_institutions(id) ON DELETE RESTRICT,
  supervisor_user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  supervisor_first_name VARCHAR(100) NOT NULL,
  supervisor_last_name VARCHAR(100) NOT NULL,
  supervisor_email VARCHAR(255) NOT NULL,
  supervisor_phone VARCHAR(50),
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ,
  end_reason VARCHAR(30) CHECK (end_reason IN ('replaced', 'deactivated', 'institution_deactivated')),
  CONSTRAINT partner_supervisor_assignment_dates
    CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_supervisor_one_active_institution
  ON partner_institution_supervisor_history (institution_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_supervisor_one_active_assignment
  ON partner_institution_supervisor_history (supervisor_user_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partner_supervisor_history_institution
  ON partner_institution_supervisor_history (institution_id, assigned_at DESC);

INSERT INTO partner_institutions (name, industry, address)
SELECT DISTINCT ON (lower(btrim(s.company_name)))
       btrim(s.company_name),
       'Other',
       s.company_address
FROM supervisors s
WHERE length(btrim(s.company_name)) > 0
ORDER BY lower(btrim(s.company_name)), s.created_at DESC, s.id DESC
ON CONFLICT DO NOTHING;

INSERT INTO partner_institution_supervisor_history (
  institution_id,
  supervisor_user_id,
  supervisor_first_name,
  supervisor_last_name,
  supervisor_email,
  supervisor_phone,
  assigned_at
)
SELECT i.id, latest.user_id, latest.first_name, latest.last_name, latest.email,
       latest.phone, COALESCE(latest.created_at, CURRENT_TIMESTAMP)
FROM (
  SELECT DISTINCT ON (lower(btrim(s.company_name)))
         s.user_id,
         s.company_name,
         u.created_at,
         s.first_name,
         s.last_name,
         u.email,
         u.phone
  FROM supervisors s
  JOIN users u ON u.id = s.user_id AND u.role = 'supervisor'
  WHERE length(btrim(s.company_name)) > 0
    AND lower(u.status) IN ('approved', 'active')
  ORDER BY lower(btrim(s.company_name)), u.created_at DESC, s.id DESC
) latest
JOIN partner_institutions i
  ON lower(btrim(i.name)) = lower(btrim(latest.company_name))
ON CONFLICT DO NOTHING;
