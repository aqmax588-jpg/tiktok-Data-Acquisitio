const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => {
  res.send('✅ TikTok Avatar API Ready');
});

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
      const uniqueIdMatch = data.match(/"uniqueId":"(.*?)"/);

      if (avatarMatch && avatarMatch[1]) {
        let avatar = avatarMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
        return res.json({
          success: true,
          avatarUrl: avatar,
          nickname: nicknameMatch ? nicknameMatch[1] : username,
          uniqueId: uniqueIdMatch ? uniqueIdMatch[1] : username
        });
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  res.status(404).json({ error: 'failed' });
});

setInterval(() => {
  axios.get('https://tk-proxy-2026.onrender.com').catch(() => {});
}, 4 * 60 * 1000);

app.listen(port, () => console.log('Running on', port));
