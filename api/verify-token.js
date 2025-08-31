import { verifyAuth } from '../lib/auth';

export default async function handler(req, res) {
    // 只允许GET方法
    if (req.method !== 'GET') {
        return res.status(405).json({ error: '只允许GET方法' });
    }

    // 验证身份
    const auth = await verifyAuth(req);
    if (!auth.success) {
        return res.status(401).json({ error: auth.error });
    }

    // 令牌有效
    res.json({ success: true, message: '令牌有效', user: auth.user });
}
