import { Pool } from 'pg';
import { verifyAuth } from '../../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.your-random-secret-key-123   });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

/**
 * 精确转换Excel日期数字为JavaScript日期
 * Excel日期是自1900年1月1日以来的天数（包含时间小数部分）
 */
function excelDateToJSDate(excelDate) {
  // 处理Excel的1900年闰年错误
  const isLeapYearError = excelDate >= 60;
  const daysToAdd = isLeapYearError ? excelDate - 2 : excelDate - 1;
  
  // 从1900年1月1日开始计算
  const baseDate = new Date(1899, 11, 30); // 实际上Excel起始日期是1899-12-30
  
  // 计算总毫秒数（一天 = 86400000毫秒）
  const totalMilliseconds = daysToAdd * 86400000;
  
  // 创建日期对象
  const date = new Date(baseDate.getTime() + totalMilliseconds);
  
  return date;
}

/**
 * 尝试多种方式解析日期
 */
function parseDate(value) {
  // 记录调试信息，帮助排查问题
  console.log(`尝试解析日期: ${value} (类型: ${typeof value})`);
  
  if (!value) return { success: false, error: '空值' };
  
  // 处理数字类型的Excel日期
  if (typeof value === 'number' || !isNaN(Number(value))) {
    try {
      const numValue = Number(value);
      // Excel日期通常在25569（1970-01-01）到很大的数字之间
      if (numValue > 1 && numValue < 100000) {
        const date = excelDateToJSDate(numValue);
        // 验证日期有效性
        if (date.toString() !== 'Invalid Date') {
          return {
            success: true,
            date: date.toISOString(),
            method: 'excel数字转换'
          };
        }
      }
    } catch (error) {
      console.log('Excel日期转换失败:', error.message);
    }
  }
  
  // 处理字符串类型的日期
  if (typeof value === 'string') {
    // 尝试直接解析
    const date = new Date(value);
    if (date.toString() !== 'Invalid Date') {
      return {
        success: true,
        date: date.toISOString(),
        method: '直接字符串解析'
      };
    }
    
    // 尝试替换分隔符
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
  
  // 所有尝试都失败
  return {
    success: false,
    error: `无法解析为有效日期: ${value} (类型: ${typeof value})`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  const { records } = req.body;
  
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: '无效的记录数据' });
  }

  try {
    // 开始事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    for (const [index, record] of records.entries()) {
      try {
        // 尝试找到日期字段并转换
        const dateFields = ['start_time', 'date', 'time', '开始时间', '日期', 'StartTime'];
        let startTime = null;
        let dateFieldUsed = null;
        
        for (const field of dateFields) {
          if (record[field] !== undefined) {
            const parseResult = parseDate(record[field]);
            if (parseResult.success) {
              startTime = parseResult.date;
              dateFieldUsed = field;
              console.log(`行 ${index + 1}: 成功解析${field}字段，使用${parseResult.method}`);
              break;
            } else {
              console.log(`行 ${index + 1}: ${field}字段解析失败 - ${parseResult.error}`);
            }
          }
        }
        
        // 如果找不到有效日期，仍然尝试插入记录（日期为null）
        console.log(`行 ${index + 1}: 最终使用的日期值: ${startTime}`);
        
        // 插入记录
        const result = await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            record.plan_id || record.planId || record['计划ID'] || record['任务ID'] || null,
            startTime,
            record.customer || record['所属客户'] || null,
            record.satellite || record['卫星名称'] || null,
            record.station || record['测站名称'] || record['站点'] || null,
            record.task_result || record['任务结果状态'] || null,
            record.task_type || record['任务类型'] || null,
            record // 保存原始数据，便于排查问题
          ]
        );
        
        if (result.rows.length > 0) {
          inserted++;
        }
      } catch (error) {
        const errorMsg = error.message.includes('timestamp') 
          ? `时间戳格式错误: ${error.message}`
          : error.message;
          
        errors.push({
          row: index + 1, // 行号从1开始
          error: errorMsg,
          data: {
            // 只保留关键字段，避免数据过大
            plan_id: record.plan_id || record.planId || record['计划ID'] || null,
            date_value: record.start_time || record.date || record['开始时间'] || null
          }
        });
        console.error(`处理第${index + 1}行时出错:`, error);
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
    // 回滚事务
    await pool.query('ROLLBACK');
    console.error('导入数据错误:', error);
    res.status(500).json({ error: '导入失败: ' + error.message });
  }
}
    


