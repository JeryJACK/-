const { Pool } = require('pg');

module.exports = async function handler(req, res) {
  try {
    console.log('测试数据库连接...');
    
    if (!process.env.POSTGRES_URL) {
      return res.status(500).json({ 
        error: 'POSTGRES_URL未配置' 
      });
    }
    
    const pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // 测试查询
    const result = await pool.query('SELECT NOW() as current_time');
    await pool.end();
    
    res.json({
      success: true,
      time: result.rows[0].current_time,
      message: '数据库连接成功'
    });
  } catch (error) {
    res.status(500).json({
      error: '数据库连接失败',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
