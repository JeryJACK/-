import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// 确保连接字符串正确处理
const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('错误: 未设置POSTGRES_URL环境变量');
}

// 配置数据库连接
const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString.includes('vercel') || connectionString.includes('neon') 
    ? { rejectUnauthorized: false } 
    : false
});

// 测试连接的辅助函数
async function testDbConnection() {
  let client;
  try {
    // 尝试获取连接
    client = await pool.connect();
    console.log('成功获取数据库连接');
    
    // 执行简单查询
    const result = await client.query('SELECT NOW()');
    console.log('数据库时间:', result.rows[0].now);
    
    return true;
  } catch (error) {
    console.error('数据库连接测试失败:', {
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    return false;
  } finally {
    // 确保释放连接
    if (client) {
      try {
        client.release();
      } catch (releaseError) {
        console.error('释放数据库连接失败:', releaseError.message);
      }
    }
  }
}

export default async function handler(req, res) {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 只允许POST请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许POST方法' });
  }

  const { username, password } = req.body;

  try {
    // 检查环境变量
    if (!process.env.POSTGRES_URL) {
      return res.status(500).json({ error: '服务器未配置数据库连接' });
    }

    // 检查数据库连接
    const isConnected = await testDbConnection();
    if (!isConnected) {
      return res.status(500).json({ 
        error: '无法连接到数据库',
        details: '请检查数据库是否已启动且连接字符串正确'
      });
    }

    // 查询用户
    const result = await pool.query(
      'SELECT id, username, password FROM users WHERE username = $1',
      [username]
    );
    
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
      process.env.JWT_SECRET || 'development-only-secret',
      { expiresIn: '24h' }
    );

    res.json({ success: true, token });
  } catch (error) {
    console.error('登录处理错误:', error);
    res.status(500).json({ 
      error: '服务器处理错误: ' + error.message,
      code: error.code
    });
  }
}
