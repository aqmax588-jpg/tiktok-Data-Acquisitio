const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

const app = express();

// 静态资源托管
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());
app.use(bodyParser.json());

// 数据库文件
const DB_FILE = path.join(__dirname, 'db.json');
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
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

// ====================== 新增：TikTok 数据中转接口 ======================
app.get('/api/tiktok-user', async (req, res) => {
  try {
    const { unique_id } = req.query;
    if (!unique_id) {
      return res.json({ code: -1, msg: '缺少参数' });
    }

    const apiUrl = `https://www.tikwm.com/api/user/info?unique_id=${unique_id}`;
    const result = await axios.get(apiUrl, { timeout: 15000 });
    res.json(result.data);
  } catch (e) {
    console.error('TikTok接口请求失败:', e);
    res.json({ code: -1, msg: '请求失败' });
  }
});

// 保活
const urls = [
  "https://wallet-project-30bq.onrender.com/"
];

setInterval(() => {
  urls.forEach(url => {
    https.get(url).on('error', () => {});
  });
}, 10 * 60 * 1000);

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ 服务运行正常'));
