// 数据导入处理模块（带中英文字段映射）
const DataImporter = {
    // 中英文字段映射表
    fieldMappings: {
        // 中文 -> 英文
        '计划ID': 'planId',
        '任务ID': 'planId',
        '开始时间': 'startTime',
        '启动时间': 'startTime',
        '客户名称': 'customerName',
        '所属客户': 'customerName',
        '卫星名称': 'satelliteName',
        '卫星名': 'satelliteName',
        '测站名称': 'stationName',
        '站点名称': 'stationName',
        '任务结果状态': 'taskStatus',
        '任务状态': 'taskStatus',
        '任务类型': 'taskType',
    },
    
    // 反向映射（英文 -> 中文，用于错误提示）
    reverseMappings: {
        'planId': '计划ID',
        'startTime': '开始时间',
        'customerName': '所属客户',
        'satelliteName': '卫星名称',
        'stationName': '测站名称',
        'taskStatus': '任务结果状态',
        'taskType': '任务类型'
    },
    
    // 将中文键名映射为英文键名
    mapChineseFields(data) {
        if (!Array.isArray(data)) {
            return this.mapSingleItem(data);
        }
        
        return data.map(item => this.mapSingleItem(item));
    },
    
    // 处理单个数据项的字段映射
    mapSingleItem(item) {
        if (typeof item !== 'object' || item === null) {
            return item;
        }
        
        const mappedItem = {};
        
        // 遍历所有键名，进行映射
        for (const key in item) {
            if (item.hasOwnProperty(key)) {
                // 如果是中文键名且在映射表中存在对应项，则使用映射后的英文键名
                const mappedKey = this.fieldMappings[key] || key;
                mappedItem[mappedKey] = item[key];
            }
        }
        
        return mappedItem;
    },
    
    // 验证数据格式是否正确
    validateData(data) {
        if (!Array.isArray(data)) {
            throw new Error('数据必须是数组格式');
        }
        
        const requiredFields = ['planId', 'startTime'];
        const validStatus = ['成功', '失败', '进行中', '未开始'];
        
        data.forEach((item, index) => {
            // 先进行字段映射（处理可能的中文键名）
            const mappedItem = this.mapSingleItem(item);
            
            // 检查必填字段
            requiredFields.forEach(field => {
                if (!mappedItem[field]) {
                    // 使用反向映射显示中文名称，更友好
                    throw new Error(`第 ${index + 1} 条数据缺少必填字段: ${this.reverseMappings[field] || field}`);
                }
            });
            
            // 验证日期格式
            if (isNaN(Date.parse(mappedItem.startTime))) {
                throw new Error(`第 ${index + 1} 条数据的${this.reverseMappings.startTime}格式无效: ${mappedItem.startTime}`);
            }
            
            // 验证任务状态
            if (mappedItem.taskStatus && !validStatus.includes(mappedItem.taskStatus)) {
                throw new Error(`第 ${index + 1} 条数据的${this.reverseMappings.taskStatus}无效: ${mappedItem.taskStatus}`);
            }
        });
        
        return true;
    },
    
    // 将数据分割为多个分片
    splitIntoChunks(data, chunkSize = 100) {
        const chunks = [];
        for (let i = 0; i < data.length; i += chunkSize) {
            chunks.push(data.slice(i, i + chunkSize));
        }
        return chunks;
    },
    
    // 上传单个分片
    async uploadChunk(chunkId, totalChunks, data, token) {
        const response = await fetch('/api/data/upload-chunk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                chunkId,
                totalChunks,
                data: this.transformData(chunkId, data)
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || `上传分片 ${chunkId + 1}/${totalChunks} 失败`);
        }
        
        return result;
    },
    
    // 批量上传所有分片
    async uploadAllChunks(data, token, progressCallback) {
        try {
            // 先进行字段映射（处理可能的中文键名）
            const mappedData = this.mapChineseFields(data);
            
            // 验证数据
            this.validateData(mappedData);
            
            // 分割数据
            const chunks = this.splitIntoChunks(mappedData);
            const totalChunks = chunks.length;
            
            // 上传所有分片
            for (let i = 0; i < totalChunks; i++) {
                await this.uploadChunk(i, totalChunks, chunks[i], token);
                
                // 调用进度回调
                if (progressCallback) {
                    const progress = Math.round(((i + 1) / totalChunks) * 100);
                    progressCallback(progress);
                }
            }
            
            return {
                success: true,
                total: data.length,
                message: `成功上传 ${data.length} 条数据`
            };
        } catch (error) {
            console.error('上传失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    },
    
    // 转换数据格式以适应数据库结构
    transformData(chunkId, data) {
        // 确保先进行字段映射
        const mappedData = this.mapChineseFields(data);
        
        return mappedData.map(item => ({
            planId: item.planId,
            startTime: item.startTime,
            customerName: item.customerName || '',
            satelliteName: item.satelliteName || '',
            stationName: item.stationName || '',
            taskStatus: item.taskStatus || '未开始',
            taskType: item.taskType || ''
        }));
    },
    
    // 从JSON文件加载数据
    async loadFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (event) => {
                try {
                    const content = event.target.result;
                    const data = JSON.parse(content);
                    resolve(data);
                } catch (error) {
                    reject(new Error(`解析JSON文件失败: ${error.message}`));
                }
            };
            
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file);
        });
    },
    
    // 添加自定义字段映射
    addCustomMapping(chineseField, englishField) {
        this.fieldMappings[chineseField] = englishField;
        this.reverseMappings[englishField] = chineseField;
    }
};
    