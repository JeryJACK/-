import { Pool } from 'pg';
import { verifyAuth } from '../../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 转换Excel日期数字为JavaScript日期
function excelDateToJSDate(excelDate) {
  // Excel从1900年1月1日开始计算，但是存在一个历史错误，认为1900年是闰年
  const baseDate = new Date(1900, 0, 1);
  // 减去2天：1天是因为Excel的起始日期实际上是1899-12-30，另1天是因为闰年错误
  const daysToAdd = excelDate - 2;
  baseDate.setDate(baseDate.getDate() + daysToAdd);
  return baseDate;
}

// 尝试将值转换为有效的日期
function parseDate(value) {
  if (!value) return null;
  
  // 如果是数字，尝试作为Excel日期处理
  if (!isNaN(value)) {
    const date = excelDateToJSDate(Number(value));
    // 检查是否是有效的日期（不早于1970年）
    if (date.getTime() > 0) {
      return date.toISOString();
    }
  }
  
  // 如果是字符串，尝试直接解析
  if (typeof value === 'string') {
    // 尝试几种常见的日期格式
    const dateFormats = [
      new Date(value),
      new Date(value.replace(/-/g, '/')),
      new Date(value.replace(/\./g, '/'))
    ];
    
    for (const date of dateFormats) {
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  const { records } = req.body;
  
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: '无效的记录数据' });
  }

  try {
    // 开始事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    for (const [index, record] of records.entries()) {
      try {
        // 处理日期字段，假设Excel中的日期字段可能名为start_time, date, 或时间等
        const dateFields = ['start_time', 'date', 'time', '开始时间', '日期'];
        let startTime = null;
        
        // 尝试找到日期字段并转换
        for (const field of dateFields) {
          if (record[field] !== undefined) {
            startTime = parseDate(record[field]);
            if (startTime) break;
          }
        }
        
        // 插入记录
        const result = await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, task_result, task_type, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
           record.plan_id || record.计划ID || null,
          startTime || record.开始时间 || null,
          record.customer || record.所属客户 || null,
          record.satellite || record.卫星名称 || null,
          record.station || record.测站名称 || null,
          record.task_result || record.任务结果状态 || null,
          record.task_type || record.任务类型 || null,
          record // 保存原始数据
          ]
        );
        
        if (result.rows.length > 0) {
          inserted++;
        }
      } catch (error) {
        errors.push({
          row: index + 1, // 行号从1开始
          error: error.message,
          data: record
        });
        console.error(`处理第${index + 1}行时出错:`, error);
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      inserted,
      total: records.length,
      errors,
      message: errors.length > 0 
        ? `部分导入成功，共导入 ${inserted} 条，${errors.length} 条失败`
        : `全部导入成功，共导入 ${inserted} 条`
    });
  } catch (error) {
    // 回滚事务
    await pool.query('ROLLBACK');
    console.error('导入数据错误:', error);
    res.status(500).json({ error: '导入失败: ' + error.message });
  }
}
