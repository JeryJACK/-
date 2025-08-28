// GET /api/records?start=ISO&end=ISO&page=1&pageSize=1000&customer=a,b
// Returns paginated raw records for client use

import { Pool } from 'pg';
let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

export default async function handler(req, res) {
  const { start, end, page = 1, pageSize = 1000, customer, satellite, station } = req.query;
  const params = [];
  const where = [];

  if (start) { params.push(start); where.push(`start_time >= $${params.length}`); }
  if (end)   { params.push(end);   where.push(`start_time <= $${params.length}`); }
  if (customer) { params.push(customer.split(',')); where.push(`customer = ANY($${params.length})`); }
  if (satellite) { params.push(satellite.split(',')); where.push(`satellite = ANY($${params.length})`); }
  if (station) { params.push(station.split(',')); where.push(`station = ANY($${params.length})`); }

  const offset = (Math.max(1, Number(page)) - 1) * Number(pageSize);

  try {
    const countSql = `SELECT count(*) FROM raw_records ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    const cRes = await pool.query(countSql, params);
    const total = Number(cRes.rows[0].count);

    const sql = `
      SELECT id, plan_id, start_time, customer, satellite, station, task_result, task_type, raw
      FROM raw_records
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY start_time ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const qParams = params.concat([Number(pageSize), offset]);
    const r = await pool.query(sql, qParams);

    res.json({ total, page: Number(page), pageSize: Number(pageSize), records: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}