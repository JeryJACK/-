const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

module.exports = async function handler(req, res) {
  // 对于获取数据列表，我们可以不强制验证身份
  // 如果你希望只有登录用户才能查看，可以启用下面的验证
  // const auth = await verifyAuth(req);
  // if (!auth.success) {
  //   return res.status(401).json({ error: auth.error });
  // }

  const { page = 1, pageSize = 10 } = req.query;
  const offset = (page - 1) * pageSize;

  try {
    // 获取总记录数
    const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
    const total = parseInt(countResult.rows[0].count);

    // 获取分页数据
    const result = await pool.query(
      'SELECT * FROM raw_records ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [pageSize, offset]
    );

    res.json({
      records: result.rows,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      pages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('获取记录错误:', error);
    res.status(500).json({ error: '服务器错误，无法获取记录' });
  }
};
    