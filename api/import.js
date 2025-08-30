import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 处理日期格式转换
function parseDate(dateString) {
  if (!dateString) return null;
  
  // 尝试多种日期格式
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export default async function handler(req, res) {
  // 只允许POST方法
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许，仅支持POST' });
  }

  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  const { records } = req.body;
  
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: '没有提供有效的数据记录' });
  }

  try {
    // 开始数据库事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    // 循环插入每条记录
    for (const [index, record] of records.entries()) {
      try {
        // 转换Excel中的字段名到数据库字段名
        const dbRecord = {
          plan_id: record['计划ID'] || record.plan_id || null,
          start_time: parseDate(record['开始时间'] || record.start_time),
          customer: record['客户'] || record.customer || null,
          satellite: record['卫星'] || record.satellite || null,
          station: record['测站'] || record.station || null,
          task_result: record['任务结果'] || record.task_result || null,
          task_type: record['任务类型'] || record.task_type || null,
          raw: record // 保存原始数据
        };
        
        // 执行插入
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            dbRecord.plan_id,
            dbRecord.start_time,
            dbRecord.customer,
            dbRecord.satellite,
            dbRecord.station,
            dbRecord.task_result,
            dbRecord.task_type,
            JSON.stringify(dbRecord.raw)
          ]
        );
        
        inserted++;
      } catch (error) {
        errors.push({
          index,
          error: error.message,
          record: JSON.stringify(record)
        });
        console.error(`处理第${index + 1}条记录出错:`, error);
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      inserted,
      total: records.length,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    // 出错时回滚事务
    await pool.query('ROLLBACK');
    console.error('导入数据错误:', error);
    res.status(500).json({ error: '服务器错误，导入失败' });
  }
}
