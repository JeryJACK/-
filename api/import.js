<const { Pool } = require('pg');
const { verifyAuth } = require('../lib/auth');
const { parseBeijingTime, formatForDatabase } = require('../lib/time-handler');

// 数据库连接
let pool;
if (!global._pgPool) {
    pool = new Pool({ 
        connectionString: process.env.POSTGRES_URL,
        connectionTimeoutMillis: 5000
    });
    global._pgPool = pool;
} else {
    pool = global._pgPool;
}

module.exports = async (req, res) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    console.log(`[${requestId}] 收到数据导入请求`);

    try {
        if (req.method !== 'POST') {
            const error = '方法不允许，仅支持POST';
            console.log(`[${requestId}] 错误: ${error}`);
            return res.status(405).json({
                success: false,
                error
            });
        }

        // 验证身份
        const auth = await verifyAuth(req);
        if (!auth.success) {
            console.log(`[${requestId}] 认证失败: ${auth.error}`);
            return res.status(401).json({
                success: false,
                error: auth.error
            });
        }

        // 验证请求数据
        if (!req.body || !req.body.records || !Array.isArray(req.body.records)) {
            const error = '请求数据格式不正确，需要包含records数组';
            console.log(`[${requestId}] 错误: ${error}`);
            return res.status(400).json({
                success: false,
                error
            });
        }

        const { records } = req.body;
        console.log(`[${requestId}] 开始导入 ${records.length} 条记录`);

        // 数据库事务
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            let inserted = 0;
            const errors = [];

            for (let i = 0; i < records.length; i++) {
                try {
                    const record = records[i];
                    
                    // 验证记录格式
                    if (typeof record !== 'object' || record === null) {
                        throw new Error('记录必须是有效的对象');
                    }

                    // 获取时间值
                    const timeValue = record['开始时间'] || record.start_time || record.StartTime;
                    
                    // 解析为北京时间（关键修复）
                    const beijingDate = parseBeijingTime(timeValue);
                    if (!beijingDate) {
                        throw new Error(`时间解析失败: ${timeValue || '未提供时间'}`);
                    }
                    
                    // 格式化为数据库存储格式（带北京时区）
                    const dbTime = formatForDatabase(beijingDate);
                    if (!dbTime) {
                        throw new Error('时间格式化为数据库格式失败');
                    }
                    
                    // 执行插入
                    await client.query(
                        `INSERT INTO raw_records 
                         (plan_id, start_time, customer, satellite, station, 
                          task_result, task_type, raw)
                         VALUES ($1, $2::TIMESTAMPTZ, $3, $4, $5, $6, $7, $8)`,
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
                    
                    inserted++;
                } catch (error) {
                    errors.push({
                        index: i,
                        error: error.message,
                        record: JSON.stringify(records[i])
                    });
                    console.error(`[${requestId}] 处理第${i+1}条记录失败:`, error.message);
                }
            }

            await client.query('COMMIT');
            console.log(`[${requestId}] 导入完成: 成功 ${inserted} 条, 失败 ${errors.length} 条`);
            
            res.json({
                success: true,
                data: {
                    inserted,
                    total: records.length,
                    errors
                },
                message: `成功导入${inserted}/${records.length}条记录`
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`[${requestId}] 事务失败:`, error.message);
            res.status(500).json({
                success: false,
                error: '数据库事务处理失败',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error(`[${requestId}] 导入请求处理失败:`, error.message);
        res.status(500).json({
            success: false,
            error: '处理导入请求时发生错误',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
    
