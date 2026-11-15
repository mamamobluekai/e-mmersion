-- Migration: Add archived_at soft-delete column to teacher_batches (2026-11-15)
-- A batch whose immersion is already completed cannot be edited or removed any
-- more; it is archived instead so its students, schedule and history stay
-- intact. Archived batches live in the archive modal on the Deployment page.
--
-- Run with: node scripts/runMigration.js db/migrations/032_teacher_batch_archived_at.sql

ALTER TABLE teacher_batches ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;