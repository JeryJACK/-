import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 修复的日期解析函数，支持Excel日期格式
function parseDate(dateValue) {
  if (!dateValue) return null;
  
  // 情况1: 如果是数字，可能是Excel日期格式（从1900年1月1日开始的天数）
  if (typeof dateValue === 'number') {
    // Excel从1900年1月1日开始计算，而JavaScript从1970年开始
    // 注意：Excel有一个已知的bug，认为1900年是闰年
    const excelEpoch = new Date(1900, 0, 1);
    // 减去2天：1天是因为Excel错误地包含1900年2月29日，另1天是因为索引差异
    const daysToAdd = dateValue - 2;
    const date = new Date(excelEpoch);
    date.setDate(excelEpoch.getDate() + daysToAdd);
    
    // 检查日期是否合理（1970年之后）
    if (date.getTime() > 0) {
      return date.toISOString();
    }
  }
  
  // 情况2: 处理字符串格式的日期
  if (typeof dateValue === 'string') {
    // 尝试直接解析
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    
    // 尝试常见的中文日期格式
    const chineseFormats = [
      /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
      /^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{1,2}):(\d{1,2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2})$/,
    ];
    
    for (const format of chineseFormats) {
      const match = dateValue.match(format);
      if (match) {
        let year, month, day, hours = 0, minutes = 0, seconds = 0;
        
        // 根据不同的匹配结果解析
        if (match.length === 7) {
          [, year, month, day, hours, minutes, seconds] = match;
        } else if (match.length === 4) {
          [, year, month, day] = match;
        } else if (match.length === 6) {
          [, month, day, year, hours, minutes] = match;
        } else if (match.length === 5) {
          [, year, month, day, hours, minutes] = match;
        }
        
        // 处理月份和日期可能的单数字情况
        month = parseInt(month, 10) - 1; // JavaScript月份从0开始
        day = parseInt(day, 10);
        year = parseInt(year, 10);
        
        // 处理可能的两位数年份（如25代表2025）
        if (year < 100) {
          year += 2000;
        }
        
        const date = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }
  }
  
  console.warn(`无法解析日期格式: ${dateValue} (类型: ${typeof dateValue})`);
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
        // 尝试多种可能的字段名（中文和英文）
        const startTimeValue = record['开始时间'] || record.start_time || record['StartTime'];
        const startTime = parseDate(startTimeValue);
        
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
    
