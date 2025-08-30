<const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');
const { parseBeijingTime, formatBeijingTimeForDB } = require('../lib/time-utils');

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

module.exports = async (req, res) => {
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
    
    // 开始数据库事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    for (let i = 0; i < records.length; i++) {
      try {
        const record = records[i];
        
        // 获取时间字段值（支持多种可能的字段名）
        const timeValue = record['开始时间'] || record.start_time || record.StartTime;
        
        // 关键修复1：使用专门的工具解析为北京时间
        const beijingDate = parseBeijingTime(timeValue);
        if (!beijingDate) {
          throw new Error(`时间解析失败: ${timeValue || '未提供时间'}`);
        }
        
        // 关键修复2：格式化为带北京时区的字符串，不转换为UTC
        const dbTime = formatBeijingTimeForDB(beijingDate);
        if (!dbTime) {
          throw new Error('时间格式化为数据库格式失败');
        }
        
        // 插入数据库（使用带时区的时间字符串）
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw)
           VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)`,
          [
            record['计划ID'] || record.plan_id || null,
            dbTime,  // 直接存储北京时间（带+08时区）
            record['客户'] || record.customer || null,
            record['卫星'] || record.satellite || null,
            record['测站'] || record.station || null,
            record['任务结果'] || record.task_result || null,
            record['任务类型'] || record.task_type || null,
            JSON.stringify(record)
          ]
        );
        
        inserted++;
      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          originalValue: records[i] ? JSON.stringify(records[i]) : '无效记录'
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
    // 发生错误时回滚事务
    if (pool) await pool.query('ROLLBACK');
    console.error('导入接口错误:', error);
    res.status(500).json({ 
      error: '服务器处理失败',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
    
