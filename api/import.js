import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 精确解析Excel数字格式的日期时间
function parseExcelDateTime(excelValue) {
  // Excel日期是从1900年1月1日开始的天数，包含小数部分表示时间
  const days = Math.floor(excelValue);
  const fraction = excelValue - days; // 小数部分表示一天中的时间比例
  
  // 处理Excel 1900年闰年bug（Excel错误地认为1900年是闰年）
  const excelEpoch = new Date(1899, 11, 30); // 实际上应该从1899-12-30开始计算
  
  // 计算日期部分
  const date = new Date(excelEpoch);
  date.setDate(excelEpoch.getDate() + days);
  
  // 计算时间部分（小数部分转换为小时、分钟、秒）
  const totalSeconds = Math.floor(fraction * 24 * 60 * 60); // 一天的总秒数
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  // 设置时间部分
  date.setHours(hours, minutes, seconds, 0);
  
  return date;
}

// 完整的日期时间解析函数
function parseDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // 1. 处理Excel数字格式（优先处理，因为这是当前问题的核心）
  if (typeof dateTimeValue === 'number' || !isNaN(parseFloat(dateTimeValue))) {
    const excelValue = parseFloat(dateTimeValue);
    // 合理的Excel日期范围（1970-2100年之间）
    if (excelValue > 25569 && excelValue < 40000) {
      try {
        const date = parseExcelDateTime(excelValue);
        if (!isNaN(date.getTime())) {
          const isoString = date.toISOString();
          console.log(`Excel数字解析成功: ${excelValue} -> ${isoString}`);
          return isoString;
        }
      } catch (error) {
        console.error(`Excel数字解析失败: ${excelValue}`, error);
      }
    }
  }
  
  // 2. 处理标准字符串格式 "YYYY-MM-DD HH:MM:SS"
  const valueStr = typeof dateTimeValue === 'string' ? dateTimeValue.trim() : '';
  const standardPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = valueStr.match(standardPattern);
  
  if (match) {
    try {
      const [, year, month, day, hours, minutes, seconds] = match;
      const date = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1, // 月份从0开始
        parseInt(day, 10),
        parseInt(hours, 10),
        parseInt(minutes, 10),
        parseInt(seconds, 10)
      );
      
      if (!isNaN(date.getTime())) {
        const isoString = date.toISOString();
        console.log(`标准格式解析成功: ${valueStr} -> ${isoString}`);
        return isoString;
      }
    } catch (error) {
      console.error(`标准格式解析失败: ${valueStr}`, error);
    }
  }
  
  // 3. 尝试原生解析作为最后的手段
  const date = new Date(dateTimeValue);
  if (!isNaN(date.getTime())) {
    const isoString = date.toISOString();
    console.log(`原生解析成功: ${dateTimeValue} -> ${isoString}`);
    return isoString;
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
    
