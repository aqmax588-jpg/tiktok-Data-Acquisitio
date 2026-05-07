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

// 【新增】接口池存储文件
const POOL_FILE = path.join(__dirname, 'pool.json');
if (!fs.existsSync(POOL_FILE)) {
  fs.writeFileSync(POOL_FILE, JSON.stringify([], null, 2));
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

// 【新增】接口池工具方法
function readPool(){
  return JSON.parse(fs.readFileSync(POOL_FILE,'utf8'));
}
function writePool(list){
  fs.writeFileSync(POOL_FILE, JSON.stringify(list,null,2));
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

// 管理员列表（修正：解决Invalid Date问题，不破坏前端日期解析）
app.get('/api/admin/list', (req, res) => {
  const db = readDB();
  db.forEach(item=>{
    if(item.activeTime === undefined) item.activeTime = null;
    if(item.deviceFp === undefined) item.deviceFp = "";
    if(item.changeDeviceTimes === undefined) item.changeDeviceTimes = 1;
    if(item.sessionId === undefined) item.sessionId = "";
    if(item.days === undefined) item.days = null;
  });

  // 克隆一份数据，只在克隆对象上添加显示用的文本字段，不修改原expireAt
  const showList = db.map(item => {
    const temp = {...item};
    // 给前端单独加一个字段用于显示，不影响原expireAt
    if(!temp.activeTime){
      if(temp.days && temp.days > 0){
        temp.displayExpire = `${temp.days}天`;
      }else{
        temp.displayExpire = "永久";
      }
    }else{
      if(temp.expireAt){
        temp.displayExpire = new Date(temp.expireAt).toLocaleString();
      }else{
        temp.displayExpire = "永久";
      }
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
    // 已激活直接更新日期，未激活保持空
    if(user.activeTime){
      user.expireAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
    }else{
      user.expireAt = null;
    }
  }

  writeDB(db);
  res.json({ ok: true });
});

// 【原有老接口 完全保留不动】TikTok中转接口
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

// 【新增】接口池管理接口 - 获取列表
app.get('/api/admin/pool-list',(req,res)=>{
  res.json(readPool());
});

// 【新增】添加/编辑节点
app.post('/api/admin/pool-save',(req,res)=>{
  let list = readPool();
  const { id, apiUrl, remark } = req.body;
  if(id){
    let item = list.find(x=>x.id===id);
    if(item){
      item.apiUrl = apiUrl;
      item.remark = remark;
    }
  }else{
    list.push({
      id: Date.now(),
      apiUrl,
      remark,
      status:"unknown",
      lastTestTime:""
    });
  }
  writePool(list);
  res.json({ok:true});
});

// 【新增】删除节点
app.post('/api/admin/pool-del',(req,res)=>{
  let list = readPool();
  list = list.filter(x=>x.id !== req.body.id);
  writePool(list);
  res.json({ok:true});
});

// 【新增】单个测试节点是否被封
app.post('/api/admin/pool-test-one',async (req,res)=>{
  const {apiUrl} = req.body;
  let status = "banned";
  try{
    const testRes = await axios.get(apiUrl,{timeout:3000});
    if(testRes.data && (testRes.data.success || testRes.data.nickname)){
      status = "normal";
    }
  }catch(e){
    status = "timeout";
  }
  // 更新状态
  let list = readPool();
  let item = list.find(x=>x.apiUrl===apiUrl);
  if(item){
    item.status = status;
    item.lastTestTime = now();
  }
  writePool(list);
  res.json({ok:true,status});
});

// 【新增】批量全测
app.post('/api/admin/pool-test-all',async (req,res)=>{
  let list = readPool();
  for(let item of list){
    let status = "banned";
    try{
      const testRes = await axios.get(item.apiUrl,{timeout:3000});
      if(testRes.data && (testRes.data.success || testRes.data.nickname)){
        status = "normal";
      }
    }catch(e){
      status = "timeout";
    }
    item.status = status;
    item.lastTestTime = now();
  }
  writePool(list);
  res.json({ok:true});
});

// 【新增】定时自动检测任务 默认60分钟一次 可后台开关控制
let autoCheckInterval = null;
const AUTO_CHECK_INTERVAL = 60 * 60 * 1000; // 60分钟

// 自动检测执行函数
async function autoCheckPool(){
  let list = readPool();
  for(let item of list){
    let status = "banned";
    try{
      const testRes = await axios.get(item.apiUrl,{timeout:3000});
      if(testRes.data && (testRes.data.success || testRes.data.nickname)){
        status = "normal";
      }
    }catch(e){
      status = "timeout";
    }
    item.status = status;
    item.lastTestTime = now();
  }
  writePool(list);
  console.log("✅ 定时自动检测接口池完成");
}

// 【新增】开启/关闭定时检测
app.post('/api/admin/set-auto-check',(req,res)=>{
  const {open} = req.body;
  if(open){
    if(autoCheckInterval) clearInterval(autoCheckInterval);
    autoCheckInterval = setInterval(autoCheckPool, AUTO_CHECK_INTERVAL);
    // 立即执行一次
    autoCheckPool();
  }else{
    if(autoCheckInterval){
      clearInterval(autoCheckInterval);
      autoCheckInterval = null;
    }
  }
  res.json({ok:true});
});

// 【新增】统一轮换抓取新接口（主入口，自动随机调用可用子IP）
app.get('/api/tiktok-rotate',async (req,res)=>{
  const {username} = req.query;
  if(!username) return res.json({success:false,msg:"缺少username参数"});

  let list = readPool();
  // 只筛选正常可用节点
  let avail = list.filter(x=>x.status === "normal");
  if(avail.length === 0){
    return res.json({success:false,msg:"暂无可用抓取节点，请后台检查接口池"});
  }

  // 随机选一个
  let randomNode = avail[Math.floor(Math.random()*avail.length)];
  try{
    const targetUrl = `${randomNode.apiUrl}/get-avatar?username=${username}`;
    const result = await axios.get(targetUrl,{timeout:8000});
    res.json(result.data);
  }catch(e){
    // 抓取失败标记为封禁
    let idx = list.findIndex(x=>x.id === randomNode.id);
    if(idx>-1){
      list[idx].status = "banned";
      writePool(list);
    }
    res.json({success:false,msg:"当前节点抓取失败，已自动标记封禁，请重试"});
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
