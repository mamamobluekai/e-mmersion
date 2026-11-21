const pool = require('../db');

async function requireLegacyBatch(req, res, next) {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    return res.status(400).json({ error: 'Invalid batch id.' });
  }
  try {
    const { rows: [batch] } = await pool.query(
      'SELECT to_jsonb(tb)->>\'partner_institution_id\' AS partner FROM teacher_batches tb WHERE id = $1', [id]);
    if (batch?.partner) {
      return res.status(409).json({ error: 'Manage this batch through its Partner Deployment request.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireLegacyBatch };
