<const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

module.exports = async (req, res) => {
  try {
    // 验证身份（GET请求公开访问，其他需要认证）
    const auth = await verifyAuth(req);
    if (!auth.success && req.method !== 'GET') {
      return res.status(401).json({ error: auth.error });
    }

    const { page = 1, pageSize = 10, id } = req.query;
    const offset = (page - 1) * pageSize;

    if (id) {
      // 获取单条记录
      const result = await pool.query(
        `SELECT id, plan_id, 
                -- 关键修复：明确转换为北京时区
                TO_CHAR(start_time AT TIME ZONE 'Asia/Shanghai', 
                        'YYYY-MM-DD HH24:MI:SS') AS start_time,
                customer, satellite, station, 
                task_result, task_type 
         FROM raw_records 
         WHERE id = $1`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '记录不存在' });
      }
      
      res.json(result.rows[0]);
    } else if (req.method === 'GET') {
      // 获取记录列表
      const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
      const total = parseInt(countResult.rows[0].count, 10);
      
      const result = await pool.query(
        `SELECT id, plan_id, 
                -- 关键修复：明确转换为北京时区
                TO_CHAR(start_time AT TIME ZONE 'Asia/Shanghai', 
                        'YYYY-MM-DD HH24:MI:SS') AS start_time,
                customer, satellite, station, 
                task_result, task_type 
         FROM raw_records 
         ORDER BY start_time DESC 
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );
      
      res.json({
        records: result.rows,
        total,
        page: parseInt(page, 10),
        pageSize: parseInt(pageSize, 10)
      });
    } else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (error) {
    console.error('查询接口错误:', error);
    res.status(500).json({ 
      error: '获取数据失败',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
    
