import { Pool } from 'pg';
import { verifyAuth } from '../lib/auth';

let pool;
try {
  if (!global._pgPool) {
    // 增加数据库连接调试信息
    console.log('创建新的数据库连接池');
    pool = new Pool({ 
      connectionString: process.env.POSTGRES_URL,
      ssl: {
        rejectUnauthorized: false // 解决可能的SSL问题
      }
    });
    global._pgPool = pool;
    
    // 测试数据库连接
    pool.query('SELECT NOW()', (err, res) => {
      if (err) {
        console.error('数据库连接测试失败:', err);
      } else {
        console.log('数据库连接成功');
      }
    });
  } else {
    pool = global._pgPool;
  }
} catch (dbError) {
  console.error('数据库初始化错误:', dbError);
}

// 处理日期格式转换
function parseDate(dateString) {
  if (!dateString) return null;
  
  // 尝试多种日期格式
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export default async function handler(req, res) {
  try {
    console.log('收到导入请求:', { 
      method: req.method,
      bodyLength: req.body ? JSON.stringify(req.body).length : 0
    });

    // 只允许POST方法
    if (req.method !== 'POST') {
      console.log('拒绝非POST请求');
      return res.status(405).json({ error: '方法不允许，仅支持POST' });
    }

    // 验证身份
    const auth = await verifyAuth(req);
    if (!auth.success) {
      console.log('身份验证失败:', auth.error);
      return res.status(401).json({ error: auth.error });
    }

    const { records } = req.body;
    
    if (!records || !Array.isArray(records) || records.length === 0) {
      console.log('无效的记录数据:', records);
      return res.status(400).json({ error: '没有提供有效的数据记录' });
    }

    console.log(`开始导入 ${records.length} 条记录`);

    // 开始数据库事务
    await pool.query('BEGIN');
    
    let inserted = 0;
    const errors = [];
    
    // 循环插入每条记录
    for (const [index, record] of records.entries()) {
      try {
        // 转换Excel中的字段名到数据库字段名
        const dbRecord = {
          plan_id: record['计划ID'] || record.plan_id || null,
          start_time: parseDate(record['开始时间'] || record.start_time),
          customer: record['客户'] || record.customer || null,
          satellite: record['卫星'] || record.satellite || null,
          station: record['测站'] || record.station || null,
          task_result: record['任务结果'] || record.task_result || null,
          task_type: record['任务类型'] || record.task_type || null,
          raw: record // 保存原始数据
        };
        
        // 执行插入
        await pool.query(
          `INSERT INTO raw_records 
           (plan_id, start_time, customer, satellite, station, 
            task_result, task_type, raw, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
        if (index % 10 === 0) { // 每10条记录输出一次进度
          console.log(`已处理 ${index + 1}/${records.length} 条记录`);
        }
      } catch (error) {
        const errorMsg = `第${index + 1}条记录错误: ${error.message}`;
        console.error(errorMsg);
        errors.push({
          index,
          error: error.message,
          record: JSON.stringify(record).substring(0, 100) // 只保存部分记录用于调试
        });
      }
    }
    
    // 提交事务
    await pool.query('COMMIT');
    console.log(`导入完成: 成功 ${inserted} 条, 失败 ${errors.length} 条`);
    
    res.json({
      success: true,
      inserted,
      total: records.length,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    // 出错时回滚事务
    if (pool) {
      try {
        await pool.query('ROLLBACK');
        console.log('事务已回滚');
      } catch (rollbackError) {
        console.error('回滚事务失败:', rollbackError);
      }
    }
    
    console.error('导入数据错误:', error.stack || error); // 输出完整错误堆栈
    res.status(500).json({ 
      error: '服务器错误，导入失败',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
