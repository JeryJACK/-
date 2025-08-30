const jwt = require('jsonwebtoken');

// 从Vercel环境变量获取密钥
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

module.exports = function(req, res, next) {
  // 从请求头获取token
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(403).json({ message: '需要登录才能访问' });
  }
  
  try {
    // 验证token
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: '无效的令牌' });
  }
};
    