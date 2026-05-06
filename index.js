const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

// 适配 Render 端口
const port = process.env.PORT || 3000;

// 【关键】静态资源托管 - Render 直接支持，放图标直接访问
app.use(express.static(path.join(__dirname, 'public')));

// 跨域全局中间件 适配前端跨域
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 首页测试
app.get('/', (req, res) => {
  res.send('✅ TikTok API Ready | 头像+粉丝+关注+作品数+图标托管');
});

// 核心接口：获取TikTok 头像+昵称+粉丝数+关注数+视频数
app.get('/get-avatar', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'need username' });

  // 重试3次 防超时
  for (let i = 0; i < 3; i++) {
    try {
      const { data } = await axios.get(`https://www.tiktok.com/@${username}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tiktok.com/'
        },
        timeout: 12000
      });

      // 基础信息正则匹配
      const avatarMatch = data.match(/"avatarThumb":"(.*?)"/);
      const nicknameMatch = data.match(/"nickname":"(.*?)"/);
      const uniqueIdMatch = data.match(/"uniqueId":"(.*?)"/);

      // 新增：真实粉丝、关注、作品数量
      const followerMatch = data.match(/"followerCount":(\d+)/);
      const followingMatch = data.match(/"followingCount":(\d+)/);
      const videoMatch = data.match(/"videoCount":(\d+)/);

      if (avatarMatch && avatarMatch[1]) {
        let avatar = avatarMatch[1]
          .replace(/\\u002F/g, '/')
          .replace(/\\/g, '');

        return res.json({
          success: true,
          avatarUrl: avatar,
          nickname: nicknameMatch ? nicknameMatch[1] : username,
          uniqueId: uniqueIdMatch ? uniqueIdMatch[1] : username,
          followers: followerMatch ? Number(followerMatch[1]) : 0,
          following: followingMatch ? Number(followingMatch[1]) : 0,
          videos: videoMatch ? Number(videoMatch[1]) : 0
        });
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  res.status(404).json({ error: 'failed' });
});

// Render 保活 4分钟自动心跳 防止休眠
setInterval(() => {
  axios.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}`).catch(() => {});
}, 4 * 60 * 1000);

// 监听端口 适配 Render
app.listen(port, () => {
  console.log('Server running on port:', port);
});
