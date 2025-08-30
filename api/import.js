const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');
const { parseBeijingTime, formatBeijingTimeForDB } = require('../lib/time-utils');

// 确保数据库连接正确
let pool;
try {
  pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    // 增加连接超时设置
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  });
  
  // 测试数据库连接
  pool.query('SELECT NOW()', (err) => {
    if (err) {
      console.error('数据库连接测试失败:', err.message);
    } else {
      console.log('数据库连接成功');
    }
  });
  
  global._pgPool = pool;
} catch (error) {
  console.error('创建数据库连接池失败:', error.message);
  // 全局保存错误，供后续请求使用
  global._pgError = error;
}

module.exports = async (req, res) => {
  // 记录请求开始时间，用于性能分析
  const startTime = Date.now();
  
  try {
    console.log(`[${new Date().toISOString()}] 收到文件导入请求`);
    
    // 检查请求方法
    if (req.method !== 'POST') {
      const error = '方法不允许，仅支持POST';
      console.log(`[错误] ${error}`);
      return res.status(405).json({ error });
    }
    
    // 检查数据库连接是否有初始化错误
    if (global._pgError) {
      const error = '数据库连接初始化失败';
      console.error(`[错误] ${error}:`, global._pgError.message);
      return res.status(500).json({ 
        error,
        details: process.env.NODE_ENV === 'development' ? global._pgError.message : undefined
      });
    }
    
    // 检查数据库连接池
    if (!pool) {
      const error = '数据库连接池未初始化';
      console.error(`[错误] ${error}`);
      return res.status(500).json({ error });
    }
    
    // 验证身份
    try {
      const auth = await verifyAuth(req);
      if (!auth.success) {
        console.log(`[错误] 认证失败: ${auth.error}`);
        return res.status(401).json({ error: auth.error });
      }
    } catch (authError) {
      const error = '认证过程发生错误';
      console.error(`[错误] ${error}:`, authError.message);
      return res.status(500).json({ 
        error,
        details: process.env.NODE_ENV === 'development' ? authError.message : undefined
      });
    }
    
    // 验证请求数据
    if (!req.body || !req.body.records || !Array.isArray(req.body.records)) {
      const error = '请求数据格式不正确，需要包含records数组';
      console.log(`[错误] ${error}:`, JSON.stringify(req.body));
      return res.status(400).json({ error });
    }
    
    const { records } = req.body;
    
    if (records.length === 0) {
      const error = 'records数组为空，没有可导入的数据';
      console.log(`[错误] ${error}`);
      return res.status(400).json({ error });
    }
    
    console.log(`开始导入 ${records.length} 条记录`);
    
    // 数据库事务处理
    let client;
    try {
      // 获取专用客户端，确保事务安全
      client = await pool.connect();
      await client.query('BEGIN');
      
      let inserted = 0;
      const errors = [];
      
      for (let i = 0; i < records.length; i++) {
        try {
          const record = records[i];
          
          // 基本验证记录格式
          if (typeof record !== 'object' || record === null) {
            throw new Error('记录必须是有效的对象');
          }
          
          // 获取时间字段值
          const timeValue = record['开始时间'] || record.start_time || record.StartTime;
          
          // 解析时间
          const beijingDate = parseBeijingTime(timeValue);
          if (!beijingDate) {
            throw new Error(`时间解析失败: ${timeValue || '未提供时间'}`);
          }
          
          // 格式化时间
          const dbTime = formatBeijingTimeForDB(beijingDate);
          if (!dbTime) {
            throw new Error('时间格式化为数据库格式失败');
          }
          
          // 执行插入
          await client.query(
            `INSERT INTO raw_records 
             (plan_id, start_time, customer, satellite, station, 
              task_result, task_type, raw)
             VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)`,
            [
              record['计划ID'] || record.plan_id || null,
              dbTime,
              record['客户'] || record.customer || null,
              record['卫星'] || record.satellite || null,
              record['测站'] || record.station || null,
              record['任务结果'] || record.task_result || null,
              record['任务类型'] || record.task_type || null,
              JSON.stringify(record)
            ]
          );
          
          inserted++;
          
          // 每10条记录输出一次进度
          if ((i + 1) % 10 === 0) {
            console.log(`已处理 ${i + 1}/${records.length} 条记录`);
          }
        } catch (error) {
          errors.push({
            index: i,
            error: error.message,
            record: JSON.stringify(records[i])
          });
          console.error(`处理第${i+1}条记录失败:`, error.message);
        }
      }
      
      // 提交事务
      await client.query('COMMIT');
      console.log(`导入完成: 成功 ${inserted} 条, 失败 ${errors.length} 条`);
      
      // 计算处理时间
      const processingTime = Date.now() - startTime;
      console.log(`请求处理完成，耗时 ${processingTime}ms`);
      
      res.json({
        success: true,
        inserted,
        total: records.length,
        errors,
        processingTime,
        message: `成功导入${inserted}/${records.length}条记录`
      });
    } catch (transactionError) {
      // 回滚事务
      if (client) {
        try {
          await client.query('ROLLBACK');
          console.log('事务已回滚');
        } catch (rollbackError) {
          console.error('回滚事务失败:', rollbackError.message);
        }
      }
      
      const error = '数据库事务处理失败';
      console.error(`[错误] ${error}:`, transactionError.message);
      res.status(500).json({ 
        error,
        details: process.env.NODE_ENV === 'development' ? transactionError.message : undefined,
        stack: process.env.NODE_ENV === 'development' ? transactionError.stack : undefined
      });
    } finally {
      // 释放客户端
      if (client) {
        client.release();
      }
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[错误] 请求处理失败 (耗时 ${processingTime}ms):`, error.message);
    res.status(500).json({ 
      error: '服务器处理文件时发生错误',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      processingTime
    });
  }
};
    
