const db = require('../lib/db');
const { verifyAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: '方法不允许，仅支持GET' });
  }

  try {
    const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;

    // 获取总记录数
    const countResult = await db.query('SELECT COUNT(*) FROM raw_records');
    const total = parseInt(countResult.rows[0].count);

    // 获取当前页记录
    const result = await db.query(
      'SELECT * FROM raw_records ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [pageSize, offset]
    );

    res.json({
      records: result.rows,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取记录错误:', error);
    res.status(500).json({ error: '获取数据失败: ' + error.message });
  }
};
    
