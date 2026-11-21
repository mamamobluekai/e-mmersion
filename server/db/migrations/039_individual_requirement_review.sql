ALTER TABLE student_requirement_submissions
  ADD COLUMN IF NOT EXISTS revision_document_ids JSONB;

CREATE TABLE IF NOT EXISTS student_requirement_statuses (
  submission_id INTEGER NOT NULL REFERENCES student_requirement_submissions(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  feedback TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (submission_id, document_type_id)
);

CREATE TABLE IF NOT EXISTS student_requirement_status_history (
  id BIGSERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES student_requirement_submissions(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES student_documents(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  feedback TEXT,
  original_name TEXT,
  cloudinary_url TEXT,
  details JSONB,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO student_requirement_statuses
  (submission_id, document_type_id, status, updated_by, updated_at)
SELECT submission_id, document_type_id,
       CASE LOWER(COALESCE(status, ''))
         WHEN 'verified' THEN 'APPROVED'
         WHEN 'approved' THEN 'APPROVED'
         WHEN 'rejected' THEN 'NEEDS REVISION'
         WHEN 'needs revision' THEN 'NEEDS REVISION'
         WHEN 'resubmitted - awaiting review' THEN 'RESUBMITTED - AWAITING REVIEW'
         ELSE 'PENDING'
       END,
       verified_by, COALESCE(verified_date, uploaded_date, CURRENT_TIMESTAMP)
  FROM (
    SELECT DISTINCT ON (submission_id, document_type_id) *
      FROM student_documents
     ORDER BY submission_id, document_type_id, uploaded_date DESC, id DESC
  ) latest_documents
ON CONFLICT (submission_id, document_type_id) DO NOTHING;

INSERT INTO student_requirement_status_history
  (submission_id, document_type_id, document_id, status, action,
   original_name, cloudinary_url, actor_id, created_at)
SELECT submission_id, document_type_id, id,
       CASE LOWER(COALESCE(status, ''))
         WHEN 'verified' THEN 'APPROVED'
         WHEN 'approved' THEN 'APPROVED'
         WHEN 'rejected' THEN 'NEEDS REVISION'
         WHEN 'needs revision' THEN 'NEEDS REVISION'
         WHEN 'resubmitted - awaiting review' THEN 'RESUBMITTED - AWAITING REVIEW'
         ELSE 'PENDING'
       END,
       'MIGRATED', original_name, cloudinary_url, verified_by,
       COALESCE(verified_date, uploaded_date, CURRENT_TIMESTAMP)
  FROM (
    SELECT DISTINCT ON (submission_id, document_type_id) *
      FROM student_documents
     ORDER BY submission_id, document_type_id, uploaded_date DESC, id DESC
  ) latest_documents
 WHERE NOT EXISTS (
   SELECT 1
     FROM student_requirement_status_history history
    WHERE history.document_id = latest_documents.id
      AND history.action = 'MIGRATED'
 );

INSERT INTO student_requirement_statuses
  (submission_id, document_type_id, status, updated_by, updated_at)
SELECT submission.id, document_type.id, 'NEEDS REVISION',
       submission.reviewed_by, submission.updated_at
  FROM student_requirement_submissions submission
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(submission.revision_document_ids) = 'array'
        THEN submission.revision_document_ids
      ELSE '[]'::jsonb
    END
  ) AS legacy(document_type_id)
  JOIN document_types document_type
    ON document_type.id::text = legacy.document_type_id
ON CONFLICT (submission_id, document_type_id)
DO UPDATE SET status = 'NEEDS REVISION',
              updated_by = EXCLUDED.updated_by,
              updated_at = EXCLUDED.updated_at;

INSERT INTO student_requirement_status_history
  (submission_id, document_type_id, status, action, actor_id, created_at)
SELECT submission.id, document_type.id, 'NEEDS REVISION', 'MIGRATED',
       submission.reviewed_by, submission.updated_at
  FROM student_requirement_submissions submission
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(submission.revision_document_ids) = 'array'
        THEN submission.revision_document_ids
      ELSE '[]'::jsonb
    END
  ) AS legacy(document_type_id)
  JOIN document_types document_type
    ON document_type.id::text = legacy.document_type_id
 WHERE NOT EXISTS (
   SELECT 1
     FROM student_requirement_status_history history
    WHERE history.submission_id = submission.id
      AND history.document_type_id = document_type.id
      AND history.status = 'NEEDS REVISION'
      AND history.action = 'MIGRATED'
 );

UPDATE student_requirement_submissions
   SET revision_document_ids = NULL
 WHERE revision_document_ids IS NOT NULL;
