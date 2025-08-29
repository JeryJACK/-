import jwt from 'jsonwebtoken';

export async function verifyAuth(req) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return { success: false, error: '未提供认证令牌' };
        }
        
        const token = authHeader.split(' ')[1];
        
        // 验证令牌
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            return { success: true, user: decoded };
        } catch (jwtError) {
            // 令牌验证失败（过期、无效等）
            return { success: false, error: '令牌无效或已过期' };
        }
    } catch (error) {
        return { success: false, error: '认证过程出错' };
    }
}
