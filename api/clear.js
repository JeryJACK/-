// DELETE /api/clear  (protected by IMPORT_API_KEY)
import { Pool } from 'pg';
let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  global._pgPool = pool;
} else { pool = global._pgPool; }

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' });
  const key = req.headers['x-api-key'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!key || key !== process.env.IMPORT_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await pool.query('TRUNCATE raw_records RESTART IDENTITY');
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}