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
// 生成会话ID
function genSessionId(){
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 普通用户登录【原有逻辑完全保留，只追加激活+设备绑定+会话】
app.post('/api/login', (req, res) => {
  const { username, password, device_fp } = req.body;
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

  // === 新增：兼容旧数据，初始化新增字段 ===
  if(user.activeTime === undefined) user.activeTime = null;
  if(user.deviceFp === undefined) user.deviceFp = "";
  if(user.changeDeviceTimes === undefined) user.changeDeviceTimes = 1;
  if(user.sessionId === undefined) user.sessionId = "";

  // 1. 首次登录：激活账号，开始计时
  if(!user.activeTime){
    user.activeTime = now();
  }

  // 2. 设备绑定判断
  if(user.deviceFp && user.deviceFp !== device_fp){
    // 已绑定设备，且不匹配
    if(user.changeDeviceTimes <= 0){
      return res.json({ ok: false, msg: '设备已锁定，请联系管理员解锁换绑次数' });
    }else{
      // 消耗一次换绑次数，重新绑定新设备
      user.changeDeviceTimes -= 1;
      user.deviceFp = device_fp;
    }
  }

  // 3. 首次绑定设备
  if(!user.deviceFp){
    user.deviceFp = device_fp;
  }

  // 4. 异地互踢：生成新会话，覆盖旧会话
  const token = genToken();
  const sessionId = genSessionId();
  user.token = token;
  user.sessionId = sessionId;

  writeDB(db);
  res.json({ ok: true, token, sessionId });
});

// 原有校验接口 完全保留
app.post('/api/check', (req, res) => {
  const { username, token } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user || !user.enabled || !user.token || user.token !== token) return res.json({ ok: false });
  if (user.expireAt && Date.now() > new Date(user.expireAt).getTime()) return res.json({ ok: false });
  res.json({ ok: true });
});

// === 新增：前台权限校验接口（设备/过期/互踢） ===
app.post('/api/check-auth', (req, res) => {
  const { username, device_fp } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);

  // 不存在/禁用
  if(!user || !user.enabled){
    return res.json({ code: -99, msg: '账号不可用' });
  }
  // 已过期
  if(user.expireAt && Date.now() > new Date(user.expireAt).getTime()){
    return res.json({ code: -1, msg: '账号已过期' });
  }
  // 设备不匹配
  if(user.deviceFp && user.deviceFp !== device_fp){
    return res.json({ code: -2, msg: '设备不匹配' });
  }
  // 正常通过
  return res.json({ code: 0, msg: '验证通过' });
});

// === 新增：管理员接口 - 重置换绑次数 ===
app.post('/api/admin/reset-device-times', (req, res) => {
  const { username } = req.body;
  const db = readDB();
  const user = db.find(x => x.username === username);
  if(!user) return res.json({ ok:false, msg:'用户不存在' });
  user.changeDeviceTimes = 1;
  writeDB(db);
  res.json({ ok:true });
});

// === 新增：管理员接口 - 强制下线用户 ===
app.post('/api/admin/force-logout', (req, res) => {
  const { username } = req.body;
  const db = readDB();
  const user = db.find(x => x.username === username);
  if(user){
    user.token = null;
    user.sessionId = null;
  }
  writeDB(db);
  res.json({ ok:true });
});

// 管理员后台【原有全部保留】
app.post('/api/admin/login', (req, res) => {
  const { user, pwd } = req.body;
  if (user === admin.user && pwd === admin.pwd) return res.json({ ok: true });
  res.json({ ok: false });
});

app.get('/api/admin/list', (req, res) => {
  const db = readDB();
  // 兼容旧数据字段补齐
  db.forEach(item=>{
    if(item.activeTime === undefined) item.activeTime = null;
    if(item.deviceFp === undefined) item.deviceFp = "";
    if(item.changeDeviceTimes === undefined) item.changeDeviceTimes = 1;
    if(item.sessionId === undefined) item.sessionId = "";
  });
  writeDB(db);
  res.json(db);
});

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
      token: null,
      activeTime: null,
      deviceFp: "",
      changeDeviceTimes: 1,
      sessionId: null
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

// ====================== 新增：TikTok 数据中转接口【原样保留】 ======================
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

// 双向保活：前端 + 后端自身 双保活，杜绝Render休眠
const keepAliveList = [
  "https://wallet-project-30bq.onrender.com/",
  "https://tiktok-data-acquisitio.onrender.com"
];

setInterval(() => {
  keepAliveList.forEach(url => {
    https.get(url).on('error', () => {});
  });
}, 10 * 60 * 1000);

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ 服务运行正常 + 双向保活已开启'));
