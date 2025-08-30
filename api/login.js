import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  // 直接从环境变量获取连接字符串
  const connectionString = process.env.POSTGRES_URL;
  
  // 检查环境变量是否存在
  if (!connectionString) {
    console.error('POSTGRES_URL环境变量未设置');
    return res.status(500).json({ error: '数据库配置错误' });
  }

  // 每次请求都创建新的连接池（避免全局状态问题）
  const pool = new Pool({ 
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false // 关键配置，Vercel PostgreSQL需要
    }
  });

  const { username, password } = req.body;

  try {
    // 测试连接
    await pool.query('SELECT 1');
    
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
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({ success: true, token });
  } catch (error) {
    console.error('登录错误:', error);
    console.error('使用的连接字符串:', connectionString ? '已设置' : '未设置');
    res.status(500).json({ error: '服务器错误' });
  } finally {
    // 确保连接池关闭
    await pool.end();
  }
}
    
