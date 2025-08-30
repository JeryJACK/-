import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

// 初始化数据库连接池
let pool;
if (!global._pgPool) {
  pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  // 测试数据库连接
  pool.query('SELECT NOW()', (err) => {
    if (err) {
      console.error('数据库连接失败:', err);
    } else {
      console.log('数据库连接成功');
    }
  });
  
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

/**
 * 从记录中提取原始时间值
 * @param {Object} record - 单条记录数据
 * @returns {string|null} 原始时间字符串或null
 */
function extractRawTime(record) {
  const timeFields = ['开始时间', 'start_time', 'StartTime', '开始日期', 'date'];
  for (const field of timeFields) {
    if (record.hasOwnProperty(field) && record[field] !== undefined && record[field] !== null) {
      return String(record[field]);
    }
  }
  return null;
}

/**
 * 检查表格是否包含指定字段
 * @param {string} table - 表名
 * @param {string} column - 字段名
 * @returns {boolean} 是否包含字段
 */
async function hasColumn(table, column) {
  try {
    const result = await pool.query(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(`检查字段${column}存在性失败:`, error);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: '方法不允许，仅支持POST请求' 
    });
  }
  
  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ 
      success: false, 
      error: auth.error || '未授权访问' 
    });
  }
  
  // 验证请求数据
  const { records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: '无效的记录数据，需要非空数组' 
    });
  }
  
  try {
    // 检查是否存在start_time_raw字段
    const hasStartTimeRaw = await hasColumn('raw_records', 'start_time_raw');
    
    await pool.query('BEGIN');
    
    let insertedCount = 0;
    const importErrors = [];
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      try {
        const rawTime = extractRawTime(record);
        
        // 根据字段是否存在动态调整SQL
        let query, params;
        if (hasStartTimeRaw) {
          // 存在start_time_raw字段
          query = `INSERT INTO raw_records 
                   (plan_id, start_time, start_time_raw, customer, satellite, 
                    station, task_result, task_type, raw_data, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                   RETURNING id`;
          params = [
            record['计划ID'] || record.plan_id || null,
            rawTime,
            rawTime,  // 存储到start_time_raw
            record['客户'] || record.customer || null,
            record['卫星'] || record.satellite || null,
            record['测站'] || record.station || null,
            record['任务结果'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            JSON.stringify(record)
          ];
        } else {
          // 不存在start_time_raw字段，只使用start_time
          query = `INSERT INTO raw_records 
                   (plan_id, start_time, customer, satellite, 
                    station, task_result, task_type, raw_data, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                   RETURNING id`;
          params = [
            record['计划ID'] || record.plan_id || null,
            rawTime,  // 只存储到start_time
            record['客户'] || record.customer || null,
            record['卫星'] || record.satellite || null,
            record['测站'] || record.station || null,
            record['任务结果'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            JSON.stringify(record)
          ];
        }
        
        const result = await pool.query(query, params);
        if (result.rows && result.rows[0]) {
          insertedCount++;
        }
      } catch (error) {
        importErrors.push({
          index: i,
          error: error.message,
          record: { ...record }
        });
        console.error(`处理第 ${i + 1} 条记录失败:`, error.message);
      }
    }
    
    await pool.query('COMMIT');
    
    return res.status(200).json({
      success: true,
      message: `导入完成，成功导入 ${insertedCount} 条记录，共 ${records.length} 条`,
      inserted: insertedCount,
      total: records.length,
      errors: importErrors
    });
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('导入过程发生错误:', error);
    return res.status(500).json({
      success: false,
      error: '服务器处理错误: ' + error.message
    });
  }
}
    
