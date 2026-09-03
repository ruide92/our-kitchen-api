const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件
app.use('/images', express.static(path.join(__dirname, 'data', 'images')));

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dishes', require('./routes/dishes'));
app.use('/api/family', require('./routes/family'));
app.use('/api/fridge', require('./routes/fridge'));
app.use('/api/shopping', require('./routes/shopping'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/condiments', require('./routes/condiments'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/orders', require('./routes/orders'));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   我们家的大食堂 - 后端服务已启动         ║
║   端口: ${PORT}                              ║
║   健康检查: http://localhost:${PORT}/api/health ║
╚══════════════════════════════════════════╝
  `);
});
