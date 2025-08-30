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
  
  // 转换为字符串处理（如果是数字）
  const valueStr = typeof dateTimeValue === 'number' 
    ? dateTimeValue.toString() 
    : dateTimeValue.toString().trim();
  
  // 1. 优先处理标准的 "YYYY-MM-DD HH:MM:SS" 格式
  const standardPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = valueStr.match(standardPattern);
  if (match) {
    try {
      const [, year, month, day, hours, minutes, seconds] = match;
      // 注意：JavaScript月份从0开始，所以需要减1
      const date = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hours, 10),
        parseInt(minutes, 10),
        parseInt(seconds, 10)
      );
      
      if (!isNaN(date.getTime())) {
        console.log(`标准格式解析成功: ${valueStr}`);
        return date.toISOString();
      }
    } catch (error) {
      console.error(`标准格式解析失败: ${valueStr}`, error);
    }
  }
  
  // 2. 处理Excel数字日期格式
  if (!isNaN(parseFloat(valueStr)) && isFinite(valueStr)) {
    const excelDate = parseFloat(valueStr);
    const excelEpoch = new Date(1900, 0, 1);
    const daysToAdd = excelDate - 2;
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + daysToAdd);
    
    if (date.getTime() > 0) {
      console.log(`Excel数字格式解析成功: ${valueStr} -> ${date.toISOString()}`);
      return date.toISOString();
    }
  }
  
  // 3. 处理其他常见格式
  const otherPatterns = [
    // 带秒的格式
    /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/,
    // 不带秒的格式
    /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})$/,
    // 中文格式
    /^(\d{4})年(\d{1,2})月(\d{1,2})日 (\d{1,2}):(\d{2}):(\d{2})$/,
    // 斜杠格式
    /^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/
  ];
  
  for (const pattern of otherPatterns) {
    const otherMatch = valueStr.match(pattern);
    if (otherMatch) {
      try {
        let year, month, day, hours = 0, minutes = 0, seconds = 0;
        
        if (otherMatch.length === 7) {
          [, year, month, day, hours, minutes, seconds] = otherMatch;
        } else if (otherMatch.length === 6) {
          [, year, month, day, hours, minutes] = otherMatch;
        }
        
        // 处理月份（JavaScript月份从0开始）
        month = parseInt(month, 10) - 1;
        day = parseInt(day, 10);
        year = parseInt(year, 10);
        hours = parseInt(hours, 10);
        minutes = parseInt(minutes, 10);
        seconds = parseInt(seconds || 0, 10);
        
        // 处理可能的两位数年份
        if (year < 100) {
          year += 2000;
        }
        
        // 验证时间范围
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60) {
          const date = new Date(year, month, day, hours, minutes, seconds);
          if (!isNaN(date.getTime())) {
            console.log(`其他格式解析成功: ${valueStr} -> ${date.toISOString()}`);
            return date.toISOString();
          }
        }
      } catch (error) {
        console.error(`其他格式解析失败: ${valueStr}`, error);
      }
    }
  }
  
  // 4. 尝试使用JavaScript原生解析作为最后的手段
  const date = new Date(valueStr);
  if (!isNaN(date.getTime())) {
    console.log(`原生解析成功: ${valueStr} -> ${date.toISOString()}`);
    return date.toISOString();
  }
  
  console.warn(`所有解析方法均失败: ${valueStr}`);
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
          errors.push({
            index: i,
            error: '无法解析日期时间',
            originalValue: timeValue
          });
          continue;
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
          originalValue: record['开始时间'] || record.start_time,
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
    
