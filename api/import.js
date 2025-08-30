import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 精确的Excel日期时间解析函数
function parseExcelDateTime(excelValue) {
  // Excel的起始日期（1900年1月1日）
  const excelStartDate = new Date(1900, 0, 1);
  // Excel错误地认为1900年是闰年，所以需要减去2天的修正
  const daysToAdd = excelValue - 2;
  
  // 计算总毫秒数（一天 = 86400000毫秒）
  const totalMilliseconds = daysToAdd * 86400000;
  
  // 计算最终日期
  const resultDate = new Date(excelStartDate.getTime() + totalMilliseconds);
  
  // 验证日期是否合理（2000-2100年之间）
  if (resultDate.getFullYear() < 2000 || resultDate.getFullYear() > 2100) {
    console.warn(`解析结果超出合理范围: ${excelValue} -> ${resultDate.toISOString()}`);
  }
  
  return resultDate;
}

// 主日期时间解析函数
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 1. 优先处理Excel数值日期（你的问题场景）
  if (typeof dateTimeValue === 'number') {
    // 检查是否是合理的Excel日期数值（1970年之后）
    if (dateTimeValue > 25569) { // 25569是1970-01-01的Excel数值
      const date = parseExcelDateTime(dateTimeValue);
      console.log(`Excel数值解析: ${dateTimeValue} -> ${date.toISOString()}`);
      return date.toISOString();
    }
  }
  
  // 2. 处理标准字符串格式 "YYYY-MM-DD HH:mm:ss"
  if (typeof dateTimeValue === 'string') {
    const standardPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
    const standardMatch = dateTimeValue.match(standardPattern);
    
    if (standardMatch) {
      const [, year, month, day, hours, minutes, seconds] = standardMatch;
      const date = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1, // 月份修正
        parseInt(day, 10),
        parseInt(hours, 10),
        parseInt(minutes, 10),
        parseInt(seconds, 10)
      );
      
      if (!isNaN(date.getTime())) {
        console.log(`标准格式解析: ${dateTimeValue} -> ${date.toISOString()}`);
        return date.toISOString();
      }
    }
  }
  
  // 3. 处理其他常见格式
  if (typeof dateTimeValue === 'string') {
    const cleaned = dateTimeValue.trim();
    const date = new Date(cleaned);
    
    if (!isNaN(date.getTime())) {
      console.log(`通用格式解析: ${cleaned} -> ${date.toISOString()}`);
      return date.toISOString();
    }
  }
  
  console.warn(`无法解析的日期时间: ${dateTimeValue} (类型: ${typeof dateTimeValue})`);
  return null;
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
        const timeValue = record['开始时间'] || record.start_time || record['StartTime'];
        const startTime = parseDateTime(timeValue);
        
        if (!startTime) {
          throw new Error(`无法解析时间格式: ${timeValue}`);
        }
        
        // 验证解析后的年份是否合理
        const parsedYear = new Date(startTime).getFullYear();
        if (parsedYear < 2000 || parsedYear > 2100) {
          throw new Error(`解析结果年份不合理: ${parsedYear} (原始值: ${timeValue})`);
        }
        
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            startTime,
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
          originalValue: timeValue,
          record: record
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
    
