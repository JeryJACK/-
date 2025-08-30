const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');

let pool;
if (!global._pgPool) {
  pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

module.exports = async function handler(req, res) {
  try {
    // 验证身份
    const auth = await verifyAuth(req);
    if (!auth.success) {
      return res.status(401).json({ error: auth.error });
    }

    // 处理GET请求 - 获取记录列表
    if (req.method === 'GET') {
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10;
      const offset = (page - 1) * pageSize;

      // 先获取总数
      const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
      const total = parseInt(countResult.rows[0].count);

      // 获取分页数据
      const result = await pool.query(
        'SELECT * FROM raw_records ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [pageSize, offset]
      );

      return res.json({
        records: result.rows,
        total,
        page,
        pageSize
      });
    }

    // 不支持的方法
    res.status(405).json({ error: '方法不允许' });
  } catch (error) {
    console.error('记录API错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
};
