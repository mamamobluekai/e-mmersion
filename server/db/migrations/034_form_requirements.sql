-- Form-based requirements: Personal Information and Guardian & Emergency.
--
-- Almost every requirement is a file the student uploads. These two are typed
-- into the Requirements page itself, so they are stored like any other
-- requirement but flagged input_type = 'form'. Completeness for them is derived
-- from the student's profile columns (see
-- server/controllers/coordinatorControllers/regexes/formRequirements.js)
-- instead of from student_documents, which means no upload is expected and none
-- can be missing.
--
-- Both rows are seeded here and re-seeded defensively at runtime by
-- ensureDocumentTypesSchema(), so existing databases pick them up on the next
-- request without a manual step. ON CONFLICT keeps a requirement a coordinator
-- has since renamed or deactivated exactly as they left it.

ALTER TABLE document_types
  ADD COLUMN IF NOT EXISTS input_type TEXT NOT NULL DEFAULT 'file';

INSERT INTO document_types (code, name, section, input_type, is_active, sort_order, description)
VALUES
  ('personal_information', 'Personal Information', 'personal', 'form', TRUE, 5,
   'Filled in by the student under Personal Information.'),
  ('guardian_emergency', 'Guardian & Emergency', 'guardian', 'form', TRUE, 15,
   'Filled in by the student under Guardian & Emergency.')
ON CONFLICT (code) DO NOTHING;