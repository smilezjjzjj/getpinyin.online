const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 有道云API凭证 - 从环境变量中获取
const YOUDAO_APP_KEY = process.env.YOUDAO_APP_KEY;
const YOUDAO_APP_SECRET = process.env.YOUDAO_APP_SECRET;

// 检查API凭证是否已配置
if (!YOUDAO_APP_KEY || !YOUDAO_APP_SECRET) {
  console.warn('警告: 有道云API凭证未设置。请在.env文件中配置YOUDAO_APP_KEY和YOUDAO_APP_SECRET。');
  console.log('应用将以有限功能运行。');
}

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // 允许跨域请求
app.use(express.static(path.join(__dirname, './'))); // 提供静态文件

// 辅助函数 - 截断查询字符串
function truncate(q) {
  const len = q.length;
  if (len <= 20) return q;
  return q.substring(0, 10) + len + q.substring(len - 10, len);
}

// 有道云翻译API函数
async function translateWithYoudao(word) {
  if (!YOUDAO_APP_KEY || !YOUDAO_APP_SECRET) {
    throw new Error('有道云API凭证未配置');
  }

  const salt = Date.now();
  const curtime = Math.round(Date.now() / 1000);
  const signStr = YOUDAO_APP_KEY + truncate(word) + salt + curtime + YOUDAO_APP_SECRET;
  const sign = crypto.createHash('sha256').update(signStr).digest('hex');
  
  const requestBody = {
    q: word,
    from: 'en',
    to: 'zh-CHS',
    appKey: YOUDAO_APP_KEY,
    salt: salt,
    sign: sign,
    signType: 'v3',
    curtime: curtime
  };
  
  const response = await axios({
    method: 'post',
    url: 'https://openapi.youdao.com/api',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams(requestBody).toString(),
    timeout: 10000
  });
  
  const data = response.data;
  
  if (data.errorCode !== '0') {
    throw new Error(`有道云API错误: ${data.errorCode}`);
  }

  if (data.translation && data.translation.length > 0) {
    return {
      translation: data.translation[0],
      phonetic: data.basic?.phonetic || '暂无拼音',
      source: 'youdao'
    };
  } else {
    throw new Error('有道云API未返回有效结果');
  }
}

// 有道云翻译API端点
app.post('/api/translate', async (req, res) => {
  try {
    const { word } = req.body;
    
    if (!word) {
      return res.status(400).json({ error: '请提供要翻译的单词' });
    }
    
    console.log(`翻译请求: ${word}`);
    
    // 调用有道云翻译
    const translationResult = await translateWithYoudao(word);
    console.log('有道云翻译成功');
    
    // 处理翻译结果 - 有道云返回的是中文翻译
    const chineseTranslation = translationResult.translation;
    
    // 获取中文翻译的拼音
    let pinyin = '';
    try {
      const pinyinResponse = await axios.get(`http://localhost:${PORT}/api/pinyin?text=${encodeURIComponent(chineseTranslation)}`);
      pinyin = pinyinResponse.data.pinyin || '';
    } catch (error) {
      console.error('获取拼音失败:', error.message);
      pinyin = '获取拼音失败';
    }
    
    // 返回统一格式的响应
    const response = {
      errorCode: '0',
      translation: [chineseTranslation],
      basic: {
        phonetic: pinyin
      },
      apiSource: translationResult.source,
      query: word
    };
    
    res.json(response);
  } catch (error) {
    console.error('翻译API错误:', error.message);
    res.status(500).json({ 
      error: '翻译服务出错', 
      message: error.message,
      errorCode: 'TRANSLATION_FAILED'
    });
  }
});

// 拼音API端点 - 简单实现
app.get('/api/pinyin', (req, res) => {
  const text = req.query.text;
  
  if (!text) {
    return res.status(400).json({ error: '请提供要获取拼音的文本' });
  }
  
  // 简单的拼音映射（常用汉字）
  const pinyinMap = {
    '你': 'nǐ', '好': 'hǎo', '世': 'shì', '界': 'jiè', '爱': 'ài',
    '人': 'rén', '大': 'dà', '小': 'xiǎo', '中': 'zhōng', '国': 'guó',
    '美': 'měi', '丽': 'lì', '时': 'shí', '间': 'jiān', '工': 'gōng',
    '作': 'zuò', '学': 'xué', '习': 'xí', '生': 'shēng', '活': 'huó',
    '朋': 'péng', '友': 'yǒu', '家': 'jiā', '庭': 'tíng', '快': 'kuài',
    '乐': 'lè', '幸': 'xìng', '福': 'fú', '电': 'diàn', '脑': 'nǎo',
    '手': 'shǒu', '机': 'jī', '水': 'shuǐ', '食': 'shí', '物': 'wù',
    '钱': 'qián', '帮': 'bāng', '助': 'zhù', '谢': 'xiè', '请': 'qǐng',
    '汽': 'qì', '车': 'chē', '书': 'shū', '音': 'yīn', '乐': 'yuè',
    '电': 'diàn', '影': 'yǐng', '运': 'yùn', '动': 'dòng', '健': 'jiàn',
    '康': 'kāng', '医': 'yī', '院': 'yuàn', '学': 'xué', '校': 'xiào',
    '老': 'lǎo', '师': 'shī', '学': 'xué', '生': 'shēng'
  };
  
  // 为每个字符生成拼音
  let pinyin = '';
  for (let char of text) {
    if (pinyinMap[char]) {
      pinyin += pinyinMap[char] + ' ';
    } else if (/[\u4e00-\u9fa5]/.test(char)) {
      // 如果是汉字但不在映射中，使用通用标记
      pinyin += '[' + char + '] ';
    } else {
      // 非汉字字符直接保留
      pinyin += char + ' ';
    }
  }
  
  res.json({ pinyin: pinyin.trim() });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log('项目已简化为最小结构，完全依赖在线API翻译');
}); 