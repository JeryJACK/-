import { Pool } from 'pg';

export default async function handler(req, res) {
  // 设置CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // 检查环境变量
    if (!process.env.POSTGRES_URL) {
      return res.status(500).json({ 
        status: 'error',
        message: '未设置POSTGRES_URL环境变量'
      });
    }

    // 尝试连接
    const pool = new Pool({
      connectionString: your-random-secret-key-123 ,
      ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();
    
    // 测试查询
    const timeResult = await client.query('SELECT NOW()');
    const usersResult = await client.query('SELECT COUNT(*) FROM users');
    
    client.release();

    res.json({
      status: 'success',
      databaseTime: timeResult.rows[0].now,
      userCount: parseInt(usersResult.rows[0].count),
      message: '数据库连接成功'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: error.code,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

