const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(bodyParser.json());

// 数据库 & 接口池文件
const DB_FILE = path.join(__dirname, 'db.json');
const POOL_FILE = path.join(__dirname, 'pool.json');

// 不存在自动创建空文件
function initFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
}
initFile(DB_FILE);
initFile(POOL_FILE);

let admin = {
  user: "admin",
  pwd: "admin123"
};

// 浏览器伪装头
const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
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

// 接口池 自动补全所有字段 + 每日重置
function readPool(){
  if (!fs.existsSync(POOL_FILE)) {
    fs.writeFileSync(POOL_FILE, JSON.stringify([], null, 2));
  }
  let list = JSON.parse(fs.readFileSync(POOL_FILE,'utf8'));
  const today = new Date().toLocaleDateString();
  
  list.forEach(item=>{
    if(item.todayCount === undefined) item.todayCount = 0;
    if(item.totalCount === undefined) item.totalCount = 0;
    if(item.isWorking === undefined) item.isWorking = false;
    if(item.lastCallTime === undefined) item.lastCallTime = "";
    if(item.resetDate === undefined) item.resetDate = today;
    if(item.status === undefined) item.status = "normal";
    if(item.lastTestTime === undefined) item.lastTestTime = "";

    // 跨天清空今日次数
    if(item.resetDate !== today){
      item.todayCount = 0;
      item.resetDate = today;
    }
  });
  return list;
}
function writePool(list){
  fs.writeFileSync(POOL_FILE, JSON.stringify(list,null,2));
}

// ========== 下面用户登录接口全部保留不动 ==========
app.post('/api/admin/login', (req, res) => {
  const { user, pwd } = req.body;
  const db = readDB();
  if (user !== admin.user || pwd !== admin.pwd) {
    return res.json({ ok: false });
  }
  res.json({ ok: true });
});

// 省略一堆你原有用户管理接口 保留原样不动
app.get('/api/admin/list', (req, res) => {
  let db = readDB();
  db.forEach(item=>{
    if(item.activeTime === undefined) item.activeTime = null;
    if(item.deviceFp === undefined) item.deviceFp = "";
    if(item.changeDeviceTimes === undefined) item.changeDeviceTimes = 1;
    if(item.sessionId === undefined) item.sessionId = "";
    if(item.days === undefined) item.days = null;
  });
  const showList = db.map(item => {
    let temp = {...item};
    if(!temp.activeTime){
      temp.displayExpire = temp.days && temp.days > 0 ? `${temp.days}天` : "永久";
    }else{
      temp.displayExpire = temp.expireAt ? new Date(temp.expireAt).toLocaleString() : "永久";
    }
    return temp;
  });
  res.json(showList);
});

app.post('/api/admin/delete', (req, res) => {
  const { username } = req.body;
  let db = readDB().filter(x => x.username !== username);
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/toggle', (req, res) => {
  const { username, enabled } = req.body;
  let db = readDB();
  let u = db.find(x => x.username === username);
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

    db.push({
      username: user,
      password: pwd,
      enabled: true,
      createdAt: new Date().toISOString(),
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
    user.days = null;
    user.expireAt = null;
  } else {
    user.days = days;
    if(user.activeTime){
      user.expireAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
    }
  }

  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/reset-device-times', (req, res) => {
  const { username } = req.body;
  const db = readDB();
  let user = db.find(x => x.username === username);
  if(!user) return res.json({ ok:false, msg:'用户不存在' });
  user.changeDeviceTimes = 1;
  writeDB(db);
  res.json({ ok:true });
});

app.post('/api/admin/force-logout', (req, res) => {
  const { username } = req.body;
  const db = readDB();
  let user = db.find(x => x.username === username);
  if(user){
    user.token = null;
    user.sessionId = null;
  }
  writeDB(db);
  res.json({ ok:true });
});

// ========== 接口池管理接口 ==========
app.get('/api/admin/pool-list',(req,res)=>{
  res.json(readPool());
});

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
      status:"normal",
      lastTestTime:"",
      todayCount:0,
      totalCount:0,
      isWorking:false,
      lastCallTime:"",
      resetDate: new Date().toLocaleDateString()
    });
  }
  writePool(list);
  res.json({ok:true});
});

