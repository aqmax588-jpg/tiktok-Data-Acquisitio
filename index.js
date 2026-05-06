const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

const app = express();

// 静态图标托管
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());
app.use(bodyParser.json());

// 数据库路径
const DB_FILE = path.join(__dirname, 'db.json');

// 【修复】强制初始化 db.json 不存在就立刻创建，百分百生成
try {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
    console.log("✅ 已自动创建 db.json");
  }
} catch (e) {
  console.log("db 初始化错误：", e);
}

// 管理员账号
let admin = {
  user: "admin",
  pwd: "admin123"
};

// 工具函数
function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function now() {
  return new Date().toISOString();
}
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// 普通用户登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: '账号不存在' });
  if (user.password !== password) return res.json({ ok: false, msg: '密码错误' });
  if (!user.enabled) return res.json({ ok: false, msg: '账号已禁用' });

  const nowTs = Date.now();
  if (user.expireAt) {
    const expTs = new Date(user.expireAt).getTime();
    if (nowTs > expTs) return res.json({ ok: false, msg: '账号已过期' });
  }

  const token = genToken();
  user.token = token;
  writeDB(db);
  res.json({ ok: true, token });
});

app.post('/api/check', (req, res) => {
  const { username, token } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user || !user.enabled || !user.token || user.token !== token) return res.json({ ok: false });
  if (user.expireAt && Date.now() > new Date(user.expireAt).getTime()) return res.json({ ok: false });
  res.json({ ok: true });
});

// 管理员后台
app.post('/api/admin/login', (req, res) => {
  const { user, pwd } = req.body;
  if (user === admin.user && pwd === admin.pwd) return res.json({ ok: true });
  res.json({ ok: false });
});

app.get('/api/admin/list', (req, res) => res.json(readDB()));

app.post('/api/admin/delete', (req, res) => {
  const { username } = req.body;
  let db = readDB().filter(x => x.username !== username);
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/toggle', (req, res) => {
  const { username, enabled } = req.body;
  const db = readDB();
  const u = db.find(x => x.username === username);
  if (u) {
    u.enabled = enabled;
    if (!enabled) u.token = null;
  }
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/batch', (req, res) => {
  const { lines, days } = req.body;
  const db = readDB();
  const arr = lines.split(/\n/).map(x => x.trim()).filter(Boolean);
  let success = 0, exist = 0;

  for (const line of arr) {
    const [user, pwd] = line.split(/\s+/).filter(Boolean);
    if (!user || !pwd) continue;
    if (db.some(x => x.username === user)) { exist++; continue; }

    const expire = days > 0
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;

    db.push({
      username: user,
      password: pwd,
      enabled: true,
      createdAt: now(),
      expireAt: expire,
      token: null
    });
    success++;
  }

  writeDB(db);
  res.json({ ok: true, success, exist });
});

app.post('/api/admin/set-user-pwd', (req, res) => {
  const { newUser, newPwd } = req.body;
  if (newUser) admin.user = newUser;
  if (newPwd) admin.pwd = newPwd;
  res.json({ ok: true });
});

app.post('/api/admin/set-expire', (req, res) => {
  const { username, days } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: "用户不存在" });

  if (days <= 0) {
    user.expireAt = null;
  } else {
    user.expireAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
  }

  writeDB(db);
  res.json({ ok: true });
});

// ====================== TikTok 真实头像+昵称+粉丝+关注+作品【完整可用】 ======================
app.get('/user/:username', async (req, res) => {
  const username = req.params.username;

  for (let i = 0; i < 3; i++) {
    try {
      const { data } = await axios.get(`https://www.tiktok.com/@${username}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tiktok.com/',
        },
        timeout: 12000
      });

      const nickname = data.match(/"nickname":"(.*?)"/)?.[1] || username;
      const avatarUrl = (data.match(/"avatarThumbURL":"(.*?)"/)?.[1] || '').replace(/\\u002F/g, '/');
      const followers = data.match(/"followerCount":(\d+)/)?.[1] || 0;
      const following = data.match(/"followingCount":(\d+)/)?.[1] || 0;
      const videos = data.match(/"videoCount":(\d+)/)?.[1] || 0;

      if (avatarUrl || Number(followers) > 0) {
        return res.json({
          success: true,
          nickname,
          avatarUrl,
          followers: Number(followers),
          following: Number(following),
          videos: Number(videos)
        });
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 800));
  }

  res.json({ success: false });
});

// 保活
const urls = [
  "https://iiiiiilllllliiiiiiillllllllllllllllliiii.onrender.com",
  "https://wallet-project-30bq.onrender.com/",
  "https://wwwwwwwwwwwvvvvvvwwwwwwvvvvvwwwwvvww.onrender.com/",
  "https://wwwwwwwwwwwvvvvvvwwwwwwvvvvvwwwwvvww.onrender.com/admin.html",
  "https://tk-proxy-2026.onrender.com"
];

process.on('uncaughtException', (err) => {
  console.log('保活过程中出现非致命错误:', err.message);
});

setInterval(() => {
  urls.forEach(url => {
    https.get(url).on('error', () => {});
  });
}, 10 * 60 * 1000);

// 启动
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('✅ 服务启动成功，db.json自动创建完成');
});
