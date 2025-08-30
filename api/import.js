import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 精确解析Excel数值日期时间（无时区转换）
function parseExcelDateTime(excelValue) {
  // 分离整数部分（日期）和小数部分（时间）
  const days = Math.floor(excelValue);
  const timeFraction = excelValue - days;
  
  // Excel起始日期（1900年1月1日）
  const excelStartDate = new Date(1900, 0, 1);
  
  // 修正Excel 1900年闰年错误
  const adjustedDays = days - 2;
  
  // 计算基准日期
  const baseDate = new Date(excelStartDate);
  baseDate.setDate(excelStartDate.getDate() + adjustedDays);
  baseDate.setHours(0, 0, 0, 0);
  
  // 精确计算时间部分（完全基于Excel数值，不做时区调整）
  const totalSeconds = timeFraction * 86400; // 86400秒 = 1天
  const hours = Math.floor(totalSeconds / 3600);
  const remainingSeconds = totalSeconds % 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  const milliseconds = Math.round((remainingSeconds % 60 - seconds) * 1000);
  
  // 构建最终日期时间（完全基于Excel数值）
  const resultDate = new Date(baseDate);
  resultDate.setHours(hours, minutes, seconds, milliseconds);
  
  // 详细日志
  console.log(`Excel时间解析:
    原始值: ${excelValue}
    日期部分: ${days}天 -> ${baseDate.toISOString().split('T')[0]}
    时间部分: ${timeFraction} -> ${hours}:${minutes}:${seconds}.${milliseconds}
    解析结果: ${resultDate.toISOString()}`);
  
  return resultDate.toISOString();
}

// 主解析函数（无时区转换）
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 1. 处理Excel数值
  if (typeof dateTimeValue === 'number') {
    if (dateTimeValue > 25569) { // 1970年之后的日期
      return parseExcelDateTime(dateTimeValue);
    }
  }
  
  // 2. 处理标准字符串格式（完全按字符串原始值解析）
  if (typeof dateTimeValue === 'string') {
    // 支持 "YYYY-MM-DD HH:mm:ss" 格式
    const standardPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
    const match = dateTimeValue.match(standardPattern);
    
    if (match) {
      const [, year, month, day, hours, minutes, seconds] = match;
      // 直接按字符串中的数值构建日期，不做时区调整
      const date = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1, // 月份修正（0开始）
        parseInt(day, 10),
        parseInt(hours, 10),
        parseInt(minutes, 10),
        parseInt(seconds, 10)
      );
      
      if (!isNaN(date.getTime())) {
        console.log(`字符串时间解析: ${dateTimeValue} -> ${date.toISOString()}`);
        return date.toISOString();
      }
    }
  }
  
  // 3. 尝试直接解析其他字符串格式
  if (typeof dateTimeValue === 'string') {
    const date = new Date(dateTimeValue);
    if (!isNaN(date.getTime())) {
      console.log(`直接解析: ${dateTimeValue} -> ${date.toISOString()}`);
      return date.toISOString();
    }
  }
  
  console.warn(`无法解析的时间格式: ${dateTimeValue} (类型: ${typeof dateTimeValue})`);
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
        const timeValue = record['开始时间'] || record.start_time;
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
            record['客户'] || null,
            record['卫星'] || null,
            record['测站'] || null,
            record['任务结果'] || null,
            record['任务类型'] || null,
            JSON.stringify(record)
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
      message: `成功导入 ${inserted} 条记录`
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('导入数据错误:', error);
    res.status(500).json({ error: '导入数据失败: ' + error.message });
  }
}
    
