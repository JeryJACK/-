import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false } // 确保SSL连接正确
  });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 精确解析Excel日期时间
function parseExcelDateTime(excelValue) {
  const days = Math.floor(excelValue);
  const fraction = excelValue - days;
  
  // 修正Excel 1900年闰年bug
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch);
  date.setDate(excelEpoch.getDate() + days);
  
  // 精确计算时间部分
  const totalSeconds = Math.floor(fraction * 24 * 60 * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  date.setHours(hours, minutes, seconds, 0);
  return date;
}

// 完整的日期时间解析函数
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 处理Excel数字格式
  if (typeof dateTimeValue === 'number' || !isNaN(parseFloat(dateTimeValue))) {
    const excelValue = parseFloat(dateTimeValue);
    if (excelValue > 25569 && excelValue < 40000) { // 合理日期范围
      try {
        const date = parseExcelDateTime(excelValue);
        if (!isNaN(date.getTime())) {
          return date; // 返回Date对象而非字符串，避免转换问题
        }
      } catch (error) {
        console.error(`Excel解析失败: ${excelValue}`, error);
      }
    }
  }
  
  // 处理标准字符串格式
  const valueStr = typeof dateTimeValue === 'string' ? dateTimeValue.trim() : '';
  const standardPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = valueStr.match(standardPattern);
  
  if (match) {
    try {
      const [, year, month, day, hours, minutes, seconds] = match;
      const date = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hours, 10),
        parseInt(minutes, 10),
        parseInt(seconds, 10)
      );
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch (error) {
      console.error(`标准格式解析失败: ${valueStr}`, error);
    }
  }
  
  // 原生解析
  const date = new Date(dateTimeValue);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  console.warn(`所有解析方法均失败: ${dateTimeValue}`);
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
        const dateObj = parseDateTime(timeValue);
        
        if (!dateObj) {
          errors.push({
            index: i,
            error: '无法解析日期时间',
            originalValue: timeValue
          });
          continue;
        }
        
        // 关键修复：直接使用Date对象并打印调试信息
        const isoString = dateObj.toISOString();
        console.log(`准备插入数据库的时间: ${isoString}`);
        console.log(`日期对象详情:`, {
          year: dateObj.getUTCFullYear(),
          month: dateObj.getUTCMonth() + 1,
          day: dateObj.getUTCDate(),
          hours: dateObj.getUTCHours(),
          minutes: dateObj.getUTCMinutes(),
          seconds: dateObj.getUTCSeconds()
        });
        
        // 执行插入时使用参数化查询，确保时间完整传递
        const result = await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING start_time`, // 返回实际插入的时间
          [
            record['计划ID'] || record.plan_id || null,
            isoString, // 使用ISO字符串插入
            record['客户'] || record.customer || null,
            record['卫星'] || record.satellite || null,
            record['测站'] || record.station || null,
            record['任务结果'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            record ? JSON.stringify(record) : null
          ]
        );
        
        // 验证数据库实际存储的时间
        const storedTime = result.rows[0].start_time;
        console.log(`数据库实际存储的时间: ${storedTime.toISOString()}`);
        
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
    
