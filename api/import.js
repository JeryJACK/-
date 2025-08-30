import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 调试用：跟踪时间解析过程
function logTimeProcessing(message, value) {
  console.log(`[时间处理] ${message}:`, value);
}

// 核心修复：正确解析北京时间（不做UTC转换，避免减去8小时）
function parseBeijingTime(dateValue) {
  if (!dateValue) {
    logTimeProcessing('空时间值', dateValue);
    return null;
  }
  
  // 处理Excel数字日期格式（关键修复：正确提取时间部分）
  if (typeof dateValue === 'number') {
    logTimeProcessing('Excel数字格式原始值', dateValue);
    
    // Excel日期是自1900年1月1日以来的天数（小数部分为时间）
    const baseDate = new Date(1900, 0, 1);
    // 修正Excel的1900年闰年错误（Excel错误地认为1900是闰年）
    const days = dateValue - 2;
    const totalMilliseconds = days * 24 * 60 * 60 * 1000;
    
    // 创建日期对象（直接作为本地时间，即北京时间）
    const date = new Date(baseDate.getTime() + totalMilliseconds);
    
    if (!isNaN(date.getTime())) {
      logTimeProcessing('Excel数字解析结果（北京时间）', date.toLocaleString('zh-CN'));
      return date;
    }
  }
  
  // 处理字符串格式时间
  if (typeof dateValue === 'string') {
    logTimeProcessing('字符串格式原始值', dateValue);
    
    // 尝试直接解析为北京时间（不做时区转换）
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      logTimeProcessing('字符串直接解析结果（北京时间）', date.toLocaleString('zh-CN'));
      return date;
    }
    
    // 增强的中文日期格式处理
    const patterns = [
      { regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/, parts: 7 },
      { regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})$/, parts: 6 },
      { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/, parts: 7 },
      { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2})$/, parts: 6 },
      { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{1,2})$/, parts: 6 }
    ];
    
    for (const pattern of patterns) {
      const match = dateValue.match(pattern.regex);
      if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1; // 月份从0开始
        const day = parseInt(match[3], 10);
        const hours = pattern.parts >= 6 ? parseInt(match[4], 10) : 0;
        const minutes = pattern.parts >= 6 ? parseInt(match[5], 10) : 0;
        const seconds = pattern.parts === 7 ? parseInt(match[6], 10) : 0;
        
        // 验证时间范围
        if (hours < 0 || hours > 23) continue;
        if (minutes < 0 || minutes > 59) continue;
        if (seconds < 0 || seconds > 59) continue;
        
        const date = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(date.getTime())) {
          logTimeProcessing('格式匹配解析结果（北京时间）', date.toLocaleString('zh-CN'));
          return date;
        }
      }
    }
  }
  
  console.warn(`无法解析的时间格式: ${dateValue} (类型: ${typeof dateValue})`);
  return null;
}

// 格式化时间为数据库存储格式（关键修复：直接使用北京时间，不转UTC）
function formatTimeForDB(date) {
  if (!date) return null;
  
  // 直接获取北京时间的各个部分（不做时区转换）
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  // 明确指定为北京时间时区（+08:00）
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+08`;
}

export default async function handler(req, res) {
  try {
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
    
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      let timeValue;
      
      try {
        if (typeof record !== 'object' || record === null) {
          throw new Error('记录必须是有效的对象');
        }
        
        // 获取时间值
        timeValue = record['开始时间'] || record.start_time || record['StartTime'];
        
        const beijingTime = parseBeijingTime(timeValue);
        if (!beijingTime) {
          throw new Error(`时间解析失败: ${timeValue || '未提供时间'}`);
        }
        
        const dbTime = formatTimeForDB(beijingTime);
        if (!dbTime) {
          throw new Error('时间格式化为数据库格式失败');
        }
        
        // 执行插入（确保字段与表结构一致）
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw)
           VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            dbTime,  // 直接存储北京时间（带+08时区）
            record['所属客户'] || record.customer || null,
            record['卫星名称'] || record.satellite || null,
            record['测站名称'] || record.station || null,
            record['任务结果状态'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            JSON.stringify(record)
          ]
        );
        
        inserted++;
      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          originalTime: timeValue !== undefined ? String(timeValue) : '无时间值'
        });
        console.error(`处理第${i+1}条记录失败:`, error);
      }
    }
    
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      inserted,
      total: records.length,
      errors,
      message: `成功导入${inserted}/${records.length}条记录`
    });
  } catch (error) {
    // 事务回滚并返回详细错误信息
    if (pool) await pool.query('ROLLBACK');
    console.error('导入接口错误:', error);
    // 关键修复：返回具体错误信息，帮助前端调试
    res.status(500).json({ 
      error: '服务器处理失败',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
    
