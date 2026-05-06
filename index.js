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
function genSessionId(){
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 登录接口
app.post('/api/login', (req, res) => {
  const { username, password, device_fp } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  
  if (!user) return res.json({ ok: false, msg: '账号不存在' });
  if (user.password !== password) return res.json({ ok: false, msg: '密码错误' });
  if (!user.enabled) return res.json({ ok: false, msg: '账号已禁用' });

  // 兼容旧字段
  if(user.activeTime === undefined) user.activeTime = null;
  if(user.deviceFp === undefined) user.deviceFp = "";
  if(user.changeDeviceTimes === undefined) user.changeDeviceTimes = 1;
  if(user.sessionId === undefined) user.sessionId = "";
  if(user.days === undefined) user.days = null;

  // 未激活：首次登录才计算到期时间
  if(!user.activeTime){
    user.activeTime = now();
    if(user.days && user.days > 0){
      user.expireAt = new Date(Date.now() + user.days * 86400000).toISOString();
    }
  }

  // 已激活检查过期
  if(user.expireAt && Date.now() > new Date(user.expireAt).getTime()){
    return res.json({ ok: false, msg: '账号已过期' });
  }

  // 设备锁定判断
  if(user.deviceFp && user.deviceFp !== device_fp){
    if(user.changeDeviceTimes <= 0){
      return res.json({ ok: false, msg: '设备已锁定，请联系管理员解锁' });
    }else{
      user.changeDeviceTimes -= 1;
      user.deviceFp = device_fp;
    }
  }

  // 首次绑定设备
  if(!user.deviceFp){
    user.deviceFp = device_fp;
  }

  // 异地互踢 刷新会话
  const token = genToken();
  const sessionId = genSessionId();
  user.token = token;
  user.sessionId = sessionId;

  writeDB(db);
  res.json({ ok: true, token, sessionId });
});

// 原有token校验
app.post('/api/check', (req, res) => {
  const { username, token } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user || !user.enabled || !user.token || user.token !== token) return res.json({ ok: false });
  if (user.expireAt && Date.now() > new Date(user.expireAt).getTime()) return res.json({ ok: false });
  res.json({ ok: true });
});

// 前台权限校验
app.post('/api/check-auth', (req, res) => {
  const { username, device_fp } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);

  if(!user || !user.enabled){
    return res.json({ code: -99, msg: '账号不可用' });
  }
  if(!user.activeTime){
    return res.json({ code: 0, msg: '未激活' });
  }
  if(user.expireAt && Date.now() > new Date(user.expireAt).getTime()){
    return res.json({ code: -1, msg: '账号已过期' });
  }
  if(user.deviceFp && user.deviceFp !== device_fp){
    return res.json({ code: -2, msg: '设备不匹配' });
  }
  return res.json({ code: 0, msg: '验证通过' });
});

// 管理员-重置换绑次数
app.post('/api/admin/reset-device-times', (req, res) => {
  const { username } = req.body;
  const db = readDB();
  const user = db.find(x => x.username === username);
  if(!user) return res.json({ ok:false, msg:'用户不存在' });
  user.changeDeviceTimes = 1;
  writeDB(db);
  res.json({ ok:true });
});

// 管理员-强制下线
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

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { user, pwd } = req.body;
  if (user === admin.user && pwd === admin.pwd) return res.json({ ok: true });
  res.json({ ok: false });
});

// 核心：管理员列表 定制到期时间展示
app.get('/api/admin/list', (req, res) => {
  const db = readDB();
  db.forEach(item=>{
    if(item.activeTime === undefined) item.activeTime = null;
    if(item.deviceFp === undefined) item.deviceFp = "";
    if(item.changeDeviceTimes === undefined) item.changeDeviceTimes = 1;
    if(item.sessionId === undefined) item.sessionId = "";
    if(item.days === undefined) item.days = null;
  });

  // 克隆一份用于前台展示，不修改原数据库
  const showList = db.map(item => {
    const temp = {...item};
    // 未激活：显示天数
    if(!temp.activeTime){
      if(temp.days && temp.days > 0){
        temp.expireAt = temp.days + "天";
      }else{
        temp.expireAt = "永久";
      }
    }else{
      // 已激活 && 无天数 就是永久
      if(!temp.days || temp.days <= 0){
        temp.expireAt = "永久";
      }
      // 已激活有日期 正常显示原时间
    }
    return temp;
  });

  writeDB(db);
  res.json(showList);
});

// 删除用户
app.post('/api/admin/delete', (req, res) => {
  const { username } = req.body;
  let db = readDB().filter(x => x.username !== username);
  writeDB(db);
  res.json({ ok: true });
});

// 启用/禁用
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

// 批量创建账号（只存天数，不生成日期）
app.post('/api/admin/batch', (req, res) => {
  const { lines, days } = req.body;
  const db = readDB();
  const arr = lines.split(/\n/).map(x => x.trim()).filter(Boolean);
  let success = 0, exist = 0;

  for (const line of arr) {
    const [user, pwd] = line.split(/\s+/).filter(Boolean);
    if (!user || !pwd) continue;
    if (db.some(x => x.username === user)) { exist++; continue; }

    db.push({
      username: user,
      password: pwd,
      enabled: true,
      createdAt: now(),
      expireAt: null,
      token: null,
      activeTime: null,
      deviceFp: "",
      changeDeviceTimes: 1,
      sessionId: null,
      days: days > 0 ? days : null
    });
    success++;
  }

  writeDB(db);
  res.json({ ok: true, success, exist });
});

// 修改管理员密码
app.post('/api/admin/set-user-pwd', (req, res) => {
  const { newUser, newPwd } = req.body;
  if (newUser) admin.user = newUser;
  if (newPwd) admin.pwd = newPwd;
  res.json({ ok: true });
});

// 单独设置有效期
app.post('/api/admin/set-expire', (req, res) => {
  const { username, days } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: "用户不存在" });

  if (days <= 0) {
    user.days = null;
    user.expireAt = null;
  } else {
    user.days = days;
    // 已激活直接更新日期，未激活保持空，前台自动显示天数
    if(user.activeTime){
      user.expireAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
    }else{
      user.expireAt = null;
    }
  }

  writeDB(db);
  res.json({ ok: true });
});

// TikTok中转接口
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

// 双向保活
const keepAliveList = [
  "https://wallet-project-30bq.onrender.com/",
  "https://tiktok-data-acquisitio.onrender.com"
];

setInterval(() => {
  keepAliveList.forEach(url => {
    https.get(url).on('error', () => {});
  });
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ 服务运行正常'));
