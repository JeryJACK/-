import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 辅助函数：将日期转换为本地时间字符串（不转换为UTC）
function toLocalISOString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  
  // 返回本地时间的ISO格式字符串（不带时区信息，或强制为+08:00）
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`;
}

// 解析Excel数值为本地时间（完全匹配预期）
function parseExcelDateTime(excelValue) {
  // 分离日期和时间部分
  const days = Math.floor(excelValue);
  const timeFraction = excelValue - days;
  
  // Excel起始日期（1900年1月1日）
  const excelStartDate = new Date(1900, 0, 1);
  
  // 修正Excel闰年错误
  const adjustedDays = days - 2;
  
  // 计算基准日期
  const baseDate = new Date(excelStartDate);
  baseDate.setDate(excelStartDate.getDate() + adjustedDays);
  baseDate.setHours(0, 0, 0, 0);
  
  // 计算时间部分（按本地时间处理）
  const totalSeconds = timeFraction * 86400;
  const hours = Math.floor(totalSeconds / 3600);
  const remainingSeconds = totalSeconds % 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  const milliseconds = Math.round((remainingSeconds % 60 - seconds) * 1000);
  
  // 构建最终日期时间（本地时间）
  const resultDate = new Date(baseDate);
  resultDate.setHours(hours, minutes, seconds, milliseconds);
  
  // 转换为本地时间字符串（不转为UTC）
  const localTimeStr = toLocalISOString(resultDate);
  
  // 详细日志
  console.log(`Excel时间解析:
    原始值: ${excelValue}
    计算时间(本地): ${hours}:${minutes}:${seconds}
    解析结果: ${localTimeStr}`);
  
  return localTimeStr;
}

// 解析字符串格式时间（完全按字面意思处理）
function parseStringDateTime(dateTimeStr) {
  // 匹配 "YYYY-MM-DD HH:mm:ss" 格式
  const pattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = dateTimeStr.match(pattern);
  
  if (match) {
    const [, year, month, day, hours, minutes, seconds] = match;
    // 直接按字符串中的数值构建本地时间
    const date = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1, // 月份修正
      parseInt(day, 10),
      parseInt(hours, 10),
      parseInt(minutes, 10),
      parseInt(seconds, 10)
    );
    
    // 转换为本地时间字符串
    const localTimeStr = toLocalISOString(date);
    console.log(`字符串时间解析: ${dateTimeStr} -> ${localTimeStr}`);
    return localTimeStr;
  }
  
  return null;
}

// 主解析函数
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 1. 处理Excel数值
  if (typeof dateTimeValue === 'number') {
    if (dateTimeValue > 25569) {
      return parseExcelDateTime(dateTimeValue);
    }
  }
  
  // 2. 处理字符串格式
  if (typeof dateTimeValue === 'string') {
    const parsed = parseStringDateTime(dateTimeValue);
    if (parsed) {
      return parsed;
    }
    
    // 尝试直接解析其他格式
    const date = new Date(dateTimeValue);
    if (!isNaN(date.getTime())) {
      const localTimeStr = toLocalISOString(date);
      console.log(`直接解析: ${dateTimeValue} -> ${localTimeStr}`);
      return localTimeStr;
    }
  }
  
  console.warn(`无法解析的时间格式: ${dateTimeValue}`);
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
        
        // 验证第一条记录是否匹配预期
        if (i === 0) {
          const expected = '2025-01-01T00:01:07.000+08:00';
          if (startTime !== expected) {
            console.warn(`第一条记录时间不匹配:
              解析结果: ${startTime}
              预期时间: ${expected}`);
          } else {
            console.log('第一条记录时间解析正确!');
          }
        }
        
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            startTime, // 存储本地时间字符串，不带UTC转换
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
    
