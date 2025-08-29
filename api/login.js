import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// 正确的数据库连接配置
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false // 对于Vercel PostgreSQL必需
  }
});

// 测试数据库连接
async function testDbConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('数据库连接成功');
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    return false;
  }
}

// 提前测试连接
testDbConnection();

export default async function handler(req, res) {
  // 允许跨域请求
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { username, password } = req.body;

  try {
    // 检查数据库连接是否正常
    const isConnected = await testDbConnection();
    if (!isConnected) {
      return res.status(500).json({ error: '无法连接到数据库' });
    }

    // 查询用户
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = result.rows[0];
    
    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成JWT令牌
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'your-secure-secret-key',
      { expiresIn: '24h' }
    );

    res.json({ success: true, token });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ 
      error: '服务器错误: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
    
