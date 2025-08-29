import { Pool } from 'pg';
import { verifyAuth } from '../../lib/auth';

let pool;
if (!global._pgPool) {
  pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    max: 20, // 增加连接池大小
    idleTimeoutMillis: 30000
  });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

// 处理大量数据插入的函数
async function bulkInsertRecords(records) {
  if (!records || records.length === 0) {
    return 0;
  }

  // 使用事务确保数据一致性
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 准备插入语句和参数
    const columns = ['plan_id', 'start_time', 'customer', 'satellite', 'station', 'task_result', 'raw'];
    const placeholders = records.map((_, i) => 
      `($${i * columns.length + 1}, $${i * columns.length + 2}, $${i * columns.length + 3}, 
        $${i * columns.length + 4}, $${i * columns.length + 5}, $${i * columns.length + 6}, 
        $${i * columns.length + 7})`
    ).join(',');
    
    const values = [];
    records.forEach(record => {
      // 转换Excel中的日期格式（如果需要）
      const startTime = record.start_time ? new Date(record.start_time) : null;
      
      values.push(
        record.plan_id || null,
        startTime ? startTime.toISOString() : null,
        record.customer || null,
        record.satellite || null,
        record.station || null,
        record.task_result || null,
        record.raw ? JSON.stringify(record) : JSON.stringify(record)
      );
    });
    
    const query = `
      INSERT INTO raw_records (${columns.join(', ')})
      VALUES ${placeholders}
    `;
    
    const result = await client.query(query, values);
    await client.query('COMMIT');
    
    return result.rowCount;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  // 增加超时时间（120秒）
  req.socket.setTimeout(120000);
  
  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { records } = req.body;

  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: '无效的记录数据' });
  }

  try {
    // 批量插入记录
    const insertedCount = await bulkInsertRecords(records);
    
    res.json({
      success: true,
      inserted: insertedCount,
      total: records.length
    });
  } catch (error) {
    console.error('导入错误:', error);
    res.status(500).json({ error: '导入失败: ' + error.message });
  }
}
