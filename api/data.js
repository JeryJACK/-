const { Pool } = require('@vercel/postgres');
const auth = require('./auth');

const pool = new Pool();

module.exports = async (req, res) => {
  // 应用身份验证中间件
  await new Promise((resolve, reject) => {
    auth(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      resolve(result);
    });
  });

  try {
    // 获取数据
    if (req.method === 'GET') {
      const { rows } = await pool.query('SELECT * FROM satellite_data ORDER BY start_time DESC');
      return res.status(200).json(rows);
    }

    // 添加数据
    if (req.method === 'POST') {
      const { customer_name, satellite_name, station_name, plan_id, task_type, task_status, start_time } = req.body;
      
      const { rows } = await pool.query(
        `INSERT INTO satellite_data 
         (customer_name, satellite_name, station_name, plan_id, task_type, task_status, start_time) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         ON CONFLICT (plan_id) DO UPDATE SET
           customer_name = EXCLUDED.customer_name,
           satellite_name = EXCLUDED.satellite_name,
           station_name = EXCLUDED.station_name,
           task_type = EXCLUDED.task_type,
           task_status = EXCLUDED.task_status,
           start_time = EXCLUDED.start_time
         RETURNING *`,
        [customer_name, satellite_name, station_name, plan_id, task_type, task_status, start_time]
      );
      
      return res.status(201).json(rows[0]);
    }

    // 更新数据
    if (req.method === 'PUT') {
      const { plan_id, ...data } = req.body;
      const fields = Object.keys(data).map((key, i) => `${key} = $${i + 2}`).join(', ');
      
      const { rows } = await pool.query(
        `UPDATE satellite_data SET ${fields} WHERE plan_id = $1 RETURNING *`,
        [plan_id, ...Object.values(data)]
      );
      
      return res.status(200).json(rows[0]);
    }

    // 删除数据
    if (req.method === 'DELETE') {
      const { plan_id } = req.query;
      await pool.query('DELETE FROM satellite_data WHERE plan_id = $1', [plan_id]);
      return res.status(200).json({ message: '数据已删除' });
    }

    res.status(405).json({ message: '方法不允许' });
  } catch (error) {
    console.error('数据操作错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
};
    