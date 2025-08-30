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
  // 只允许POST方法
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许POST方法' });
  }

  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  const { records } = req.body;

  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: '无效的数据格式，需要包含records数组' });
  }

  try {
    // 开始事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    
    // 循环插入记录
    for (const record of records) {
      // 转换Excel中的日期格式（如果需要）
      let startTime = record.start_time;
      if (startTime && typeof startTime === 'string') {
        // 尝试解析常见的日期格式
        const parsed = new Date(startTime);
        if (!isNaN(parsed.getTime())) {
          startTime = parsed.toISOString();
        }
      }

      await pool.query(
        `INSERT INTO raw_records 
         (plan_id, start_time, customer, satellite, station, task_result, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
         record.plan_id || record.计划ID || null,
          startTime || record.开始时间 || null,
          record.customer || record.所属客户 || null,
          record.satellite || record.卫星名称 || null,
          record.station || record.测站名称 || null,
          record.task_result || record.任务结果状态 || null,
          record.task_type || record.任务类型 || null,
          // 存储原始数据
        ]
      );
      
      inserted++;
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    res.json({ success: true, inserted, total: records.length });
  } catch (error) {
    // 出错时回滚事务
    await pool.query('ROLLBACK');
    console.error('导入错误:', error);
    res.status(500).json({ error: '导入失败: ' + error.message });
  }
}

