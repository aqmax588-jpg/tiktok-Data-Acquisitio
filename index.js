const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// 静态文件托管（金币图标）
app.use(express.static(path.join(__dirname, 'public')));

// 跨域配置
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 根路由（测试用）
app.get('/', (req, res) => {
  res.send('✅ TikTok API Ready');
});

// 核心接口：获取头像+粉丝数+关注数+作品数
app.get('/get-avatar', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'need username' });

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

      const avatarMatch = data.match(/"avatarThumb":"(.*?)"/);
      const nicknameMatch = data.match(/"nickname":"(.*?)"/);
      const followerMatch = data.match(/"followerCount":(\d+)/);
      const followingMatch = data.match(/"followingCount":(\d+)/);
      const videoMatch = data.match(/"videoCount":(\d+)/);

      if (avatarMatch && avatarMatch[1]) {
        const avatar = avatarMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
        return res.json({
          success: true,
          avatarUrl: avatar,
          nickname: nicknameMatch ? nicknameMatch[1] : username,
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

// Render 保活，防止免费实例休眠
setInterval(() => {
  axios.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}`).catch(() => {});
}, 4 * 60 * 1000);

app.listen(port, () => {
  console.log('Server running on port:', port);
});