app.post('/api/admin/pool-del',(req,res)=>{
  let list = readPool();
  list = list.filter(x=>x.id !== req.body.id);
  writePool(list);
  res.json({ok:true});
});

// 单个检测
app.post('/api/admin/pool-test-one',async (req,res)=>{
  const {apiUrl} = req.body;
  let status = "normal";
  try{
    await axios.get(apiUrl,{
      timeout:8000,
      headers: browserHeaders,
      validateStatus: () => true
    });
  }catch(e){
    status = "banned";
  }
  let list = readPool();
  let item = list.find(x=>x.apiUrl===apiUrl);
  if(item){
    item.status = status;
    item.lastTestTime = now();
  }
  writePool(list);
  res.json({ok:true,status});
});

// 批量检测
app.post('/api/admin/pool-test-all',async (req,res)=>{
  let list = readPool();
  for(let item of list){
    let status = "normal";
    try{
      await axios.get(item.apiUrl,{
        timeout:8000,
        headers: browserHeaders,
        validateStatus: () => true
      });
    }catch(e){
      status = "banned";
    }
    item.status = status;
    item.lastTestTime = now();
  }
  writePool(list);
  res.json({ok:true});
});

// 自动检测开关
let autoCheckInterval = null;
const AUTO_CHECK_INTERVAL = 60 * 60 * 1000;

async function autoCheckPool(){
  let list = readPool();
  for(let item of list){
    let status = "normal";
    try{
      await axios.get(item.apiUrl,{
        timeout:8000,
        headers: browserHeaders,
        validateStatus: () => true
      });
    }catch(e){
      status = "banned";
    }
    item.status = status;
    item.lastTestTime = now();
  }
  writePool(list);
  console.log("✅ 定时自动检测完成");
}

app.post('/api/admin/set-auto-check',(req,res)=>{
  const {open} = req.body;
  if(open){
    if(autoCheckInterval) clearInterval(autoCheckInterval);
    autoCheckInterval = setInterval(autoCheckPool, AUTO_CHECK_INTERVAL);
    autoCheckPool();
  }else{
    if(autoCheckInterval){
      clearInterval(autoCheckInterval);
      autoCheckInterval = null;
    }
  }
  res.json({ok:true});
});

// ========== 核心：TikTok轮询接口【已修复第三方也计数】 ==========
app.get('/api/tiktok-rotate',async (req,res)=>{
  const {username} = req.query;
  if(!username) return res.json({success:false,msg:"缺少username参数"});

  let list = readPool();
  // 只拿正常可用的节点
  let avail = list.filter(x=>x.status === "normal");
  if(avail.length === 0){
    return res.json({success:false,msg:"暂无可用抓取节点"});
  }

  // 随机选一个
  let randomNode = avail[Math.floor(Math.random()*avail.length)];
  let idx = list.findIndex(x=>x.id === randomNode.id);

  // ========== 重点：第三方接口也一样计数 + 标记抓取中 ==========
  if(idx > -1){
    list[idx].isWorking = true;
    list[idx].todayCount += 1;
    list[idx].totalCount += 1;
    list[idx].lastCallTime = now();
    writePool(list);
  }

  try{
    // 拼接真实头像请求地址
    const targetUrl = `${randomNode.apiUrl}?username=${username}`;
    const result = await axios.get(targetUrl,{
      timeout:10000,
      headers: browserHeaders
    });

    // 请求成功 恢复空闲
    if(idx > -1){
      list[idx].isWorking = false;
      writePool(list);
    }

    res.json(result.data);
  }catch(e){
    // 请求失败 标记封禁 + 恢复空闲
    if(idx > -1){
      list[idx].status = "banned";
      list[idx].isWorking = false;
      writePool(list);
    }
    res.json({success:false,msg:"当前节点请求失败，已自动标记封禁"});
  }
});

// 保活
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
app.listen(PORT, () => {
  console.log('✅ 服务运行正常');
});
