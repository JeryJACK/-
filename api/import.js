import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 直接解析为北京时间（不进行时区转换）
function parseBeijingTime(dateValue) {
  if (!dateValue) return null;
  
  // 情况1: 处理Excel数字日期格式
  if (typeof dateValue === 'number') {
    // Excel日期是自1900年1月1日以来的天数（包含错误的1900年闰年）
    const excelEpoch = new Date(1900, 0, 1);
    const daysToAdd = dateValue - 2; // 修正Excel的闰年错误
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + daysToAdd);
    
    // 确认是有效日期
    if (date.getTime() > 0) {
      return date;
    }
  }
  
  // 情况2: 处理字符串格式的日期（直接按北京时间解析）
  if (typeof dateValue === 'string') {
    // 尝试直接解析为日期（默认按本地时间，这里即北京时间）
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date;
    }
    
    // 专门处理中文日期格式（北京时间）
    const chineseFormats = [
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      /^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{1,2}):(\d{1,2})$/,
    ];
    
    for (const format of chineseFormats) {
      const match = dateValue.match(format);
      if (match) {
        let year, month, day, hours = 0, minutes = 0, seconds = 0;
        
        // 根据不同匹配结果解析
        if (match.length === 7) {
          [, year, month, day, hours, minutes, seconds] = match;
        } else if (match.length === 6) {
          [, year, month, day, hours, minutes] = match;
        } else if (match.length === 5) {
          [, month, day, year, hours, minutes] = match;
        } else if (match.length === 4) {
          [, year, month, day] = match;
        }
        
        // 转换为数字
        month = parseInt(month, 10) - 1; // JavaScript月份从0开始
        day = parseInt(day, 10);
        year = parseInt(year, 10);
        hours = parseInt(hours, 10) || 0;
        minutes = parseInt(minutes, 10) || 0;
        seconds = parseInt(seconds, 10) || 0;
        
        // 处理两位数年份（默认20xx年）
        if (year < 100) {
          year += 2000;
        }
        
        // 创建日期对象（直接作为北京时间处理）
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

// 格式化日期为北京时间字符串，直接存储
function formatBeijingTimeForDB(date) {
  if (!date) return null;
  
  // 直接获取日期各部分（已经是北京时间）
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // 月份+1，因为JS月份从0开始
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  // 格式化为 PostgreSQL 可直接识别的北京时间字符串
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许，仅支持POST' });
  }
  
  // 验证用户身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }
  
  const { records } = req.body;
  
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: '没有提供有效的记录数据' });
  }
  
  try {
    // 开始事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    // 逐条处理记录
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      try {
        // 获取时间字段值（支持多种可能的字段名）
        const timeValue = record['开始时间'] || record.start_time || record['StartTime'];
        // 解析为北京时间
        const beijingTime = parseBeijingTime(timeValue);
        
        if (!beijingTime) {
          throw new Error(`无法解析时间格式: ${timeValue}`);
        }
        
        // 格式化为数据库存储格式（直接作为北京时间）
        const dbTime = formatBeijingTimeForDB(beijingTime);
        
        // 插入数据库（不进行任何时区转换）
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw, start_time_raw)
           VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8, $9)`,
          [
            record['计划ID'] || record.plan_id || null,
            dbTime,  // 直接存储为北京时间
            record['所属客户'] || record.customer || null,
            record['卫星名称'] || record.satellite || null,
            record['测站名称'] || record.station || null,
            record['任务结果状态'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            JSON.stringify(record),  // 存储原始数据
            String(timeValue)  // 存储原始时间字符串，用于调试
          ]
        );
        
        inserted++;
      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          originalTimeValue: timeValue,
          record: { ...record, start_time: undefined } // 避免敏感数据
        });
        console.error(`处理第 ${i+1} 条记录失败:`, error);
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      inserted: inserted,
      total: records.length,
      errors: errors,
      message: `成功导入 ${inserted} 条记录，共 ${records.length} 条`
    });
  } catch (error) {
    // 出错时回滚事务
    await pool.query('ROLLBACK');
    console.error('导入数据错误:', error);
    res.status(500).json({ error: '导入数据失败: ' + error.message });
  }
}
    
