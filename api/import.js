import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 严格按照本地时间解析日期
function parseLocalDate(dateValue) {
  if (!dateValue) return null;
  
  // 情况1: 处理Excel数字日期格式（本地时间）
  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const daysToAdd = dateValue - 2;
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + daysToAdd);
    
    // 确保这是本地时间，不转换为UTC
    if (date.getTime() > 0) {
      return date;
    }
  }
  
  // 情况2: 处理字符串格式的日期（本地时间）
  if (typeof dateValue === 'string') {
    // 尝试直接解析为本地时间
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date;
    }
    
    // 处理中文日期格式
    const chineseFormats = [
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
      /^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2})$/,
    ];
    
    for (const format of chineseFormats) {
      const match = dateValue.match(format);
      if (match) {
        let year, month, day, hours = 0, minutes = 0, seconds = 0;
        
        if (match.length === 7) {
          [, year, month, day, hours, minutes, seconds] = match;
        } else if (match.length === 6) {
          [, year, month, day, hours, minutes] = match;
        } else if (match.length === 5) {
          [, month, day, year, hours, minutes] = match;
        } else if (match.length === 4) {
          [, year, month, day] = match;
        }
        
        // 处理月份（JavaScript月份从0开始）
        month = parseInt(month, 10) - 1;
        day = parseInt(day, 10);
        year = parseInt(year, 10);
        
        // 处理两位数年份
        if (year < 100) {
          year += 2000;
        }
        
        // 创建本地日期对象
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

// 格式化日期为ISO字符串，保留本地时间信息
function formatLocalDateForDB(date) {
  if (!date) return null;
  
  // 获取本地时间的各部分
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  // 格式化为 'YYYY-MM-DD HH:MM:SS' 字符串
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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
        // 获取开始时间值
        const startTimeValue = record['开始时间'] || record.start_time || record['StartTime'];
        // 解析为本地时间
        const localDate = parseLocalDate(startTimeValue);
        // 格式化为数据库可用的本地时间字符串
        const dbFormattedDate = formatLocalDateForDB(localDate);
        
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            dbFormattedDate,  // 存储为本地时间
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
          record: record,
          startTimeValue: record['开始时间'] || record.start_time
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
    
