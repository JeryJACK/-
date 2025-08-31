const{pool}-require('pg');
const { verifyAuth } = require('../lib/auth');

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '方法不允许，仅支持GET' });
  }

  const auth = await verifyAuth(req);
  if (!auth.success) {
    if (req.headers.referer && req.headers.referer.includes('/admin.html')) {
      return res.status(401).json({ error: auth.error });
    }
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
    const total = parseInt(countResult.rows[0].count);

    const recordsResult = await pool.query(
      `SELECT * FROM raw_records 
       ORDER BY created_at DESC 
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    res.json({
      success: true,
      records: recordsResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('获取记录列表错误:', error);
    res.status(500).json({ error: '服务器错误，获取记录失败' });
  }
};
