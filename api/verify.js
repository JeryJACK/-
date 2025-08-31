// 认证验证模块
const AuthVerifier = {
    // 检查本地存储中是否有令牌
    hasToken() {
        return !!localStorage.getItem('token');
    },
    
    // 获取存储的令牌
    getToken() {
        return localStorage.getItem('token');
    },
    
    // 获取存储的用户信息
    getUser() {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    },
    
    // 验证令牌有效性
    async verifyToken() {
        if (!this.hasToken()) {
            return { valid: false, reason: '无令牌' };
        }
        
        try {
            const response = await fetch('/api/auth/verify', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`
                }
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.valid) {
                this.clearAuthData();
                return { valid: false, reason: result.message || '令牌无效' };
            }
            
            return { 
                valid: true, 
                user: result.user 
            };
        } catch (error) {
            console.error('令牌验证失败:', error);
            return { valid: false, reason: '验证过程出错' };
        }
    },
    
    // 清除认证数据（退出登录）
    clearAuthData() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    },
    
    // 检查用户是否已登录，未登录则跳转到登录页
    async requireAuth() {
        const verification = await this.verifyToken();
        
        if (!verification.valid) {
            // 记录当前URL，登录后可跳转回来
            const currentPath = window.location.pathname;
            if (currentPath !== '/auth/login.html') {
                localStorage.setItem('redirectAfterLogin', currentPath);
            }
            
            window.location.href = '/auth/login.html';
            return false;
        }
        
        return verification.user;
    },
    
    // 登录后处理
    handleLogin(token, user) {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        
        // 检查是否有跳转地址
        const redirectPath = localStorage.getItem('redirectAfterLogin');
        if (redirectPath) {
            localStorage.removeItem('redirectAfterLogin');
            window.location.href = redirectPath;
        } else {
            window.location.href = '/auth/dashboard.html';
        }
    }
};
    