const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');

// 数据库连接
let pool;
try {
  if (!global._pgPool) {
    console.log('初始化数据库连接...');
    // 检查环境变量
    if (!process.env.POSTGRES_URL) {
      console.error('POSTGRES_URL环境变量未设置!');
    }
    
    pool = new Pool({ 
      connectionString: process.env.POSTGRES_URL,
      ssl: {
        rejectUnauthorized: false // 关键：解决Vercel Postgres的SSL问题
      }
    });
    global._pgPool = pool;
    
    // 测试连接
    const testRes = await pool.query('SELECT 1');
    console.log('数据库连接成功:', testRes.rows);
  } else {
    pool = global._pgPool;
  }
} catch (dbError) {
  console.error('数据库连接初始化失败:', dbError.message, dbError.stack);
}

// 日期处理
function parseDate(dateString) {
  if (!dateString) return null;
  
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

module.exports = async function handler(req, res) {
  try {
    console.log('收到导入请求');
    
    if (req.method !== 'POST') {
      return res.status(405).json({ 
        error: '仅支持POST方法',
        details: `收到不支持的方法: ${req.method}`
      });
    }

    // 验证身份
    const auth = await verifyAuth(req);
    if (!auth.success) {
      return res.status(401).json({ 
        error: '认证失败',
        details: auth.error
      });
    }

    const { records } = req.body;
    
    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ 
        error: '无效的数据',
        details: '未提供有效的记录数组'
      });
    }

    // 检查数据库连接是否有效
    if (!pool) {
      throw new Error('数据库连接未初始化');
    }

    // 开始事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    for (const [index, record] of records.entries()) {
      try {
        const dbRecord = {
          plan_id: record['计划ID'] || record.plan_id || null,
          start_time: parseDate(record['开始时间'] || record.start_time),
          customer: record['客户'] || record.customer || null,
          satellite: record['卫星'] || record.satellite || null,
          station: record['测站'] || record.station || null,
          task_result: record['任务结果'] || record.task_result || null,
          task_type: record['任务类型'] || record.task_type || null,
          raw: record
        };
        
        // 执行插入 - 增加详细日志
        console.log(`插入第${index+1}条记录:`, dbRecord.plan_id);
        const result = await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id`,
          [
            dbRecord.plan_id,
            dbRecord.start_time,
            dbRecord.customer,
            dbRecord.satellite,
            dbRecord.station,
            dbRecord.task_result,
            dbRecord.task_type,
            JSON.stringify(dbRecord.raw)
          ]
        );
        
        inserted++;
        console.log(`插入成功，ID: ${result.rows[0].id}`);
      } catch (error) {
        const errMsg = `第${index+1}条记录错误: ${error.message}`;
        console.error(errMsg);
        errors.push({ index, error: error.message });
      }
    }
    
    await pool.query('COMMIT');
    console.log(`导入完成: 成功${inserted}条, 失败${errors.length}条`);
    
    res.json({
      success: true,
      inserted,
      total: records.length,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    // 回滚事务
    if (pool) {
      try {
        await pool.query('ROLLBACK');
        console.log('事务已回滚');
      } catch (rollbackErr) {
        console.error('回滚失败:', rollbackErr);
      }
    }
    
    // 关键：返回详细错误信息
    const errorDetails = process.env.NODE_ENV === 'development' 
      ? { message: error.message, stack: error.stack }
      : { message: error.message };
      
    console.error('导入失败:', errorDetails);
    
    res.status(500).json({ 
      error: '服务器错误，导入失败',
      details: errorDetails // 这里会返回详细错误
    });
  }
};
