import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 直接获取原始时间值，不进行任何转换
function getRawTimeValue(record) {
  // 尝试从不同可能的字段名获取时间值
  const timeValue = record['开始时间'] || record.start_time || record['StartTime'] || null;
  
  // 直接返回原始值，不做任何解析或转换
  return timeValue !== null ? String(timeValue) : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许，仅支持POST' });
  }
  
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }
  
  const { records } = req.body;
  
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: '没有提供有效的记录数据' });
  }
  
  try {
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      try {
        // 获取原始时间值，不做任何转换
        const rawTimeValue = getRawTimeValue(record);
        
        // 将原始时间值直接存储为字符串
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, start_time_raw, customer, satellite, 
            station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            record['计划ID'] || record.plan_id || null,
            rawTimeValue,  // 直接存储原始时间字符串
            rawTimeValue,  // 存储原始时间字符串用于参考
            record['客户'] || record.customer || null,
            record['卫星'] || record.satellite || null,
            record['测站'] || record.station || null,
            record['任务结果'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            record ? JSON.stringify(record) : null
          ]
        );
        
        inserted++;
      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          record: record,
          startTimeValue: record['开始时间'] || record.start_time
        });
        console.error(`处理第 ${i+1} 条记录失败:`, error);
      }
    }
    
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      inserted: inserted,
      total: records.length,
      errors: errors,
      message: `成功导入 ${inserted} 条记录，共 ${records.length} 条`
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('导入数据错误:', error);
    res.status(500).json({ error: '导入数据失败: ' + error.message });
  }
}
    
