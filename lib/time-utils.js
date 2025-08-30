/**
 * 北京时间处理工具
 * 确保所有时间操作都基于北京时间(UTC+8)，不进行不必要的时区转换
 */

// 调试日志
function logTime(message, value) {
    if (process.env.NODE_ENV === 'development') {
        console.log(`[北京时间处理] ${message}:`, value);
    }
}

/**
 * 解析各种格式的时间为北京时间Date对象
 * @param {any} timeValue - 待解析的时间值（字符串、数字等）
 * @returns {Date|null} 北京时间Date对象，解析失败返回null
 */
function parseBeijingTime(timeValue) {
    if (!timeValue) {
        logTime('空时间值', timeValue);
        return null;
    }

    // 处理Excel数字格式（自1900年1月1日以来的天数）
    if (typeof timeValue === 'number') {
        logTime('Excel数字格式原始值', timeValue);
        
        // Excel从1900年1月1日开始计算，修正Excel的1900年闰年错误
        const excelEpoch = new Date(1900, 0, 1);
        const days = timeValue - 2; // 修正Excel的日期计算错误
        const milliseconds = days * 24 * 60 * 60 * 1000;
        
        // 创建日期对象（直接作为本地时间，即北京时间）
        const date = new Date(excelEpoch.getTime() + milliseconds);
        
        if (!isNaN(date.getTime())) {
            logTime('Excel数字解析结果（北京时间）', date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
            return date;
        }
    }

    // 处理字符串格式
    if (typeof timeValue === 'string') {
        logTime('字符串格式原始值', timeValue);
        
        // 尝试直接解析为北京时间
        const date = new Date(timeValue);
        if (!isNaN(date.getTime())) {
            logTime('字符串直接解析结果', date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
            return date;
        }
        
        // 处理中文格式的日期时间
        const chinesePatterns = [
            { regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/, hasSeconds: true },
            { regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})$/, hasSeconds: false },
            { regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日$/, hasTime: false }
        ];
        
        for (const pattern of chinesePatterns) {
            const match = timeValue.match(pattern.regex);
            if (match) {
                const year = parseInt(match[1], 10);
                const month = parseInt(match[2], 10) - 1; // 月份从0开始
                const day = parseInt(match[3], 10);
                const hours = pattern.hasTime !== false ? parseInt(match[4] || 0, 10) : 0;
                const minutes = pattern.hasTime !== false ? parseInt(match[5] || 0, 10) : 0;
                const seconds = pattern.hasSeconds ? parseInt(match[6] || 0, 10) : 0;
                
                // 验证时间有效性
                if (month < 0 || month > 11) continue;
                if (day < 1 || day > 31) continue;
                if (hours < 0 || hours > 23) continue;
                if (minutes < 0 || minutes > 59) continue;
                if (seconds < 0 || seconds > 59) continue;
                
                const date = new Date(year, month, day, hours, minutes, seconds);
                if (!isNaN(date.getTime())) {
                    logTime('中文格式解析结果', date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
                    return date;
                }
            }
        }
    }

    console.warn(`无法解析的时间格式: ${timeValue} (类型: ${typeof timeValue})`);
    return null;
}

/**
 * 将Date对象格式化为数据库存储的北京时间字符串
 * @param {Date} date - Date对象
 * @returns {string|null} 带北京时区的时间字符串，如 "2023-10-01 12:34:56+08"
 */
function formatBeijingTimeForDB(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return null;
    }

    // 直接获取北京时间的各个部分（不转换为UTC）
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // 明确指定为北京时区(+08:00)
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+08`;
}

/**
 * 验证时间是否为有效的北京时间
 * @param {any} timeValue - 待验证的时间值
 * @returns {boolean} 是否有效
 */
function isValidBeijingTime(timeValue) {
    const date = parseBeijingTime(timeValue);
    return date !== null && !isNaN(date.getTime());
}

module.exports = {
    parseBeijingTime,
    formatBeijingTimeForDB,
    isValidBeijingTime
};
    