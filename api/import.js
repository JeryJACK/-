const { Pool } = require('@vercel/postgres');
const auth = require('./auth');
const csv = require('csv-parser');
const { Readable } = require('stream');

const pool = new Pool();

// 解析CSV数据
function parseCSV(text) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(text);
    
    stream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

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
    if (req.method !== 'POST') {
      return res.status(405).json({ message: '只允许POST方法' });
    }

    const { fileContent } = req.body;
    
    if (!fileContent) {
      return res.status(400).json({ message: '请提供文件内容' });
    }

    // 解析CSV数据
    const data = await parseCSV(fileContent);
    
    if (data.length === 0) {
      return res.status(400).json({ message: '未解析到有效数据' });
    }

    // 批量插入数据库
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 准备插入语句 - 包含新的字段映射
      const insertQuery = `
        INSERT INTO satellite_data 
        (customer_name, satellite_name, station_name, plan_id, task_type, task_status, start_time) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (plan_id) DO UPDATE SET
          customer_name = EXCLUDED.customer_name,
          satellite_name = EXCLUDED.satellite_name,
          station_name = EXCLUDED.station_name,
          task_type = EXCLUDED.task_type,
          task_status = EXCLUDED.task_status,
          start_time = EXCLUDED.start_time
      `;
      
      // 逐条插入
      for (const item of data) {
        // 字段映射：CSV列名 -> 数据库字段名
        // 注意：这里假设CSV中的列名与中文描述一致
        await client.query(insertQuery, [
          item['所属客户'] || '',                  // 所属客户 -> customer_name
          item['卫星名称'] || '',                  // 卫星名称 -> satellite_name
          item['测站名称'] || '',                  // 测站名称 -> station_name
          item['计划ID'] || '',                    // 计划ID -> plan_id (唯一主键)
          item['任务类型'] || '',                  // 任务类型 -> task_type
          item['任务结果状态'] || '',              // 任务结果状态 -> task_status
          item['开始时间'] ? new Date(item['开始时间']) : new Date()  // 开始时间 -> start_time
        ]);
      }
      
      await client.query('COMMIT');
      return res.status(200).json({ message: `成功导入 ${data.length} 条数据` });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('导入数据错误:', error);
    res.status(500).json({ message: '导入数据失败', error: error.message });
  }
};