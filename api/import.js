import { Pool } from 'pg';
import { verifyAuth } from '../../lib/auth';

// 确保只创建一个数据库连接池
let pool;
try {
  if (!global._pgPool) {
    // 检查环境变量是否存在
    if (!process.env.POSTGRES_URL) {
      throw new Error('POSTGRES_URL环境变量未设置');
    }
    pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    global._pgPool = pool;
  } else {
    pool = global._pgPool;
  }
} catch (error) {
  console.error('数据库连接初始化失败:', error);
  // 导出一个错误处理函数
  export default function handler(req, res) {
    res.status(500).json({ error: '服务器初始化失败: ' + error.message });
  }
  // 终止模块执行
  process.exit(0);
}

/**
 * 精确转换Excel日期数字为JavaScript日期
 */
function excelDateToJSDate(excelDate) {
  try {
    const isLeapYearError = excelDate >= 60;
    const daysToAdd = isLeapYearError ? excelDate - 2 : excelDate - 1;
    const baseDate = new Date(1899, 11, 30);
    const totalMilliseconds = daysToAdd * 86400000;
    const date = new Date(baseDate.getTime() + totalMilliseconds);
    
    if (date.toString() === 'Invalid Date') {
      throw new Error('转换结果为无效日期');
    }
    return date;
  } catch (error) {
    console.error('Excel日期转换失败:', error);
    throw error;
  }
}

/**
 * 尝试多种方式解析日期
 */
function parseDate(value) {
  if (!value) return { success: false, error: '空值' };
  
  // 处理数字类型的Excel日期
  if (typeof value === 'number' || !isNaN(Number(value))) {
    try {
      const numValue = Number(value);
      if (numValue > 1 && numValue < 100000) {
        const date = excelDateToJSDate(numValue);
        return {
          success: true,
          date: date.toISOString(),
          method: 'excel数字转换'
        };
      }
    } catch (error) {
      // 不抛出，继续尝试其他方法
    }
  }
  
  // 处理字符串类型的日期
  if (typeof value === 'string') {
    const date = new Date(value);
    if (date.toString() !== 'Invalid Date') {
      return {
        success: true,
        date: date.toISOString(),
        method: '直接字符串解析'
      };
    }
    
    const normalized = value.replace(/-/g, '/').replace(/\./g, '/');
    const date2 = new Date(normalized);
    if (date2.toString() !== 'Invalid Date') {
      return {
        success: true,
        date: date2.toISOString(),
        method: '替换分隔符后解析'
      };
    }
  }
  
  return {
    success: false,
    error: `无法解析为有效日期: ${value} (类型: ${typeof value})`
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: '方法不允许，仅支持POST' });
    }

    // 验证身份
    const auth = await verifyAuth(req);
    if (!auth.success) {
      return res.status(401).json({ error: auth.error || '认证失败' });
    }

    // 验证请求体
    if (!req.body || !Array.isArray(req.body.records)) {
      return res.status(400).json({ error: '无效的请求数据，records必须是数组' });
    }

    const { records } = req.body;
    
    // 开始事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    for (const [index, record] of records.entries()) {
      try {
        // 尝试找到日期字段并转换
        const dateFields = ['start_time', 'date', 'time', '开始时间', '日期', 'StartTime'];
        let startTime = null;
        
        for (const field of dateFields) {
          if (record[field] !== undefined) {
            const parseResult = parseDate(record[field]);
            if (parseResult.success) {
              startTime = parseResult.date;
              break;
            }
          }
        }
        
        // 插入记录
        const result = await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            record.plan_id || record.planId || record['计划ID'] || record['任务ID'] || null,
            startTime,
            record.customer || record['客户'] || null,
            record.satellite || record['卫星'] || null,
            record.station || record['测站'] || record['站点'] || null,
            record.task_result || record['任务结果'] || null,
            record.task_type || record['任务类型'] || null,
            record // 保存原始数据
          ]
        );
        
        if (result.rows.length > 0) {
          inserted++;
        }
      } catch (error) {
        errors.push({
          row: index + 1,
          error: error.message,
          data: {
            plan_id: record.plan_id || null,
            date_value: record.start_time || null
          }
        });
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      inserted,
      total: records.length,
      errors,
      message: errors.length > 0 
        ? `部分导入成功，共导入 ${inserted} 条，${errors.length} 条失败`
        : `全部导入成功，共导入 ${inserted} 条`
    });
  } catch (error) {
    // 发生错误时回滚事务
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('事务回滚失败:', rollbackError);
    }
    
    console.error('导入数据错误:', error);
    
    // 确保返回JSON格式的错误
    res.status(500).json({ 
      error: '导入失败: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
    
