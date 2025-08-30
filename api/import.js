import { Pool } from 'pg';
import { verifyAuth } from '../../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 辅助函数：处理时间并转换为北京时区
function processDateTime(dateString) {
  if (!dateString) return null;
  
  // 尝试解析各种时间格式
  const date = new Date(dateString);
  
  // 检查是否是有效日期
  if (isNaN(date.getTime())) {
    console.warn(`无法解析时间: ${dateString}`);
    return null;
  }
  
  // 确保时间是北京时区（UTC+8）
  // 如果原始时间已经是北京时间，则不需要调整
  // 只需要确保在存储时正确标记时区
  
  // 返回ISO格式字符串，PostgreSQL会正确解析
  return date.toISOString();
}

export default async function handler(req, res) {
  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { records } = req.body;
  
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: '无效的数据格式' });
  }

  try {
    // 开始数据库事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    
    // 处理每条记录
    for (const record of records) {
      // 处理时间字段，确保正确处理北京时区
      const processedTime = processDateTime(record.start_time || record.开始时间);
      
      // 映射Excel字段到数据库字段（根据你的Excel实际列名调整）
      const dbRecord = {
        plan_id: record.plan_id || record.计划ID || record.planId || '',
        start_time: processedTime,
        customer: record.customer || record.客户 || '',
        satellite: record.satellite || record.卫星 || '',
        station: record.station || record.测站 || '',
        task_result: record.task_result || record.任务结果 || '',
        task_type: record.task_type || record.任务类型 || '',
        raw: record // 保存原始数据
      };
      
      // 插入数据库
      const result = await pool.query(
        `INSERT INTO raw_records 
         (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
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
      
      if (result.rows.length > 0) {
        inserted++;
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    res.json({ success: true, inserted, total: records.length });
  } catch (error) {
    // 出错时回滚事务
    await pool.query('ROLLBACK');
    
    // 详细记录错误信息
    console.error('数据导入错误:', {
      message: error.message,
      stack: error.stack,
      sampleRecord: records.length > 0 ? records[0] : null
    });
    
    // 返回详细错误信息给客户端
    res.status(500).json({ 
      error: '处理文件失败',
      details: process.env.NODE_ENV === 'development' ? error.message : '请联系管理员查看详细错误日志'
    });
  }
}
