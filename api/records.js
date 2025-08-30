import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

export default async function handler(req, res) {
  try {
    // 验证身份
    const auth = await verifyAuth(req);
    if (!auth.success && req.method !== 'GET') {
      return res.status(401).json({ error: auth.error });
    }

    const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;

    if (req.method === 'GET') {
      // 获取总记录数
      const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
      const total = parseInt(countResult.rows[0].count, 10);
      
      // 查询记录（直接使用存储的北京时间）
      const result = await pool.query(
        `SELECT id, plan_id, 
                start_time AT TIME ZONE 'Asia/Shanghai' AS start_time,
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
    } else if (req.method === 'GET' && req.query.id) {
      // 获取单条记录
      const { id } = req.query;
      const result = await pool.query(
        `SELECT id, plan_id, 
                start_time AT TIME ZONE 'Asia/Shanghai' AS start_time,
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
    } else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (error) {
    console.error('查询接口错误:', error);
    // 关键修复：返回具体错误信息，而不是笼统的服务器错误
    res.status(500).json({ 
      error: '获取数据失败',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
    
