import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 转换UTC时间到本地时区（根据你的情况，这里假设是UTC+8）
function convertToLocalTime(utcDate) {
  // 计算UTC+8偏移（8小时的毫秒数）
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(utcDate.getTime() + offsetMs);
}

// 精确解析Excel数值日期时间
function parseExcelDateTime(excelValue, targetTimezone = 'UTC+8') {
  // 分离整数部分（日期）和小数部分（时间）
  const days = Math.floor(excelValue);
  const timeFraction = excelValue - days;
  
  // Excel起始日期（1900年1月1日）
  const excelStartDate = new Date(1900, 0, 1);
  
  // 修正Excel 1900年闰年错误
  const adjustedDays = days - 2;
  
  // 计算基准日期（UTC时间）
  const baseDate = new Date(excelStartDate);
  baseDate.setDate(excelStartDate.getDate() + adjustedDays);
  baseDate.setHours(0, 0, 0, 0);
  
  // 精确计算UTC时间部分
  const totalSeconds = timeFraction * 86400; // 86400秒 = 1天
  const hours = Math.floor(totalSeconds / 3600);
  const remainingSeconds = totalSeconds % 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  const milliseconds = Math.round((remainingSeconds % 60 - seconds) * 1000);
  
  // 构建UTC日期时间
  const utcDate = new Date(baseDate);
  utcDate.setHours(hours, minutes, seconds, milliseconds);
  
  // 转换到目标时区（默认UTC+8）
  let localDate;
  if (targetTimezone === 'UTC+8') {
    localDate = convertToLocalTime(utcDate);
  } else {
    localDate = utcDate; // 其他时区可在此扩展
  }
  
  // 详细日志用于调试
  console.log(`时间解析详情:
    原始Excel值: ${excelValue}
    日期部分: ${days}天 -> ${baseDate.toISOString().split('T')[0]}
    时间比例: ${timeFraction} -> UTC ${hours}:${minutes}:${seconds}
    UTC时间: ${utcDate.toISOString()}
    本地时间(${targetTimezone}): ${localDate.toISOString()}
    本地时间(格式化): ${localDate.getFullYear()}-${(localDate.getMonth()+1).toString().padStart(2,'0')}-${localDate.getDate().toString().padStart(2,'0')} ${localDate.getHours().toString().padStart(2,'0')}:${localDate.getMinutes().toString().padStart(2,'0')}:${localDate.getSeconds().toString().padStart(2,'0')}`);
  
  return localDate.toISOString();
}

// 验证时间是否匹配预期
function validateTime(parsedTime, expectedTime) {
  if (!expectedTime) return true;
  
  const parsed = new Date(parsedTime);
  const expected = new Date(expectedTime);
  
  // 允许1分钟内的误差（考虑Excel精度问题）
  const timeDiff = Math.abs(parsed.getTime() - expected.getTime());
  return timeDiff < 60000; // 60000毫秒 = 1分钟
}

// 主解析函数
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 1. 处理Excel数值
  if (typeof dateTimeValue === 'number') {
    if (dateTimeValue > 25569) {
      // 解析为UTC+8时间（根据你的时区调整）
      return parseExcelDateTime(dateTimeValue, 'UTC+8');
    }
  }
  
  // 2. 处理标准字符串格式
  if (typeof dateTimeValue === 'string') {
    const standardPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
    const match = dateTimeValue.match(standardPattern);
    
    if (match) {
      const [, year, month, day, hours, minutes, seconds] = match;
      // 直接按本地时间（UTC+8）解析
      const date = new Date(
        `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
      );
      
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  
  console.warn(`无法解析的日期时间: ${dateTimeValue}`);
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
        
        // 对于第一条记录进行特殊验证（你的示例）
        if (i === 0) {
          const isValid = validateTime(startTime, '2025-01-01T00:01:07+08:00');
          if (!isValid) {
            console.warn(`第一条记录时间不匹配:
              解析结果: ${startTime}
              预期时间: 2025-01-01 00:01:07`);
          }
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
    
