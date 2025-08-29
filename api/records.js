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
  // 对于GET请求不需要验证（公开数据），其他请求需要验证
  if (req.method !== 'GET') {
    const auth = await verifyAuth(req);
    if (!auth.success) {
      return res.status(401).json({ error: auth.error });
    }
  }

  try {
    if (req.method === 'GET') {
      // 获取分页参数
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10;
      const offset = (page - 1) * pageSize;
      
      // 先获取总数
      const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
      const total = parseInt(countResult.rows[0].count);
      
      // 获取当前页数据
      const result = await pool.query(
        'SELECT * FROM raw_records ORDER BY start_time DESC LIMIT $1 OFFSET $2',
        [pageSize, offset]
      );
      
      res.json({
        records: result.rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      });
    } else if (req.method === 'POST') {
      // 添加新记录
      const { plan_id, start_time, customer, satellite, station, task_result, raw } = req.body;
      
      const result = await pool.query(
        `INSERT INTO raw_records 
         (plan_id, start_time, customer, satellite, station, task_result, raw) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [plan_id, start_time, customer, satellite, station, task_result, raw]
      );
      
      res.status(201).json({ success: true, record: result.rows[0] });
    } else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (error) {
    console.error('记录API错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
}
