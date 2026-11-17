const pool = require('../../../db');
const { seedFormRequirements } = require('./formRequirements');

/**
 * Schema for the editable requirement list (`document_types`).
 *
 * This project applies migrations by hand and several environments are already
 * running, so the columns added after the original schema are created here on
 * first use (idempotent DDL, memoised per process) instead of being assumed -
 * otherwise every requirement call would 500 on a database that has not run
 * 031/034 yet.
 *
 * The form requirements are seeded at the same time, but only on the run that
 * adds `input_type`: that is the migration boundary. Seeding on every boot would
 * resurrect a requirement a coordinator has permanently deleted, so afterwards
 * the table is left exactly as they arranged it.
 */
let schemaPromise = null;

async function ensureDocumentTypesSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'document_types'
            AND column_name = 'input_type'`
      );
      const isNewColumn = existing.rows.length === 0;

      await client.query(`
        ALTER TABLE document_types
          ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS description TEXT,
          ADD COLUMN IF NOT EXISTS input_type TEXT NOT NULL DEFAULT 'file';
        CREATE INDEX IF NOT EXISTS idx_document_types_active
          ON document_types (is_active, sort_order);
      `);

      if (isNewColumn) await seedFormRequirements(client);

      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  })().catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

module.exports = { ensureDocumentTypesSchema };