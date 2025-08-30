import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 增强的日期时间解析函数，重点优化时间部分
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 情况1: 如果是数字，可能是Excel日期时间格式
  if (typeof dateTimeValue === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const daysToAdd = dateTimeValue - 2;
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + daysToAdd);
    
    if (date.getTime() > 0) {
      return date.toISOString();
    }
  }
  
  // 情况2: 处理字符串格式的日期时间
  if (typeof dateTimeValue === 'string') {
    // 清除可能的空格和特殊字符
    const cleaned = dateTimeValue.trim().replace(/[^\d\-\/:年月日时分秒 ]/g, '');
    
    // 专门处理时间部分的正则表达式
    const timePatterns = [
      // 小时:分钟:秒 格式 (24小时制)
      /(\d{1,2}):(\d{2}):(\d{2})/,
      // 小时:分钟 格式 (24小时制)
      /(\d{1,2}):(\d{2})/,
      // 小时.分钟.秒 格式
      /(\d{1,2})\.(\d{2})\.(\d{2})/,
      // 小时.分钟 格式
      /(\d{1,2})\.(\d{2})/,
      // 小时点分钟 格式 (中文常用)
      /(\d{1,2})点(\d{2})分(\d{2})秒/,
      // 小时点分钟 格式
      /(\d{1,2})点(\d{2})分/,
      // 小时点 格式
      /(\d{1,2})点/
    ];
    
    // 尝试直接解析完整的日期时间字符串
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    
    // 尝试解析中文日期时间格式
    const chinesePatterns = [
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})点(\d{2})分(\d{2})秒$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})点(\d{2})分$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2}):(\d{2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})$/,
      /^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{1,2}):(\d{2}):(\d{2})$/,
      /^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{1,2}):(\d{2})$/,
    ];
    
    for (const pattern of chinesePatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        let year, month, day, hours = 0, minutes = 0, seconds = 0;
        
        // 根据不同的匹配结果解析
        if (match.length === 7) {
          [, year, month, day, hours, minutes, seconds] = match;
        } else if (match.length === 6) {
          [, year, month, day, hours, minutes] = match;
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
        
        // 处理12小时制可能的问题
        if (hours > 23) hours = 23;
        if (minutes > 59) minutes = 59;
        if (seconds > 59) seconds = 59;
        
        const date = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }
    
    // 如果只包含时间，默认使用今天的日期
    for (const pattern of timePatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        let hours = 0, minutes = 0, seconds = 0;
        
        if (match.length === 4) {
          [, hours, minutes, seconds] = match;
        } else if (match.length === 3) {
          [, hours, minutes] = match;
        } else if (match.length === 2) {
          [, hours] = match;
        }
        
        hours = parseInt(hours, 10);
        minutes = parseInt(minutes || 0, 10);
        seconds = parseInt(seconds || 0, 10);
        
        // 处理12小时制可能的问题
        if (hours > 23) hours = 23;
        if (minutes > 59) minutes = 59;
        if (seconds > 59) seconds = 59;
        
        // 使用今天的日期加上解析的时间
        const date = new Date();
        date.setHours(hours, minutes, seconds, 0);
        return date.toISOString();
      }
    }
  }
  
  console.warn(`无法完全解析日期时间: ${dateTimeValue} (类型: ${typeof dateTimeValue})`);
  // 即使时间解析失败，也尝试返回日期部分
  const dateOnly = new Date(dateTimeValue);
  return !isNaN(dateOnly.getTime()) ? dateOnly.toISOString() : null;
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
        
        // 记录解析结果用于调试
        if (startTime) {
          const parsedDate = new Date(startTime);
          console.log(`解析成功: ${timeValue} -> ${parsedDate.toLocaleString()}`);
        } else {
          console.log(`解析失败: ${timeValue}`);
        }
        
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
    
