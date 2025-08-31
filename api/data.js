const { query } = require('./index');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// 验证用户身份中间件
async function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: '未授权访问' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: '令牌无效' });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 获取所有数据（公开接口）
  if (req.method === 'GET' && req.url === '/') {
    try {
      const { rows } = await query('SELECT * FROM satellite_data ORDER BY start_time DESC LIMIT 1000');
      return res.json(rows);
    } catch (error) {
      console.error('获取数据错误:', error);
      return res.status(500).json({ message: '获取数据失败' });
    }
  }

  // 需要身份验证的接口
  try {
    await new Promise((resolve, reject) => {
      authenticateToken(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (error) {
    return res.status(401).json({ message: '未授权访问' });
  }

  // 分片上传数据
  if (req.method === 'POST' && req.url.includes('/upload-chunk')) {
    try {
      const { chunkId, totalChunks, data } = JSON.parse(req.body);
      
      // 保存分片
      const result = await query(
        'INSERT INTO data_chunks (chunk_id, total_chunks, data) VALUES ($1, $2, $3) RETURNING id',
        [chunkId, totalChunks, data]
      );
      
      const chunkIdDb = result.rows[0].id;
      
      // 检查是否所有分片都已上传
      const allChunks = await query(
        'SELECT * FROM data_chunks WHERE total_chunks = $1',
        [totalChunks]
      );
      
      // 如果所有分片都已上传，则合并数据
      if (allChunks.rows.length === totalChunks) {
        // 按chunk_id排序并合并
        const sortedChunks = allChunks.rows.sort((a, b) => a.chunk_id - b.chunk_id);
        const mergedData = sortedChunks.flatMap(chunk => chunk.data);
        
        // 批量插入合并后的数据
        if (mergedData.length > 0) {
          const values = mergedData.map((item, index) => 
            `($${index * 7 + 1}, $${index * 7 + 2}, $${index * 7 + 3}, $${index * 7 + 4}, $${index * 7 + 5}, $${index * 7 + 6}, $${index * 7 + 7})`
          ).join(',');
          
          const params = [];
          mergedData.forEach(item => {
            params.push(
              item.planId || '',
              new Date(item.startTime),
              item.customerName || '',
              item.satelliteName || '',
              item.stationName || '',
              item.taskStatus || '',
              item.taskType || '',
              chunkIdDb
            );
          });
          
          await query(
            `INSERT INTO satellite_data 
             (plan_id, start_time, customer_name, satellite_name, station_name, task_status, task_type, chunk_source) 
             VALUES ${values}`,
            params
          );
          
          // 删除临时分片数据
          await query('DELETE FROM data_chunks WHERE total_chunks = $1', [totalChunks]);
        }
        
        return res.json({ 
          message: '所有分片已上传并合并', 
          total: mergedData.length 
        });
      }
      
      return res.json({ 
        message: '分片上传成功', 
        chunkId, 
        progress: Math.round((allChunks.rows.length / totalChunks) * 100) 
      });
    } catch (error) {
      console.error('上传分片错误:', error);
      return res.status(500).json({ message: '上传分片失败' });
    }
  }

  // 添加单条数据
  if (req.method === 'POST' && req.url === '/') {
    try {
      const data = JSON.parse(req.body);
      
      const result = await query(
        `INSERT INTO satellite_data 
         (plan_id, start_time, customer_name, satellite_name, station_name, task_status, task_type) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          data.planId,
          new Date(data.startTime),
          data.customerName,
          data.satelliteName,
          data.stationName,
          data.taskStatus,
          data.taskType
        ]
      );
      
      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('添加数据错误:', error);
      return res.status(500).json({ message: '添加数据失败' });
    }
  }

  // 更新数据
  if (req.method === 'PUT' && req.url.match(/^\/(\d+)$/)) {
    try {
      const id = parseInt(req.url.match(/^\/(\d+)$/)[1]);
      const data = JSON.parse(req.body);
      
      const result = await query(
        `UPDATE satellite_data SET 
         plan_id = $1, start_time = $2, customer_name = $3, 
         satellite_name = $4, station_name = $5, task_status = $6, task_type = $7 
         WHERE id = $8 RETURNING *`,
        [
          data.planId,
          new Date(data.startTime),
          data.customerName,
          data.satelliteName,
          data.stationName,
          data.taskStatus,
          data.taskType,
          id
        ]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ message: '数据不存在' });
      }
      
      return res.json(result.rows[0]);
    } catch (error) {
      console.error('更新数据错误:', error);
      return res.status(500).json({ message: '更新数据失败' });
    }
  }

  // 删除数据
  if (req.method === 'DELETE' && req.url.match(/^\/(\d+)$/)) {
    try {
      const id = parseInt(req.url.match(/^\/(\d+)$/)[1]);
      
      const result = await query(
        'DELETE FROM satellite_data WHERE id = $1 RETURNING *',
        [id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ message: '数据不存在' });
      }
      
      return res.json({ message: '数据已删除' });
    } catch (error) {
      console.error('删除数据错误:', error);
      return res.status(500).json({ message: '删除数据失败' });
    }
  }

  // 高级查询
  if (req.method === 'GET' && req.url.includes('/query')) {
    try {
      const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
      const startDate = urlParams.get('startDate');
      const endDate = urlParams.get('endDate');
      const customer = urlParams.get('customer');
      const status = urlParams.get('status');
      
      let queryStr = 'SELECT * FROM satellite_data WHERE 1=1';
      const params = [];
      let paramIndex = 1;
      
      if (startDate) {
        queryStr += ` AND start_time >= $${paramIndex++}`;
        params.push(new Date(startDate));
      }
      
      if (endDate) {
        queryStr += ` AND start_time <= $${paramIndex++}`;
        params.push(new Date(endDate));
      }
      
      if (customer) {
        queryStr += ` AND customer_name = $${paramIndex++}`;
        params.push(customer);
      }
      
      if (status) {
        queryStr += ` AND task_status = $${paramIndex++}`;
        params.push(status);
      }
      
      queryStr += ' ORDER BY start_time DESC LIMIT 1000';
      
      const { rows } = await query(queryStr, params);
      return res.json(rows);
    } catch (error) {
      console.error('查询数据错误:', error);
      return res.status(500).json({ message: '查询数据失败' });
    }
  }

  return res.status(404).json({ message: '接口不存在' });
};