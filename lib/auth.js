const jwt = require('jsonwebtoken');

async function verifyAuth(req) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: '未提供认证令牌' };
    }
    
    const token = authHeader.split(' ')[1];
    
    // 验证令牌
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-random-secret-key-123');
    return { success: true, user: decoded };
  } catch (error) {
    return { success: false, error: '认证失败' };
  }
}

module.exports = { verifyAuth };
