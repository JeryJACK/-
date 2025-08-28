// GET /api/stats?groupBy=day|week|month|quarter&start=ISO&end=ISO&category=customer|station|satellite
// Returns grouped counts per category for charting

import { Pool } from 'pg';
let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  global._pgPool = pool;
} else { pool = global._pgPool; }

export default async function handler(req, res) {
  const { groupBy = 'day', start, end, category = 'customer', limit = 50 } = req.query;
  const allowedCategories = ['customer','station','satellite','task_result','task_type'];
  const cat = allowedCategories.includes(category) ? category : 'customer';

  let groupExpr;
  if (groupBy === 'day') groupExpr = `to_char(date_trunc('day', start_time), 'YYYY-MM-DD')`;
  else if (groupBy === 'week') groupExpr = `concat(extract(year from start_time)::int, '-W', lpad(extract(week from start_time)::text,2,'0'))`;
  else if (groupBy === 'month') groupExpr = `to_char(date_trunc('month', start_time), 'YYYY-MM')`;
  else groupExpr = `concat(extract(year from start_time)::int, '-Q', extract(quarter from start_time)::int)`;

  const params = [];
  const where = [];
  if (start) { params.push(start); where.push(`start_time >= $${params.length}`); }
  if (end)   { params.push(end);   where.push(`start_time <= $${params.length}`); }

  try {
    const groupSql = `
      SELECT ${groupExpr} as group_key
      FROM raw_records
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY group_key
      ORDER BY min(start_time) ASC
    `;
    const groupsRes = await pool.query(groupSql, params);
    const labels = groupsRes.rows.map(r => r.group_key);

    const catSql = `
      SELECT ${cat} as name, count(*) as cnt
      FROM raw_records
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY ${cat}
      ORDER BY cnt DESC
      LIMIT ${Number(limit)}
    `;
    const catsRes = await pool.query(catSql, params);
    const categories = catsRes.rows.map(r => r.name || '未知');

    const series = [];
    for (const c of categories) {
      const counts = [];
      for (const label of labels) {
        const q = `
          SELECT count(*) FROM raw_records
          WHERE ${cat} = $1
          AND (${groupExpr}) = $2
          ${where.length ? 'AND ' + where.join(' AND ') : ''}
        `;
        const qParams = [c, label].concat(params);
        const rr = await pool.query(q, qParams);
        counts.push(Number(rr.rows[0].count));
      }
      series.push({ label: c, data: counts });
    }

    res.json({ groupBy, labels, series, categories });
  } catch (err) {
    console.error('stats error', err);
    res.status(500).json({ error: err.message });
  }
}