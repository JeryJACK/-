import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

// 初始化数据库连接池
let pool;
if (!global._pgPool) {
  // 从环境变量获取数据库连接字符串
  if (!process.env.POSTGRES_URL) {
    console.error('缺少POSTGRES_URL环境变量');
  }
  
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
 * 从记录中提取原始时间值，不做任何转换
 * @param {Object} record - 单条记录数据
 * @returns {string|null} 原始时间字符串或null
 */
function extractRawTime(record) {
  // 尝试从不同可能的字段名获取时间值
  const timeFields = ['开始时间', 'start_time', 'StartTime', '开始日期', 'date'];
  for (const field of timeFields) {
    if (record.hasOwnProperty(field) && record[field] !== undefined && record[field] !== null) {
      // 直接返回原始值的字符串形式
      return String(record[field]);
    }
  }
  return null;
}

/**
 * 主处理函数
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
export default async function handler(req, res) {
  // 只允许POST方法
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: '方法不允许，仅支持POST请求' 
    });
  }
  
  // 验证用户身份
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
    // 开始数据库事务
    await pool.query('BEGIN');
    
    let insertedCount = 0;
    const importErrors = [];
    
    // 逐条处理记录
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      try {
        // 提取原始时间值
        const rawTime = extractRawTime(record);
        
        // 插入数据库
        const result = await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, start_time_raw, customer, satellite, 
            station, task_result, task_type, raw_data, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           RETURNING id`,
          [
            // 计划ID
            record['计划ID'] || record.plan_id || record.planId || null,
            // 开始时间（原始格式）
            rawTime,
            // 原始时间备份
            rawTime,
            // 客户信息
            record['所属客户'] || record.customer || null,
            // 卫星信息
            record['卫星名称'] || record.satellite || null,
            // 测站信息
            record['测站，名称'] || record.station || null,
            // 任务结果
            record['任务结果状态'] || record.taskResult || null,
            // 任务类型
            record['任务类型'] || record.taskType || null,
            // 原始数据备份
            JSON.stringify(record)
          ]
        );
        
        // 记录成功插入的ID
        if (result.rows && result.rows[0]) {
          insertedCount++;
        }
      } catch (error) {
        // 记录错误信息
        importErrors.push({
          index: i,
          record: { ...record }, // 复制记录对象
          error: error.message,
          timestamp: new Date().toISOString()
        });
        console.error(`处理第 ${i + 1} 条记录失败:`, error.message);
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    // 返回处理结果
    return res.status(200).json({
      success: true,
      message: `导入完成，成功导入 ${insertedCount} 条记录，共 ${records.length} 条`,
      inserted: insertedCount,
      total: records.length,
      errors: importErrors,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    // 发生严重错误，回滚事务
    await pool.query('ROLLBACK');
    console.error('导入过程发生错误:', error);
    
    return res.status(500).json({
      success: false,
      error: '服务器处理错误: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
}
    

