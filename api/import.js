// POST /api/import
// Body: { records: [ { plan_id, start_time, customer, satellite, station, task_result, task_type, raw } ] }
// Protected via IMPORT_API_KEY header x-api-key

import { Pool } from 'pg';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const key = req.headers['x-api-key'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!key || key !== process.env.IMPORT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No records provided' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chunkSize = 200;
    let totalInserted = 0;

    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const params = [];
      const valuesSql = [];
      let idx = 1;

      chunk.forEach(r => {
        valuesSql.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(r.plan_id || null);
        params.push(r.start_time ? new Date(r.start_time).toISOString() : null);
        params.push(r.customer || null);
        params.push(r.satellite || null);
        params.push(r.station || null);
        params.push(r.task_result || null);
        params.push(r.task_type || null);
        params.push(JSON.stringify(r.raw || {}));
      });

      const insertSql = `
        INSERT INTO raw_records
          (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
        VALUES ${valuesSql.join(',')}
        ON CONFLICT DO NOTHING
      `;
      await client.query(insertSql, params);
      totalInserted += chunk.length;
    }

    await client.query('COMMIT');
    res.json({ success: true, inserted: totalInserted });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('import error', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}