const { Pool } = require('pg');
const { verifyAuth } = require('../../lib/auth');

let pool;
if (!global._pgPool) {
  pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  global._pgPool = pool;
} else {
  pool = global._pgPool;
}

module.exports = async function handler(req, res) {
  // 验证身份
  const auth = await verifyAuth(req);
  if (!auth.success) {
    return res.status(401).json({ error: auth.error });
  }

  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      // 获取单条记录
      const result = await pool.query('SELECT * FROM raw_records WHERE id = $1', [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '记录不存在' });
      }
      
      res.json(result.rows[0]);
    } 
    else if (req.method === 'PUT') {
      // 更新记录
      const { plan_id, start_time, customer, satellite, station, task_result } = req.body;
      
      const result = await pool.query(
        `UPDATE raw_records 
         SET plan_id = $1, start_time = $2, customer = $3, satellite = $4, 
             station = $5, task_result = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7 RETURNING *`,
        [plan_id, start_time, customer, satellite, station, task_result, id]
      );
      
      res.json({ success: true, record: result.rows[0] });
    } 
    else if (req.method === 'DELETE') {
      // 删除记录
      await pool.query('DELETE FROM raw_records WHERE id = $1', [id]);
      res.json({ success: true });
    } 
    else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (error) {
    console.error('记录操作错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
};
    
