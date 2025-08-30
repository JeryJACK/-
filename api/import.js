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
  const formats = [
    'YYYY-MM-DD HH:mm:ss',
    'YYYY/MM/DD HH:mm:ss',
    'MM/DD/YYYY HH:mm:ss',
    'DD-MM-YYYY HH:mm:ss',
    'YYYY-MM-DD',
    'YYYY/MM/DD',
    'MM/DD/YYYY',
    'DD-MM-YYYY'
  ];
  
  for (const format of formats) {
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  
  console.warn(`无法解析日期格式: ${dateString}`);
  return null;
}

export default async function handler(req, res) {
  // 只允许POST方法
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许，仅支持POST' });
  }
  
  // 验证用户身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }
  
  const { records } = req.body;
  
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: '没有提供有效的记录数据' });
  }
  
  try {
    // 开始数据库事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    // 批量处理记录
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      try {
        // 转换日期格式
        const startTime = parseDate(record['开始时间'] || record.start_time);
        
        // 插入记录
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            startTime,
            record['所属客户'] || record.customer || null,
            record['卫星名称'] || record.satellite || null,
            record['测站名称'] || record.station || null,
            record['任务结果状态'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            record ? JSON.stringify(record) : null // 存储原始数据
          ]
        );
        
        inserted++;
      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          record: record
        });
        console.error(`处理第 ${i+1} 条记录失败:`, error);
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      inserted: inserted,
      total: records.length,
      errors: errors,
      message: `成功导入 ${inserted} 条记录，共 ${records.length} 条`
    });
  } catch (error) {
    // 出错时回滚事务
    await pool.query('ROLLBACK');
    console.error('导入数据错误:', error);
    res.status(500).json({ error: '导入数据失败: ' + error.message });
  }
}
    
