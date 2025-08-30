import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 解析为北京时间并转换为UTC存储（解决时区问题的核心）
function parseBeijingTimeToUTC(dateValue) {
  if (!dateValue) return null;
  
  // 处理Excel数字日期格式
  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const daysToAdd = dateValue - 2;
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + daysToAdd);
    
    if (date.getTime() > 0) {
      return date;
    }
  }
  
  // 处理字符串格式的日期
  if (typeof dateValue === 'string') {
    // 尝试直接解析为日期（默认按本地时间）
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date;
    }
    
    // 中文日期格式处理
    const chineseFormats = [
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    ];
    
    for (const format of chineseFormats) {
      const match = dateValue.match(format);
      if (match) {
        let year, month, day, hours = 0, minutes = 0, seconds = 0;
        
        if (match.length === 7) {
          [, year, month, day, hours, minutes, seconds] = match;
        } else if (match.length === 6) {
          [, year, month, day, hours, minutes] = match;
        } else if (match.length === 4) {
          [, year, month, day] = match;
        }
        
        month = parseInt(month, 10) - 1;
        day = parseInt(day, 10);
        year = parseInt(year, 10);
        
        if (year < 100) year += 2000;
        
        // 创建北京时间日期对象
        const date = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
  }
  
  console.warn(`无法解析日期格式: ${dateValue} (类型: ${typeof dateValue})`);
  return null;
}

// 格式化日期为带时区的UTC时间字符串（PostgreSQL会自动转换为TIMESTAMPTZ）
function formatTimeForDB(date) {
  if (!date) return null;
  
  // 转换为ISO格式的UTC时间（包含时区信息）
  return date.toISOString();
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
        
        const beijingTime = parseBeijingTimeToUTC(timeValue);
        
        if (!beijingTime) {
          throw new Error(`无法解析时间格式: ${timeValue || '未提供时间'}`);
        }
        
        // 格式化为带时区的UTC时间字符串
        const dbTime = formatTimeForDB(beijingTime);
        
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw)
           VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            dbTime,  // 存储为带时区的时间戳
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
          originalTimeValue: timeValue !== undefined ? String(timeValue) : '未获取到时间值'
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
    
