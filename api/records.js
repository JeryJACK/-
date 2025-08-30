const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');

// 数据库连接
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '仅支持GET方法' });
  }

  // 验证登录状态
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  try {
    // 处理分页
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // 查询总数
    const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
    const total = parseInt(countResult.rows[0].count);

    // 查询数据
    const result = await pool.query(
      'SELECT * FROM raw_records ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [pageSize, offset]
    );

    res.json({
      records: result.rows,
      total,
      page,
      pageSize
    });
  } catch (error) {
    console.error('查询错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
};
