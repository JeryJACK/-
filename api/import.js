<const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');
const { parseBeijingTime, formatForDatabase } = require('../lib/time-handler');
const fs = require('fs');
const path = require('path');

// 创建日志目录
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 日志记录函数
function logError(message, error, requestId) {
    const logMessage = `[${new Date().toISOString()}] [${requestId}] ${message}: ${error.message}\n${error.stack}\n\n`;
    console.error(logMessage);
    // 写入日志文件
    fs.appendFileSync(path.join(logDir, 'import-errors.log'), logMessage);
}

// 数据库连接
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
            console.error('数据库连接测试失败:', err.message);
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
    // 生成唯一请求ID，便于追踪
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    console.log(`[${requestId}] 收到文件导入请求`);

    // 设置超时处理（5分钟）
    const timeoutId = setTimeout(() => {
        console.error(`[${requestId}] 请求处理超时`);
        res.status(504).json({
            success: false,
            error: '请求处理超时',
            requestId
        });
    }, 300000);

    try {
        // 检查请求方法
        if (req.method !== 'POST') {
            const error = '方法不允许，仅支持POST';
            console.log(`[${requestId}] 错误: ${error}`);
            return res.status(405).json({
                success: false,
                error,
                requestId
            });
        }

        // 检查数据库连接错误
        if (global._pgError) {
            const error = '数据库连接初始化失败';
            logError(error, global._pgError, requestId);
            return res.status(500).json({
                success: false,
                error,
                requestId,
                details: process.env.NODE_ENV === 'development' ? global._pgError.message : undefined
            });
        }

        if (!pool) {
            const error = '数据库连接池未初始化';
            console.error(`[${requestId}] 错误: ${error}`);
            return res.status(500).json({
                success: false,
                error,
                requestId
            });
        }

        // 验证身份
        try {
            const auth = await verifyAuth(req);
            if (!auth.success) {
                console.log(`[${requestId}] 认证失败: ${auth.error}`);
                return res.status(401).json({
                    success: false,
                    error: auth.error,
                    requestId
                });
            }
        } catch (authError) {
            const error = '认证过程发生错误';
            logError(error, authError, requestId);
            return res.status(500).json({
                success: false,
                error,
                requestId,
                details: process.env.NODE_ENV === 'development' ? authError.message : undefined
            });
        }

        // 验证请求体
        if (!req.body) {
            const error = '请求体为空';
            console.log(`[${requestId}] 错误: ${error}`);
            return res.status(400).json({
                success: false,
                error,
                requestId
            });
        }

        // 验证records字段
        if (!req.body.records || !Array.isArray(req.body.records)) {
            const error = '请求数据格式不正确，需要包含records数组';
            console.log(`[${requestId}] 错误: ${error}，收到的数据:`, typeof req.body.records);
            return res.status(400).json({
                success: false,
                error,
                requestId
            });
        }

        const { records } = req.body;
        console.log(`[${requestId}] 开始导入 ${records.length} 条记录`);

        // 验证记录数量
        if (records.length === 0) {
            console.log(`[${requestId}] 没有可导入的记录`);
            return res.json({
                success: true,
                data: {
                    inserted: 0,
                    total: 0,
                    errors: []
                },
                message: '没有可导入的记录',
                requestId
            });
        }

        // 限制单次导入最大记录数（防止内存溢出）
        const maxRecordsPerImport = 1000;
        if (records.length > maxRecordsPerImport) {
            const error = `单次导入记录数不能超过 ${maxRecordsPerImport} 条，请分批导入`;
            console.log(`[${requestId}] 错误: ${error}`);
            return res.status(400).json({
                success: false,
                error,
                requestId
            });
        }

        // 数据库事务处理
        let client;
        try {
            // 获取数据库客户端
            client = await pool.connect();
            console.log(`[${requestId}] 获取数据库连接成功`);

            // 开始事务
            await client.query('BEGIN');
            console.log(`[${requestId}] 事务已开始`);

            let inserted = 0;
            const errors = [];

            for (let i = 0; i < records.length; i++) {
                try {
                    const record = records[i];
                    
                    // 验证记录格式
                    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
                        throw new Error('记录必须是有效的非数组对象');
                    }

                    // 获取时间值
                    const timeValue = record['开始时间'] || record.start_time || record.StartTime;
                    
                    // 解析为北京时间
                    const beijingDate = parseBeijingTime(timeValue);
                    if (!beijingDate) {
                        throw new Error(`时间解析失败: ${timeValue || '未提供时间'}`);
                    }
                    
                    // 格式化为数据库存储格式
                    const dbTime = formatForDatabase(beijingDate);
                    if (!dbTime) {
                        throw new Error('时间格式化为数据库格式失败');
                    }
                    
                    // 执行插入
                    const result = await client.query(
                        `INSERT INTO raw_records 
                         (plan_id, start_time, customer, satellite, station, 
                          task_result, task_type, raw)
                         VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)
                         RETURNING id`,
                        [
                            record['计划ID'] || record.plan_id || null,
                            dbTime,  // 存储带北京时区的时间
                            record['客户'] || record.customer || null,
                            record['卫星'] || record.satellite || null,
                            record['测站'] || record.station || null,
                            record['任务结果'] || record.task_result || null,
                            record['任务类型'] || record.task_type || null,
                            JSON.stringify(record)
                        ]
                    );
                    
                    if (result.rows && result.rows.length > 0) {
                        inserted++;
                        console.log(`[${requestId}] 第${i+1}条记录导入成功，ID: ${result.rows[0].id}`);
                    } else {
                        throw new Error('插入记录后未返回ID');
                    }
                } catch (error) {
                    const errorObj = {
                        index: i,
                        error: error.message,
                        record: JSON.stringify(record, null, 2).substring(0, 500) // 限制长度
                    };
                    errors.push(errorObj);
                    console.error(`[${requestId}] 处理第${i+1}条记录失败:`, error.message);
                }
            }

            // 提交事务
            await client.query('COMMIT');
            console.log(`[${requestId}] 事务已提交，成功导入 ${inserted} 条记录`);
            
            res.json({
                success: true,
                data: {
                    inserted,
                    total: records.length,
                    errors
                },
                message: `成功导入${inserted}/${records.length}条记录`,
                requestId
            });
        } catch (transactionError) {
            // 回滚事务
            if (client) {
                try {
                    await client.query('ROLLBACK');
                    console.log(`[${requestId}] 事务已回滚`);
                } catch (rollbackError) {
                    logError('回滚事务失败', rollbackError, requestId);
                }
            }
            
            const error = '数据库事务处理失败';
            logError(error, transactionError, requestId);
            res.status(500).json({
                success: false,
                error,
                requestId,
                details: process.env.NODE_ENV === 'development' ? transactionError.message : undefined
            });
        } finally {
            // 释放客户端
            if (client) {
                client.release();
                console.log(`[${requestId}] 数据库连接已释放`);
            }
        }
    } catch (error) {
        logError('导入请求处理失败', error, requestId);
        res.status(500).json({
            success: false,
            error: '处理导入请求时发生错误',
            requestId,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        // 清除超时
        clearTimeout(timeoutId);
        console.log(`[${requestId}] 请求处理结束`);
    }
};
    
