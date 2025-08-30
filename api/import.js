import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 优化的日期时间解析函数，优先处理标准格式
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 1. 首先处理标准的"YYYY-MM-DD HH:mm:ss"格式（你的情况）
  const standardPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  if (typeof dateTimeValue === 'string') {
    const standardMatch = dateTimeValue.match(standardPattern);
    if (standardMatch) {
      const [, year, month, day, hours, minutes, seconds] = standardMatch;
      // 月份减1因为JavaScript月份从0开始
      const date = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hours, 10),
        parseInt(minutes, 10),
        parseInt(seconds, 10)
      );
      if (!isNaN(date.getTime())) {
        console.log(`标准格式解析成功: ${dateTimeValue} -> ${date.toISOString()}`);
        return date.toISOString();
      }
    }
  }
  
  // 2. 处理Excel数字日期时间格式
  if (typeof dateTimeValue === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const daysToAdd = dateTimeValue - 2;
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + daysToAdd);
    
    if (date.getTime() > 0) {
      return date.toISOString();
    }
  }
  
  // 3. 处理其他常见的日期时间格式
  if (typeof dateTimeValue === 'string') {
    // 清理字符串
    const cleaned = dateTimeValue.trim();
    
    // 尝试直接解析
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    
    // 处理其他可能的格式
    const otherPatterns = [
      /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})$/, // YYYY-MM-DD HH:mm
      /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/, // MM/DD/YYYY HH:mm:ss
      /^(\d{4})年(\d{1,2})月(\d{1,2})日 (\d{1,2}):(\d{2}):(\d{2})$/, // 中文日期时间
    ];
    
    for (const pattern of otherPatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        let year, month, day, hours = 0, minutes = 0, seconds = 0;
        
        if (match.length === 7) {
          [, year, month, day, hours, minutes, seconds] = match;
        } else if (match.length === 6) {
          [, year, month, day, hours, minutes] = match;
        }
        
        // 处理月份（JavaScript月份从0开始）
        month = parseInt(month, 10) - 1;
        const date = new Date(
          parseInt(year, 10),
          month,
          parseInt(day, 10),
          parseInt(hours, 10),
          parseInt(minutes, 10),
          parseInt(seconds || 0, 10)
        );
        
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }
  }
  
  console.warn(`无法解析的日期时间格式: ${dateTimeValue} (类型: ${typeof dateTimeValue})`);
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
        // 获取时间值（支持多种可能的字段名）
        const timeValue = record['开始时间'] || record.start_time || record['StartTime'];
        const startTime = parseDateTime(timeValue);
        
        if (!startTime) {
          throw new Error(`无法解析时间格式: ${timeValue}`);
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
          originalTimeValue: record['开始时间'] || record.start_time,
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
    
