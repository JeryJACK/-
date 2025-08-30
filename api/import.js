import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 调试用：显示时间解析过程
function logTimeParseStep(step, value) {
  console.log(`[时间解析] ${step}:`, value);
}

// 核心修复：正确解析北京时间（确保小时部分正确）
function parseBeijingTime(dateValue) {
  if (!dateValue) {
    logTimeParseStep('空值', dateValue);
    return null;
  }
  
  // 处理Excel数字日期格式（包含时间）
  if (typeof dateValue === 'number') {
    logTimeParseStep('Excel数字格式', dateValue);
    
    // Excel日期是自1900年1月1日以来的天数（包含时间小数部分）
    const excelEpoch = new Date(1900, 0, 1);
    const days = Math.floor(dateValue);
    const hours = (dateValue - days) * 24; // 提取小时部分
    const minutes = (hours - Math.floor(hours)) * 60;
    const seconds = (minutes - Math.floor(minutes)) * 60;
    
    logTimeParseStep('提取的时间部分', `天:${days}, 时:${hours}, 分:${minutes}`);
    
    // 修正Excel的1900年闰年错误
    const adjustedDays = days - 2;
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + adjustedDays);
    
    // 设置时间部分（北京时间）
    date.setHours(Math.floor(hours));
    date.setMinutes(Math.floor(minutes));
    date.setSeconds(Math.floor(seconds));
    
    if (date.getTime() > 0) {
      logTimeParseStep('解析结果', date.toLocaleString('zh-CN'));
      return date;
    }
  }
  
  // 处理字符串格式的日期时间
  if (typeof dateValue === 'string') {
    logTimeParseStep('字符串格式', dateValue);
    
    // 尝试直接解析（作为本地时间，即北京时间）
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      logTimeParseStep('直接解析结果', date.toLocaleString('zh-CN'));
      return date;
    }
    
    // 增强的中文日期时间格式处理（重点确保小时正确）
    const timeFormats = [
      // 带秒的完整格式
      {
        regex: /^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日]?\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
        handler: (m) => ({y:m[1], m:m[2], d:m[3], h:m[4], mi:m[5], s:m[6]})
      },
      // 不带秒的格式
      {
        regex: /^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日]?\s*(\d{1,2}):(\d{1,2})$/,
        handler: (m) => ({y:m[1], m:m[2], d:m[3], h:m[4], mi:m[5], s:0})
      },
      // 仅日期
      {
        regex: /^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日]?$/,
        handler: (m) => ({y:m[1], m:m[2], d:m[3], h:0, mi:0, s:0})
      },
      // 月/日/年 格式
      {
        regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{1,2})$/,
        handler: (m) => ({y:m[3], m:m[1], d:m[2], h:m[4], mi:m[5], s:0})
      }
    ];
    
    for (const format of timeFormats) {
      const match = dateValue.match(format.regex);
      if (match) {
        const parts = format.handler(match);
        
        // 转换为数字并验证范围
        const year = parseInt(parts.y, 10);
        const month = parseInt(parts.m, 10) - 1; // 月份从0开始
        const day = parseInt(parts.d, 10);
        const hours = parseInt(parts.h, 10);
        const minutes = parseInt(parts.mi, 10);
        const seconds = parseInt(parts.s, 10);
        
        // 验证时间范围
        if (hours < 0 || hours > 23) continue;
        if (minutes < 0 || minutes > 59) continue;
        if (seconds < 0 || seconds > 59) continue;
        
        logTimeParseStep('解析的时间部分', `时:${hours}, 分:${minutes}, 秒:${seconds}`);
        
        const date = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(date.getTime())) {
          logTimeParseStep('格式解析结果', date.toLocaleString('zh-CN'));
          return date;
        }
      }
    }
  }
  
  console.warn(`无法解析的时间格式: ${dateValue} (类型: ${typeof dateValue})`);
  return null;
}

// 格式化时间为PostgreSQL兼容的北京时间字符串
function formatBeijingTimeForDB(date) {
  if (!date) return null;
  
  // 直接使用北京时间的各部分构建字符串（不做时区转换）
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  // 明确指定时区为北京时间
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+08`;
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
      let timeValue;
      const record = records[i];
      
      try {
        if (typeof record !== 'object' || record === null) {
          throw new Error('记录格式无效，必须是对象');
        }
        
        // 获取时间值
        timeValue = record['开始时间'] || record.start_time || record['StartTime'];
        
        const beijingTime = parseBeijingTime(timeValue);
        
        if (!beijingTime) {
          throw new Error(`无法解析时间格式: ${timeValue || '未提供时间'}`);
        }
        
        // 格式化为带北京时间时区的字符串
        const dbTime = formatBeijingTimeForDB(beijingTime);
        
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw)
           VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            dbTime,  // 存储为带北京时间时区的时间
            record['客户'] || record.customer || null,
            record['卫星'] || record.satellite || null,
            record['测站'] || record.station || null,
            record['任务结果'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            JSON.stringify(record)
          ]
        );
        
        inserted++;
      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          originalTimeValue: timeValue !== undefined ? String(timeValue) : '未获取到时间值',
          parsedTime: beijingTime ? beijingTime.toLocaleString('zh-CN') : '解析失败'
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
    
