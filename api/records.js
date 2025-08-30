import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    // 明确指定客户端时区为UTC，避免服务器时区影响
    options: { timezone: 'UTC' }
  });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

export default async function handler(req, res) {
  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success && req.method !== 'GET') {
    return res.status(401).json({ error: auth.error });
  }

  const { page = 1, pageSize = 10 } = req.query;
  const offset = (page - 1) * pageSize;

  try {
    if (req.method === 'GET') {
      // 获取总记录数
      const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
      const total = parseInt(countResult.rows[0].count, 10);
      
      // 关键修复：明确将存储的时间转换为北京时间返回
      // 16小时时差通常是因为UTC-8到UTC+8的转换错误，这里直接指定转换
      const result = await pool.query(
        `SELECT id, plan_id, 
                -- 明确将存储的时间转换为北京时间
                start_time AT TIME ZONE 'Asia/Shanghai' AS start_time,
                -- 同时返回原始存储的时间用于调试
                start_time AS original_utc_time,
                customer, satellite, station, 
                task_result, task_type 
         FROM raw_records 
         ORDER BY start_time DESC 
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );
      
      res.json({
        records: result.rows,
        total: total,
        page: parseInt(page, 10),
        pageSize: parseInt(pageSize, 10),
        // 增加时区信息用于调试
        serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
    } else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (error) {
    console.error('查询记录错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
}
    
