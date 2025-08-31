const { query } = require('./index');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// 生成JWT密钥（在Vercel环境变量中设置）
const JWT_SECRET = process.env.JWT_SECRET || 'your-random-secret-key-123'
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 注册新用户
  if (req.method === 'POST' && req.url.includes('/register')) {
    try {
      const { username, password, email } = JSON.parse(req.body);
      
      // 检查用户是否已存在
      const userExists = await query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );
      
      if (userExists.rows.length > 0) {
        return res.status(400).json({ message: '用户名已存在' });
      }
      
      // 密码加密
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      
      // 创建用户
      const result = await query(
        'INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING id, username, email',
        [username, passwordHash, email]
      );
      
      return res.status(201).json({ 
        message: '用户创建成功', 
        user: result.rows[0] 
      });
    } catch (error) {
      console.error('注册错误:', error);
      return res.status(500).json({ message: '注册失败' });
    }
  }

  // 用户登录
  if (req.method === 'POST' && req.url.includes('/login')) {
    try {
      const { username, password } = JSON.parse(req.body);
      
      // 查询用户
      const result = await query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ message: '用户名或密码错误' });
      }
      
      const user = result.rows[0];
      
      // 验证密码
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ message: '用户名或密码错误' });
      }
      
      // 生成JWT令牌
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      return res.json({ 
        message: '登录成功', 
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      });
    } catch (error) {
      console.error('登录错误:', error);
      return res.status(500).json({ message: '登录失败' });
    }
  }

  // 验证令牌
  if (req.method === 'GET' && req.url.includes('/verify')) {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ message: '未提供令牌' });
      }
      
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.json({ valid: true, user: decoded });
    } catch (error) {
      return res.status(401).json({ valid: false, message: '令牌无效' });
    }
  }

  return res.status(404).json({ message: '接口不存在' });
};