-- Migration: Checklist of documents a student must revise (2026-11-15)
-- When a coordinator marks a submission "Needs Revision" they pick which
-- requirement documents have to be replaced. The ids are kept on the
-- submission so the student's Requirements page can show exactly what to
-- change, and cleared once the submission is re-reviewed or resubmitted.
--
-- Run with: node scripts/runMigration.js db/migrations/033_submission_revision_documents.sql

ALTER TABLE student_requirement_submissions
  ADD COLUMN IF NOT EXISTS revision_document_ids JSONB;