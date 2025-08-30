/**
 * 北京时间处理工具 - 确保所有时间操作精确对应北京时间(UTC+8)
 */

// 北京时区偏移量（毫秒）
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;

/**
 * 解析任意格式时间为北京时间
 * @param {any} value - 待解析的时间值（字符串、数字等）
 * @returns {Date|null} 北京时间Date对象，失败则返回null
 */
function parseBeijingTime(value) {
    if (!value) return null;

    // 处理Excel数字格式（自1900年1月1日以来的天数）
    if (typeof value === 'number') {
        // Excel从1900年1月1日开始计算，修正Excel的1900年闰年错误
        const excelStart = new Date(1900, 0, 1);
        const days = value - 2; // 修正Excel日期计算错误
        const time = excelStart.getTime() + days * 24 * 60 * 60 * 1000;
        
        // 直接作为北京时间，不做任何时区转换
        const date = new Date(time);
        return isNaN(date.getTime()) ? null : date;
    }

    // 处理字符串格式
    if (typeof value === 'string') {
        // 尝试直接解析
        let date = new Date(value);
        if (!isNaN(date.getTime())) {
            // 检查是否包含时区信息
            if (value.includes('+08') || value.includes('GMT+8') || 
                value.includes('Asia/Shanghai') || value.includes('北京')) {
                return date; // 已经是北京时间
            }
            
            // 对于没有时区信息的字符串，视为北京时间
            const timestamp = date.getTime();
            // 计算UTC时间与北京时区的差异
            const offset = date.getTimezoneOffset() * 60 * 1000;
            return new Date(timestamp + offset + BEIJING_OFFSET);
        }

        // 处理中文格式
        const chineseFormats = [
            { regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/, hasSeconds: true },
            { regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})$/, hasSeconds: false },
            { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2}):(\d{1,2})$/, hasSeconds: true },
            { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{1,2})$/, hasSeconds: false }
        ];

        for (const format of chineseFormats) {
            const match = value.match(format.regex);
            if (match) {
                const year = parseInt(match[1], 10);
                const month = parseInt(match[2], 10) - 1; // 月份从0开始
                const day = parseInt(match[3], 10);
                const hours = parseInt(match[4] || 0, 10);
                const minutes = parseInt(match[5] || 0, 10);
                const seconds = format.hasSeconds ? parseInt(match[6] || 0, 10) : 0;

                // 验证时间有效性
                if (month < 0 || month > 11 || day < 1 || day > 31 ||
                    hours < 0 || hours > 23 || minutes < 0 || minutes > 59 ||
                    seconds < 0 || seconds > 59) {
                    continue;
                }

                // 直接创建北京时间日期对象
                return new Date(year, month, day, hours, minutes, seconds);
            }
        }
    }

    console.warn(`无法解析的时间格式: ${value} (类型: ${typeof value})`);
    return null;
}

/**
 * 将日期对象格式化为数据库存储的北京时间字符串
 * @param {Date} date - 日期对象
 * @returns {string|null} 格式为 'YYYY-MM-DD HH:MM:SS+08' 的字符串
 */
function formatForDatabase(date) {
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

    // 明确标记为UTC+8时区
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+08`;
}

/**
 * 验证时间是否有效
 * @param {any} value - 时间值
 * @returns {boolean} 是否有效
 */
function isValidTime(value) {
    return parseBeijingTime(value) !== null;
}

module.exports = {
    parseBeijingTime,
    formatForDatabase,
    isValidTime,
    BEIJING_OFFSET
};
    
