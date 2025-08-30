<const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');

// 确保数据库连接
let pool;
try {
    pool = new Pool({ 
        connectionString: process.env.POSTGRES_URL,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    });
    
    // 测试连接
    pool.query('SELECT NOW()', (err) => {
        if (err) {
            console.error('数据库连接失败:', err.message);
        } else {
            console.log('数据库连接成功');
        }
    });
    
    global._pgPool = pool;
} catch (error) {
    console.error('创建数据库连接池失败:', error.message);
    global._pgError = error;
}

module.exports = async (req, res) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    console.log(`[${requestId}] 收到请求: ${req.method} ${req.url}`);

    try {
        // 检查数据库连接错误
        if (global._pgError) {
            const error = '数据库连接初始化失败';
            console.error(`[${requestId}] 错误: ${error}`, global._pgError.message);
            return res.status(500).json({
                success: false,
                error,
                details: process.env.NODE_ENV === 'development' ? global._pgError.message : undefined
            });
        }

        if (!pool) {
            const error = '数据库连接池未初始化';
            console.error(`[${requestId}] 错误: ${error}`);
            return res.status(500).json({
                success: false,
                error
            });
        }

        // 验证身份
        const auth = await verifyAuth(req);
        if (!auth.success && req.method !== 'GET') {
            console.log(`[${requestId}] 认证失败: ${auth.error}`);
            return res.status(401).json({
                success: false,
                error: auth.error
            });
        }

        const { page = 1, pageSize = 10, id } = req.query;
        const pageNum = parseInt(page, 10);
        const size = parseInt(pageSize, 10);
        
        // 验证分页参数
        if (isNaN(pageNum) || pageNum < 1) {
            return res.status(400).json({
                success: false,
                error: '无效的页码参数'
            });
        }
        
        if (isNaN(size) || size < 1 || size > 100) {
            return res.status(400).json({
                success: false,
                error: '无效的每页条数参数（1-100）'
            });
        }
        
        const offset = (pageNum - 1) * size;

        if (id) {
            // 获取单条记录
            console.log(`[${requestId}] 查询单条记录: ${id}`);
            try {
                const result = await pool.query(
                    `SELECT id, plan_id, 
                            -- 明确转换为北京时区
                            TO_CHAR(start_time AT TIME ZONE 'Asia/Shanghai', 
                                    'YYYY-MM-DD HH24:MI:SS') AS start_time,
                            customer, satellite, station, 
                            task_result, task_type 
                     FROM raw_records 
                     WHERE id = $1`,
                    [id]
                );
                
                if (result.rows.length === 0) {
                    console.log(`[${requestId}] 记录不存在: ${id}`);
                    return res.status(404).json({
                        success: false,
                        error: '记录不存在'
                    });
                }
                
                console.log(`[${requestId}] 成功返回单条记录`);
                return res.json({
                    success: true,
                    data: result.rows[0]
                });
            } catch (error) {
                console.error(`[${requestId}] 单条记录查询失败:`, error.message);
                return res.status(500).json({
                    success: false,
                    error: '查询记录失败',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
        }

        // 获取记录列表
        try {
            // 先查询总数
            const countResult = await pool.query('SELECT COUNT(*) FROM raw_records');
            const total = parseInt(countResult.rows[0].count, 10);
            
            // 查询记录
            const result = await pool.query(
                `SELECT id, plan_id, 
                        -- 明确转换为北京时区
                        TO_CHAR(start_time AT TIME ZONE 'Asia/Shanghai', 
                                'YYYY-MM-DD HH24:MI:SS') AS start_time,
                        customer, satellite, station, 
                        task_result, task_type 
                 FROM raw_records 
                 ORDER BY start_time DESC 
                 LIMIT $1 OFFSET $2`,
                [size, offset]
            );
            
            console.log(`[${requestId}] 成功返回 ${result.rows.length} 条记录，共 ${total} 条`);
            res.json({
                success: true,
                data: {
                    records: result.rows,
                    pagination: {
                        total,
                        page: pageNum,
                        pageSize: size,
                        totalPages: Math.ceil(total / size)
                    }
                }
            });
        } catch (error) {
            console.error(`[${requestId}] 记录列表查询失败:`, error.message);
            res.status(500).json({
                success: false,
                error: '获取数据列表失败',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    } catch (error) {
        console.error(`[${requestId}] 请求处理失败:`, error.message);
        res.status(500).json({
            success: false,
            error: '服务器处理请求时发生错误',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
    
