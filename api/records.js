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
  // 如果你希望只有登录用户才能访问，可以启用下面的验证
  // const auth = await verifyAuth(req);
  // if (!auth.success) {
  //   return res.status(401).json({ error: auth.error });
  // }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: '方法不允许，仅支持GET' });
  }

  const { page = 1, pageSize = 10, search = '' } = req.query;
  const offset = (page - 1) * pageSize;

  try {
    let query, countQuery, params;

    if (search) {
      // 带搜索功能的查询
      query = `
        SELECT * FROM raw_records 
        WHERE plan_id ILIKE $1 OR customer ILIKE $1 OR satellite ILIKE $1
        ORDER BY start_time DESC 
        LIMIT $2 OFFSET $3
      `;
      countQuery = `
        SELECT COUNT(*) FROM raw_records 
        WHERE plan_id ILIKE $1 OR customer ILIKE $1 OR satellite ILIKE $1
      `;
      params = [`%${search}%`, pageSize, offset];
    } else {
      // 普通查询
      query = `
        SELECT * FROM raw_records 
        ORDER BY start_time DESC 
        LIMIT $1 OFFSET $2
      `;
      countQuery = 'SELECT COUNT(*) FROM raw_records';
      params = [pageSize, offset];
    }

    // 获取记录列表
    const result = await pool.query(query, search ? params : [pageSize, offset]);
    
    // 获取总记录数
    const countResult = await pool.query(countQuery, search ? [`%${search}%`] : []);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      records: result.rows,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      pages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('获取记录错误:', error);
    res.status(500).json({ error: '服务器错误，获取记录失败' });
  }
};
    
