const pool = require('./index');

async function queryReadOnly(sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    if (err.code !== 'ECONNRESET') throw err;

    // The pool discards the failed client. Repeat this read once through the pool.
    return pool.query(sql, params);
  }
}

module.exports = queryReadOnly;
