const { Pool } = require('pg');

// 从Vercel环境变量获取数据库连接信息
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL + "?sslmode=require",
});

// 通用查询函数
async function query(text, params) {
  try {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('query error', { text, err });
    throw err;
  }
}

module.exports = { query };