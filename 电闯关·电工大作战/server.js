/* ============================================================
 * 电闯关·电工大作战 — 服务端（零依赖 Node.js + JSON 数据库，1.0.0.5）
 * 《电工技术基础与技能（第4版）》周绍敏主编 动作闯关游戏
 * 运行：node server.js   (或双击 start.bat / 电闯关服务端.exe)
 * 端口：8123（默认，可用环境变量 PORT 修改）
 * 数据：data/db.json（业务数据）+ data/questions.json（题库）
 * 1.0.0.4：服务端判分（试卷令牌 pt + HMAC 签名），客户端不再接触答案
 * 1.0.0.5：题库模板导出/导入查重/批量删除/难度标注；关卡题目数量与自动计时；
 *          按章节/难度/掌握情况组卷并导出 Word 可打印试卷；教师可修改游戏名称
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const acc = require('./store.js');

const PORT = process.env.PORT || 8123;
const VERSION = '1.4.5.1';
const ROOT = acc.APP_DIR;
const PUBLIC_DIR = path.join(ROOT, 'public');
/* 试卷令牌密钥（进程启动时随机生成，重启后旧令牌自然失效） */
const PAPER_SECRET = crypto.randomBytes(32);

/* 填空题答案匹配（与前端 Norm.answerMatch 同规则） */
function normText(s) {
  let t = String(s == null ? '' : s).trim().replace(/[\s_　]+/g, '').toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  /* 1.4.5.1：科学计数法归一（3.6×10⁶ / 10⁶ → e 记法，兼容用户输入 3600000 / 3.6e6） */
  const SUP = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-','⁺':'+' };
  t = t.replace(/(\d+(?:\.\d+)?)\s*[×x]\s*10\s*([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/g, (m, a, b) => a + 'e' + b.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, c => SUP[c]));
  t = t.replace(/(^|[^0-9.×x])10\s*([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/g, (m, a, b) => a + '1e' + b.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, c => SUP[c]));
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, c => SUP[c]);
  t = t.replace(/(\d+(?:\.\d+)?)\s*[×x]\s*10\s*([+-]?\d+)/g, '$1e$2');
  return t;
}
function answerMatch(user, correct) {
  const a = normText(user), b = normText(correct);
  if (!a || !b) return false;
  if (a === b) return true;
  // 多空题：标准答案以中文分号分隔，学生答对任一分段即判对
  if (b.includes('；')) {
    return b.split('；').map(s => normText(s)).filter(Boolean).some(x => x === a);
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(b) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(a)) {
    const av = parseFloat(a), bv = parseFloat(b);
    if (bv === 0) return av === 0;
    return Math.abs(av - bv) / Math.abs(bv) <= 0.01;
  }
  return false;
}

/* ---------------- 试卷令牌（防伪造/防答案泄露） ---------------- */
/* 签发：把每题的选项乱序映射 perm 打包签名；判分时凭 perm 把客户端提交的
 * 下标还原为题库原始下标再比对答案。令牌绑定用户、12 小时过期。 */
function makePaper(userId, entries) {
  const payload = Buffer.from(JSON.stringify({ u: userId, q: entries, e: Date.now() + 12 * 3600e3 }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', PAPER_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function readPaper(userId, pt) {
  if (typeof pt !== 'string' || pt.indexOf('.') < 0) return null;
  const dot = pt.lastIndexOf('.');
  const payload = pt.slice(0, dot), sig = pt.slice(dot + 1);
  const expect = crypto.createHmac('sha256', PAPER_SECRET).update(payload).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let o = null;
  try { o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!o || o.u !== userId || !Array.isArray(o.q) || !o.e || Date.now() > o.e) return null;
  return o;
}
/* 选项乱序（记录映射），perm[i] = 发送下标 i 对应的题库原始下标 */
function shuffleWithPerm(opts, rand) {
  const idxs = shuffle(opts.map((_, i) => i), rand);
  return { opts: idxs.map(i => opts[i]), perm: idxs };
}
/* 判分：按题型比对 choice 与题库答案 */
function judgeAnswer(qq, entry, choice) {
  if (qq.type === 'single' || qq.type === 'judge') {
    return Number.isInteger(choice) && entry.perm && entry.perm[choice] === qq.answer.charCodeAt(0) - 65;
  }
  if (qq.type === 'multi') {
    if (!Array.isArray(choice) || !entry.perm) return false;
    const letters = String(qq.answer).split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const want = letters.map(l => l.charCodeAt(0) - 65).sort((x, y) => x - y);
    let sel;
    try { sel = choice.map(i => entry.perm[i]); } catch (e) { return false; }
    if (sel.some(i => !Number.isInteger(i))) return false;
    sel.sort((x, y) => x - y);
    return want.length === sel.length && want.every((v, i) => v === sel[i]);
  }
  if (qq.type === 'fill' || qq.type === 'calc') {
    return typeof choice === 'string' && choice.trim().length > 0 && answerMatch(choice, String(qq.answer));
  }
  if (qq.type === 'matching') {
    let okPairs = [];
    try { okPairs = JSON.parse(qq.answer || '[]'); } catch (e) { okPairs = []; }
    if (!Array.isArray(choice) || choice.length !== okPairs.length) return false;
    return okPairs.every(pr => Array.isArray(pr) && choice.some(u2 => Array.isArray(u2) && Number.isInteger(u2[0]) && Number.isInteger(u2[1]) && u2[0] === pr[0] && u2[1] === pr[1]));
  }
  return false;
}
/* 答案展示文本（判分后回传给客户端显示） */
function displayAnswer(qq) {
  if (qq.type === 'fill') return String(qq.answer);
  if (qq.type === 'matching') return '配对题：' + String(qq.answer || '');
  return String(qq.answer);
}

/* 内存业务数据 = store 载入的 state（users/sessions/progress/wrongs/memoryBest/logs/questions） */
const db = acc.state;
let questions = acc.state.questions;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function uid() { return crypto.randomBytes(8).toString('hex'); }
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- 数据初始化 ---------------- */
/* 教师账号由 acc.init() 中的 ensureTeacher 保证存在（teacher / 123456） */

/* 题库与章节结构（对应教材 导言 + 11 章） */
const CHAPTERS = [
  { id: 0, name: '导言', sub: '安全用电与职业素养', icon: '🛡️' },
  { id: 1, name: '认识电路', sub: '电路·电流·电阻·欧姆定律·电能电功率', icon: '💡' },
  { id: 2, name: '简单直流电路', sub: '闭合电路欧姆定律·串并联混联·万用表·电位', icon: '🔌' },
  { id: 3, name: '复杂直流电路', sub: '基尔霍夫定律·支路电流法·叠加·戴维宁', icon: '🧮' },
  { id: 4, name: '电容', sub: '电容器·连接·充放电', icon: '⚡' },
  { id: 5, name: '磁场和磁路', sub: '电流磁效应·磁感应强度·安培力', icon: '🧲' },
  { id: 6, name: '电磁感应', sub: '感应电动势·楞次定律·自感互感', icon: '🌀' },
  { id: 7, name: '初识正弦交流电', sub: '产生·物理量·表示法', icon: '〰️' },
  { id: 8, name: '正弦交流电路', sub: '纯R/L/C·RL/RC/RLC·功率', icon: '📈' },
  { id: 9, name: '谐振电路', sub: '串联谐振·并联谐振', icon: '🎵' },
  { id: 10, name: '三相正弦交流电路', sub: '三相电源·负载连接·功率·安全用电·变压器', icon: '🏭' },
  { id: 11, name: '瞬态过程', sub: '换路定律·RC/RL瞬态', icon: '⏱️' },
  { id: 12, name: '物理量识记', sub: '物理量·符号·单位·换算关系', icon: '📐' }
];
/* 各章"节"名称（与题库 section 字段对应，节序号从 1 开始） */
const SECTION_NAMES = {
  0: ['安全用电常识', '电气安全防护'],
  1: ['电路与电路模型', '电流与电压', '电阻与欧姆定律', '电能与电功率'],
  2: ['闭合电路欧姆定律', '电阻的连接', '测量仪表'],
  3: ['基尔霍夫定律', '叠加定理', '等效变换与戴维宁定理'],
  4: ['电容器与电容', '电容器的连接', '充放电与电场能'],
  5: ['磁场与磁感应强度', '磁场对电流的作用', '磁路与磁性材料'],
  6: ['电磁感应现象与楞次定律', '导体切割磁感线', '自感与互感', '变压器与涡流'],
  7: ['正弦交流电的产生', '周期频率与三要素', '有效值', '相位与波形'],
  8: ['纯电阻电感电容电路', '阻抗与RLC串联电路', '功率与功率因数'],
  9: ['串联谐振', '并联谐振与应用'],
  10: ['三相电源与连接', '三相负载与功率', '变压器', '安全用电与电气设备'],
  11: ['换路定律', 'RC电路与时间常数', 'RL电路与瞬态概述'],
  12: ['物理量与符号', '单位与换算']
};
/* 每章关卡配置：3 关 + 1 BOSS */
const LEVELS = [
  { id: 1, name: '入门测试', q: 6, time: 20 },
  { id: 2, name: '技能进阶', q: 8, time: 18 },
  { id: 3, name: '实战演练', q: 10, time: 16 },
  { id: 'boss', name: '章节霸主', q: 5, time: 15 }
];

/* ---------------- 鉴权 ---------------- */
function findUser(id) { return db.users.find(u => u.id === id) || null; }
function userByToken(token) {
  if (!token || !db.sessions[token]) return null;
  return findUser(db.sessions[token]);
}
function createToken(userId) {
  const t = uid() + uid();
  db.sessions[t] = userId;
  return t;
}
async function register(name, pass) {
  if (!name || !pass) return { err: '用户名和密码不能为空' };
  if (String(name).trim().length < 1 || String(name).trim().length > 16) return { err: '用户名长度应为 1~16 个字符' };
  if (String(pass).length < 4 || String(pass).length > 20) return { err: '密码长度应为 4~20 位' };
  if (db.users.some(u => u.name === String(name).trim())) return { err: '该姓名已注册，如需重置密码请联系老师' };
  const salt = uid();
  const user = {
    id: uid(), name: String(name).trim(), salt,
    pass: sha256(salt + pass), role: 'student',
    score: 0, reg: Date.now(), lastLogin: 0, loginCount: 0,
    correct: 0, total: 0
  };
  db.users.push(user);
  await acc.insertUser(user);
  return user;
}
async function login(name, pass) {
  const user = db.users.find(u => u.name === name);
  if (!user) return { err: '用户名不存在' };
  if (user.pass !== sha256(user.salt + pass)) return { err: '密码错误' };
  user.lastLogin = Date.now();
  user.loginCount = (user.loginCount || 0) + 1;
  const token = createToken(user.id);
  await acc.updateUser(user);
  await acc.upsertSession(token, user.id);
  // 1.0.0.4：默认弱密码提示（teacher/123456 或测试账号初始密码）
  const weakPass = user.pass === sha256(user.salt + '123456') || user.pass === sha256(user.salt + '1234');
  return { token, user: publicUser(user), weakPass: !!weakPass };
}
function publicUser(u) {
  const progress = db.progress[u.id] || {};
  let stars = 0, cleared = 0;
  CHAPTERS.forEach(c => {
    const p = progress[c.id] || {};
    const vals = Object.values(p).filter(v => typeof v === 'number');
    if (vals.length) { stars += vals.reduce((s, v) => s + v, 0); if (vals.some(v => v >= 1)) cleared++; }
  });
  return {
    id: u.id, name: u.name, role: u.role, score: u.score,
    reg: u.reg, lastLogin: u.lastLogin, loginCount: u.loginCount,
    correct: u.correct, total: u.total,
    progress, stars, cleared, memoryBest: db.memoryBest[u.id] || 0
  };
}
function rankOf(score) {
  if (score >= 5000) return '电工技师';
  if (score >= 3000) return '高级电工';
  if (score >= 1500) return '中级电工';
  if (score >= 500) return '初级电工';
  return '新手电工';
}

/* ---------------- 题库操作 ---------------- */
/* 抽题并剥离答案；返回 { list: 下发题目, entries: 试卷条目(id+perm) } */
function pickQuestions(chapter, limit, userId, allowTypes) {
  const pool = questions.filter(q => q.chapter === chapter && allowTypes.includes(q.type));
  if (!pool.length) return { list: [], entries: [] };
  const recent = (db.wrongs[userId] || []).map(w => w.qid);
  let cand = pool.filter(q => !recent.includes(q.id));
  if (cand.length < limit) cand = pool;
  const seed = (userId ? userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : 7) + chapter * 131 + limit * 17 + Date.now() % 1000;
  const rand = mulberry32(seed);
  const picked = shuffle(cand, rand).slice(0, limit);
  const list = [], entries = [];
  for (const q of picked) {
    if (q.type === 'matching') {
      // 连线题：左右列原样下发（答案不下发，提交配对后由服务端判定）
      list.push({ id: q.id, chapter: q.chapter, type: q.type, question: q.question, options: q.options || { left: [], right: [] }, explain: q.explain || '', image: q.image || '', imageAlign: q.imageAlign || 'center', imgSize: q.imgSize || 60 });
      entries.push({ id: q.id, perm: null });
      continue;
    }
    const sp = shuffleWithPerm(q.options, rand);
    list.push({
      id: q.id, chapter: q.chapter, type: q.type,
      question: q.question, options: sp.opts,
      explain: q.explain || '',
      image: q.image || '', imageAlign: q.imageAlign || 'center', imgSize: q.imgSize || 60
    });
    entries.push({ id: q.id, perm: q.type === 'fill' ? null : sp.perm });
  }
  return { list, entries };
}

/* ---------------- HTTP 处理 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

/* 1.4.3.0：从网页 HTML 中提取题目（题干/选项/答案），供"网页抓题"使用 */
function extractQuestionsFromHtml(html, baseUrl) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\u3000/g, ' ');
  const lines = text.split(/\n+/).map(s => s.replace(/^\s+|\s+$/g, '')).filter(Boolean);
  const out = [];
  let cur = null;
  for (const ln of lines) {
    const mNum = ln.match(/^(\d{1,3})[、.．)）]\s*(.+)$/);
    if (mNum) {
      if (cur && (cur.question || cur.options.length)) out.push(cur);
      cur = { num: parseInt(mNum[1], 10), question: mNum[2].replace(/[（(]\s*[）)]\s*$/, '').trim(), options: [], answer: '', type: '' };
      continue;
    }
    if (!cur) continue;
    const mOpt = ln.match(/^([A-H])[.、．)）]\s*(.+)$/);
    if (mOpt && mOpt[2].trim().length > 1 && !/^(正确|错误|对|错|√|×|是|否)$/i.test(mOpt[2].trim())) {
      cur.options.push({ k: mOpt[1].toUpperCase(), v: mOpt[2].trim() });
      continue;
    }
    const mAns = ln.match(/^(?:答案|参考答案|正确答案|【答案】)\s*[:：]?\s*(.+)$/i);
    if (mAns) { cur.answer = mAns[1].trim().replace(/^[（(]|[）)]$/g, ''); continue; }
    const mTp = ln.match(/^(?:题型|类型)\s*[:：]\s*(.+)$/i);
    if (mTp) { cur.type = mTp[1].trim(); continue; }
    // 其余行：若已有完整题干/选项则并入说明；否则并入题干
    if (cur.question && (cur.options.length || cur.answer)) cur.raw = (cur.raw || []).concat(ln);
    else if (!cur.question) cur.question = ln;
  }
  if (cur && (cur.question || cur.options.length)) out.push(cur);
  // 规范化：单选（≥2选项）、判断（无选项/选项为正确错误）、填空、简答（无选项）
  return out.map(x => {
    let type = 'single';
    let options = x.options.map(o => o.v);
    const q = x.question.replace(/\s+/g, ' ').trim();
    if (!options.length) {
      if (/(正确|错误|对错|√|×)/.test(q) || /[（(]\s*[）)]\s*$/.test(x.question)) { type = 'judge'; options = ['正确', '错误']; }
      else if (x.answer && x.answer.length <= 12) type = 'fill';
      else type = 'calc';
    }
    let answer = x.answer;
    if (type === 'single' && answer && !/^[A-H]$/i.test(answer)) {
      const idx = x.options.findIndex(o => o.v === answer.trim());
      if (idx >= 0) answer = String.fromCharCode(65 + idx);
    }
    if (type === 'judge' && answer) {
      if (/^(对|正确|√|是|T)$/i.test(answer)) answer = 'A';
      else if (/^(错|错误|×|否|F)$/i.test(answer)) answer = 'B';
    }
    return { num: x.num, type, question: q, options, answer, explain: '', difficulty: type === 'single' || type === 'judge' ? 2 : 3 };
  }).filter(x => x.question && x.question.length > 3);
}
/* 1.4.3.0：抓取远程网页（含重定向跟随，限制 2MB） */
function fetchUrl(url, maxRedirects) {
  const redirects = maxRedirects == null ? 3 : maxRedirects;
  return new Promise((resolve, reject) => {
    const mod = url.toLowerCase().startsWith('https') ? require('https') : require('http');
    const req2 = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
      timeout: 20000
    }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        if (redirects <= 0) { reject(new Error('重定向次数过多')); return; }
        const next = new URL(r.headers.location, url).toString();
        r.resume();
        return resolve(fetchUrl(next, redirects - 1));
      }
      if (r.statusCode >= 400) { reject(new Error('网页返回 HTTP ' + r.statusCode)); return; }
      const ctype = r.headers['content-type'] || '';
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { data += c; if (data.length > 2 * 1024 * 1024) { r.destroy(); reject(new Error('页面过大（>2MB）')); } });
      r.on('end', () => resolve({ html: data, contentType: ctype }));
      r.on('error', reject);
    });
    req2.on('timeout', () => { req2.destroy(new Error('抓取超时')); });
    req2.on('error', reject);
  });
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const q = u.searchParams;
  try {
    /* ---------------- 静态资源 ---------------- */
    if (req.method === 'GET' && p.startsWith('/api/') === false) {
      let file;
      if (p.startsWith('/uploads/')) {
        file = path.normalize(path.join(acc.DATA_DIR, decodeURIComponent(p.replace(/^\/uploads\//, ''))));
        if (!file.startsWith(acc.DATA_DIR)) { sendJSON(res, 403, { err: 'forbidden' }); return; }
      } else {
        file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : decodeURIComponent(p)));
      }
      if (!file.startsWith(PUBLIC_DIR)) { sendJSON(res, 403, { err: 'forbidden' }); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h1>404 Not Found</h1>'); return; }
        const ext = path.extname(file).toLowerCase();
        const base = path.basename(file);
        /* 版本号注入：html 与 sw.js 中的 __VERSION__ 占位符替换为当前版本，
           使资源URL与PWA缓存名随版本升级自动变化，避免浏览器缓存旧版页面/脚本 */
        if (ext === '.html' || base === 'sw.js') {
          fs.readFile(file, 'utf8', (e2, txt) => {
            if (e2) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('read error'); return; }
            const out = txt.split('__VERSION__').join(VERSION);
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(out);
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        fs.createReadStream(file).pipe(res);
      });
      return;
    }

    /* ---------------- API ---------------- */
    const auth = (role) => {
      const token = req.headers['x-token'] || q.get('token');
      const user = userByToken(token);
      if (!user) return { err: '未登录或登录已失效' };
      if (role && user.role !== role) return { err: '无权限操作' };
      return { user };
    };

    // 注册
    if (p === '/api/register' && req.method === 'POST') {
      const body = await readBody(req);
      const user = await register(body.name, body.password);
      if (user.err) return sendJSON(res, 400, { err: user.err });
      const token = createToken(user.id);
      await acc.upsertSession(token, user.id);
      return sendJSON(res, 200, { token, user: publicUser(user) });
    }
    // 登录
    if (p === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const r = await login(body.name, body.password);
      if (r.err) return sendJSON(res, 401, { err: r.err });
      return sendJSON(res, 200, r);
    }
    // 章节与关卡配置（含使用单位）
    if (p === '/api/meta') {
      return sendJSON(res, 200, { chapters: CHAPTERS, levels: LEVELS, unit: db.settings.unit || '', gameName: db.settings.gameName || '电闯关·电工大作战', version: db.settings.version || 'V2.0', dbType: 'JSON数据库版', settings: db.settings || {} });
    }
    // 当前用户信息
    if (p === '/api/me' && req.method === 'GET') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      return sendJSON(res, 200, { user: publicUser(a.user) });
    }
    // 取题（按章节+关卡数量随机）
    if (p === '/api/questions' && req.method === 'GET') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const chapter = parseInt(q.get('chapter'), 10);
      const levelRaw = q.get('level') || '';
      const level = levelRaw === 'boss' ? 'boss' : parseInt(levelRaw, 10);
      const cfg = Object.assign({}, LEVELS.find(l => l.id === level));
      /* 1.0.0.5：关卡题数与每题基础时间可由教师配置（settings.levelQ / levelTimeBase） */
      const LQ = objSetting('levelQ', {});
      const LTB = objSetting('levelTimeBase', {});
      const key = String(level);
      if (LQ[key] != null) cfg.q = Math.max(1, Math.min(30, parseInt(LQ[key], 10) || cfg.q));
      if (LTB[key] != null) cfg.time = Math.max(5, Math.min(180, parseInt(LTB[key], 10) || cfg.time));
      const ta = parseInt(db.settings.timeAdd, 10);
      cfg.time = cfg.time + (isNaN(ta) ? 5 : ta);
      if (!CHAPTERS.find(c => c.id === chapter) || !cfg) return sendJSON(res, 400, { err: '参数错误' });
      const allowTypes = level === 1 ? ['single', 'judge'] : ['single', 'judge', 'multi', 'fill', 'matching', 'calc'];
      const picked = pickQuestions(chapter, cfg.q, a.user.id, allowTypes);
      if (!picked.list.length) return sendJSON(res, 404, { err: '该章节暂无可用题目，请联系老师在题库中添加' });
      return sendJSON(res, 200, { questions: picked.list, cfg, pt: makePaper(a.user.id, picked.entries) });
    }
    // 提交答题结果（累计正确/错题/积分）
    if (p === '/api/answer' && req.method === 'POST') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      /* 1.0.0.4：服务端判分。凭试卷令牌还原题目与选项映射，客户端提交 choice */
      const paper = readPaper(a.user.id, body.pt);
      const entry = paper ? paper.q.find(e => e.id === body.qid) : null;
      const qq = entry ? questions.find(x => x.id === entry.id) : null;
      if (!qq || !entry) return sendJSON(res, 400, { err: '答题会话无效，请重新进入关卡' });
      const correct = judgeAnswer(qq, entry, body.choice === undefined ? null : body.choice);
      const mode = body.mode === 'practice' ? 'practice' : 'game';
      let delta = 0;
      if (mode === 'practice') delta = correct ? 50 : 0;
      else if (correct) {
        const combo = Math.max(1, Math.min(50, parseInt(body.combo, 10) || 1));
        const tLeft = Math.max(0, Math.min(300, Number(body.tLeft) || 0));
        delta = Math.min(1000, 100 + 50 * (combo - 1) + Math.round(tLeft * 2));
      } else delta = -30;
      const user = a.user;
      user.total = (user.total || 0) + 1;
      // 记录每题答题明细（成绩分析用：全班正确率、对/错名单、掌握情况）
      {
        db.answerLogs.push({ t: Date.now(), userId: user.id, name: user.name, qid: body.qid, chapter: qq.chapter, section: qq.section || 1, correct });
        if (db.answerLogs.length > 200000) db.answerLogs = db.answerLogs.slice(-200000);
        await acc.logAnswer(db.answerLogs[db.answerLogs.length - 1]);
      }
      user.score = Math.max(0, (user.score || 0) + delta);
      if (correct) {
        user.correct = (user.correct || 0) + 1;
        // 答对：错题本记一次"最近答对"，连续两次答对则移除
        const wr = db.wrongs[user.id] || [];
        const hit = wr.find(w => w.qid === body.qid);
        if (hit) {
          hit.good = (hit.good || 0) + 1;
          if (hit.good >= 2) {
            db.wrongs[user.id] = wr.filter(w => w.qid !== body.qid);
            await acc.removeWrong(user.id, body.qid);
          } else {
            await acc.upsertWrong(user.id, hit);
          }
        }
      } else {
        const wr = db.wrongs[user.id] || [];
        const hit = wr.find(w => w.qid === body.qid);
        if (hit) { hit.count = (hit.count || 0) + 1; hit.last = Date.now(); hit.good = 0; await acc.upsertWrong(user.id, hit); }
        else {
          const nw = { qid: body.qid, chapter: qq.chapter, count: 1, last: Date.now(), good: 0 };
          wr.push(nw);
          db.wrongs[user.id] = wr.slice(0, 300);
          await acc.upsertWrong(user.id, nw);
        }
        // 超出 300 条的错题同步删除
        if (wr.length > 300) {
          const extra = wr.slice(300);
          for (const w of extra) await acc.removeWrong(user.id, w.qid);
        }
      }
      await acc.updateUser(user);
      return sendJSON(res, 200, {
        user: publicUser(user),
        correct, delta,
        answer: correct ? undefined : displayAnswer(qq),
        explain: qq.explain || ''
      });
    }
    // 保存关卡进度（星星，服务端钳制 0~3）
    if (p === '/api/progress' && req.method === 'POST') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const stars = Math.max(0, Math.min(3, parseInt(body.stars, 10) || 0));
      const cp = db.progress[a.user.id] || {};
      const ch = cp[body.chapter] || {};
      const key = String(body.level) === 'boss' ? 'boss' : 'lv' + body.level;
      if (stars > 0 && (ch[key] === undefined || stars > ch[key])) ch[key] = stars;
      cp[body.chapter] = ch;
      db.progress[a.user.id] = cp;
      await acc.upsertProgress(a.user.id, Number(body.chapter), key, ch[key]);
      return sendJSON(res, 200, { user: publicUser(a.user) });
    }
    // 排行榜
    if (p === '/api/leaderboard') {
      const list = db.users.filter(u => u.role === 'student')
        .map(u => ({ name: u.name, score: u.score, correct: u.correct, total: u.total, cleared: (db.progress[u.id] ? Object.keys(db.progress[u.id]).length : 0) }))
        .sort((a, b) => b.score - a.score).slice(0, 30);
      return sendJSON(res, 200, { list });
    }
    // 我的错题
    if (p === '/api/wrong' && req.method === 'GET') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const wr = db.wrongs[a.user.id] || [];
      const list = wr.map(w => {
        const qq = questions.find(x => x.id === w.qid);
        return qq ? { ...qq, wrong: w } : null;
      }).filter(Boolean);
      return sendJSON(res, 200, { list });
    }
    // 错题重练：取 5 道错题（随机，答案不下发，判分走 /api/answer mode=practice）
    if (p === '/api/wrong/practice' && req.method === 'GET') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const wr = db.wrongs[a.user.id] || [];
      if (!wr.length) return sendJSON(res, 200, { list: [], pt: '' });
      const rand = mulberry32(Date.now() % 99999);
      const picks = shuffle(wr, rand).slice(0, 5);
      const list = [], entries = [];
      for (const w of picks) {
        const qq = questions.find(x => x.id === w.qid);
        if (!qq) continue;
        if (qq.type === 'matching') {
          list.push({ id: qq.id, chapter: qq.chapter, type: qq.type, question: qq.question, options: qq.options || { left: [], right: [] }, explain: qq.explain || '', image: qq.image || '', imageAlign: qq.imageAlign || 'center', imgSize: qq.imgSize || 60 });
          entries.push({ id: qq.id, perm: null });
          continue;
        }
        const sp = shuffleWithPerm(qq.options, rand);
        list.push({ id: qq.id, chapter: qq.chapter, type: qq.type, question: qq.question, options: sp.opts, explain: qq.explain || '', image: qq.image || '', imageAlign: qq.imageAlign || 'center', imgSize: qq.imgSize || 60 });
        entries.push({ id: qq.id, perm: qq.type === 'fill' ? null : sp.perm });
      }
      return sendJSON(res, 200, { list, pt: makePaper(a.user.id, entries) });
    }
    // 物理量识记数据
    if (p === '/api/memory') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      return sendJSON(res, 200, { best: db.memoryBest[a.user.id] || 0 });
    }
    // 识记测验提交（服务端钳制：best 0~100 分、单次积分 gain 0~100）
    if (p === '/api/memory/score' && req.method === 'POST') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const best = Math.max(0, Math.min(100, Number(body.score) || 0));
      if (best > (db.memoryBest[a.user.id] || 0)) {
        db.memoryBest[a.user.id] = best;
        await acc.setMemoryBest(a.user.id, best);
      }
      const gain = Math.max(0, Math.min(100, parseInt(body.gain, 10) || 0));
      a.user.score = (a.user.score || 0) + gain;
      await acc.updateUser(a.user);
      return sendJSON(res, 200, { user: publicUser(a.user), best: db.memoryBest[a.user.id] || 0 });
    }

    /* ---------------- 教师端 ---------------- */
    // 学生列表
    if (p === '/api/users' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const list = db.users.filter(u => u.role === 'student').map(u => ({
        id: u.id, name: u.name, score: u.score, reg: u.reg, lastLogin: u.lastLogin,
        loginCount: u.loginCount, correct: u.correct, total: u.total,
        stars: publicUser(u).stars, cleared: publicUser(u).cleared,
        wrongCount: (db.wrongs[u.id] || []).length
      })).sort((a, b) => b.score - a.score);
      return sendJSON(res, 200, { list });
    }
    // 重置密码
    if (p === '/api/users/reset' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const user = findUser(body.id);
      if (!user) return sendJSON(res, 404, { err: '用户不存在' });
      user.salt = uid();
      user.pass = sha256(user.salt + (body.password || '123456'));
      db.logs.push({ t: Date.now(), op: '重置密码', name: user.name, by: a.user.name });
      await acc.updateUser(user);
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1 });
    }
    // 删除学生
    if (p === '/api/users' && req.method === 'DELETE') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const idx = db.users.findIndex(u => u.id === body.id && u.role === 'student');
      if (idx < 0) return sendJSON(res, 404, { err: '用户不存在' });
      const name = db.users[idx].name;
      db.users.splice(idx, 1);
      delete db.progress[body.id];
      delete db.wrongs[body.id];
      delete db.memoryBest[body.id];
      // 1.0.0.4：同步清理答题明细，避免成绩分析出现孤儿数据
      db.answerLogs = db.answerLogs.filter(l => l.userId !== body.id);
      db.logs.push({ t: Date.now(), op: '删除学生', name, by: a.user.name });
      await acc.deleteUser(body.id);
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1 });
    }
    // 教师加减分
    if (p === '/api/score' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const user = findUser(body.id);
      if (!user) return sendJSON(res, 404, { err: '用户不存在' });
      const delta = Math.max(-1000, Math.min(1000, parseInt(body.delta, 10) || 0));
      user.score = (user.score || 0) + delta;
      db.logs.push({ t: Date.now(), op: (delta >= 0 ? '加分' : '减分') + (delta >= 0 ? '+' : '') + delta, name: user.name, by: a.user.name, reason: body.reason || '' });
      await acc.updateUser(user);
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { user: publicUser(user) });
    }
    // 成绩分析-群体
    if (p === '/api/analysis/class') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const students = db.users.filter(u => u.role === 'student');
      const rows = students.map(u => {
        const total = u.total || 0;
        const acc = total ? Math.round(u.correct / total * 100) : 0;
        return { name: u.name, score: u.score, total, correct: u.correct, acc, stars: publicUser(u).stars, grade: acc >= 90 ? '优' : acc >= 75 ? '良' : acc >= 60 ? '中' : '差' };
      }).sort((a, b) => b.acc - a.acc || b.score - a.score);
      const gradeCount = { 优: 0, 良: 0, 中: 0, 差: 0 };
      rows.forEach(r => gradeCount[r.grade]++);
      const avgAcc = rows.length ? Math.round(rows.reduce((s, r) => s + r.acc, 0) / rows.length) : 0;
      return sendJSON(res, 200, { rows, gradeCount, avgAcc, count: rows.length });
    }
    // 成绩分析-单人
    if (p === '/api/analysis/student') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const id = q.get('id');
      const user = findUser(id);
      if (!user) return sendJSON(res, 404, { err: '用户不存在' });
      const progress = db.progress[id] || {};
      const wrongs = (db.wrongs[id] || []).length;
      const chapterStars = CHAPTERS.map(c => {
        const p = progress[c.id] || {};
        const total = Object.values(p).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
        return { chapter: c.id, name: c.name, stars: total };
      });
      const acc = user.total ? Math.round(user.correct / user.total * 100) : 0;
      return sendJSON(res, 200, {
        user: { name: user.name, score: user.score, total: user.total, correct: user.correct, acc, wrongs, reg: user.reg, lastLogin: user.lastLogin, loginCount: user.loginCount },
        chapterStars, grade: acc >= 90 ? '优' : acc >= 75 ? '良' : acc >= 60 ? '中' : '差'
      });
    }
    // 成绩分析-每章（含每节正确率 + 每题对/错名单）
    if (p === '/api/analysis/chapter') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const ch = parseInt(q.get('chapter'), 10);
      const chapter = CHAPTERS.find(c => c.id === ch);
      if (!chapter) return sendJSON(res, 400, { err: '章节无效' });
      const chQs = questions.filter(x => x.chapter === ch);
      const logs = db.answerLogs.filter(l => l.chapter === ch && ((db.users.find(u => u.id === l.userId) || {}).role === 'student'));
      const sectionNames = SECTION_NAMES[ch] || [];
      // 每题聚合
      const qStats = chQs.map(qq => {
        const ls = logs.filter(l => l.qid === qq.id);
        const okSet = new Set(), badSet = new Set();
        ls.forEach(l => { if (l.correct) okSet.add(l.name); else badSet.add(l.name); });
        const total = okSet.size + badSet.size;
        return {
          id: qq.id, section: qq.section || 1, type: qq.type, question: qq.question,
          answered: total, correct: okSet.size, wrong: badSet.size,
          acc: total ? Math.round(okSet.size / total * 100) : null,
          correctUsers: [...okSet], wrongUsers: [...badSet]
        };
      });
      // 每节聚合
      const sections = {};
      chQs.forEach(qq => {
        const s = qq.section || 1;
        if (!sections[s]) sections[s] = { section: s, name: sectionNames[s - 1] || ('第' + s + '节'), questions: 0, answered: 0, correct: 0 };
        const st = qStats.find(x => x.id === qq.id);
        sections[s].questions++;
        sections[s].answered += st.answered; sections[s].correct += st.correct;
      });
      const secList = Object.values(sections).map(s => ({ ...s, acc: s.answered ? Math.round(s.correct / s.answered * 100) : null }));
      const allAnswered = chQs.reduce((s, qq) => s + (qStats.find(x => x.id === qq.id).answered), 0);
      const allCorrect = chQs.reduce((s, qq) => s + (qStats.find(x => x.id === qq.id).correct), 0);
      return sendJSON(res, 200, {
        chapter: { id: ch, name: chapter.name }, sections: secList,
        questions: qStats, answered: allAnswered, correct: allCorrect,
        acc: allAnswered ? Math.round(allCorrect / allAnswered * 100) : null
      });
    }
    // 成绩分析-每节（每题对/错名单）
    if (p === '/api/analysis/section') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const ch = parseInt(q.get('chapter'), 10);
      const sec = parseInt(q.get('section'), 10);
      const chapter = CHAPTERS.find(c => c.id === ch);
      if (!chapter) return sendJSON(res, 400, { err: '章节无效' });
      const sectionNames = SECTION_NAMES[ch] || [];
      const secQs = questions.filter(x => x.chapter === ch && (x.section || 1) === sec);
      const logs = db.answerLogs.filter(l => l.chapter === ch && l.section === sec && ((db.users.find(u => u.id === l.userId) || {}).role === 'student'));
      const qStats = secQs.map(qq => {
        const ls = logs.filter(l => l.qid === qq.id);
        const okSet = new Set(), badSet = new Set();
        ls.forEach(l => { if (l.correct) okSet.add(l.name); else badSet.add(l.name); });
        const total = okSet.size + badSet.size;
        return {
          id: qq.id, type: qq.type, question: qq.question,
          answered: total, correct: okSet.size, wrong: badSet.size,
          acc: total ? Math.round(okSet.size / total * 100) : null,
          correctUsers: [...okSet], wrongUsers: [...badSet]
        };
      });
      const allAnswered = secQs.reduce((s, qq) => s + (qStats.find(x => x.id === qq.id).answered), 0);
      const allCorrect = secQs.reduce((s, qq) => s + (qStats.find(x => x.id === qq.id).correct), 0);
      return sendJSON(res, 200, {
        chapter: { id: ch, name: chapter.name }, section: { id: sec, name: sectionNames[sec - 1] || ('第' + sec + '节') },
        questions: qStats, answered: allAnswered, correct: allCorrect,
        acc: allAnswered ? Math.round(allCorrect / allAnswered * 100) : null
      });
    }
    // 成绩分析-同学掌握情况汇总（章→节→题）
    if (p === '/api/analysis/mastery') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const students = db.users.filter(u => u.role === 'student');
      const data = students.map(u => {
        const myLogs = db.answerLogs.filter(l => l.userId === u.id);
        const chs = CHAPTERS.map(c => {
          const chLogs = myLogs.filter(l => l.chapter === c.id);
          const chQs = questions.filter(x => x.chapter === c.id);
          const secMap = {};
          chQs.forEach(qq => {
            const s = qq.section || 1;
            if (!secMap[s]) secMap[s] = { section: s, name: (SECTION_NAMES[c.id] || [])[s - 1] || ('第' + s + '节'), answered: 0, correct: 0, questions: [] };
            const ls = chLogs.filter(l => l.qid === qq.id);
            const ok = ls.filter(l => l.correct).length;
            secMap[s].answered += ls.length;
            secMap[s].correct += ok;
            secMap[s].questions.push({ id: qq.id, question: qq.question, answered: ls.length, ok });
          });
          const sections = Object.values(secMap);
          const chAnswered = sections.reduce((s, x) => s + x.answered, 0);
          const chCorrect = sections.reduce((s, x) => s + x.correct, 0);
          return { chapter: c.id, name: c.name, sections, answered: chAnswered, correct: chCorrect, acc: chAnswered ? Math.round(chCorrect / chAnswered * 100) : null };
        });
        const totalAnswered = myLogs.length;
        const totalCorrect = myLogs.filter(l => l.correct).length;
        return { id: u.id, name: u.name, totalAnswered, totalCorrect, acc: totalAnswered ? Math.round(totalCorrect / totalAnswered * 100) : null, chapters: chs };
      });
      return sendJSON(res, 200, { list: data });
    }
    // 教师-题库列表
    if (p === '/api/questions/admin' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const chapter = q.get('chapter');
      const type = q.get('type');
      const kw = (q.get('kw') || '').toLowerCase();
      let list = questions.slice();
      if (chapter !== null && chapter !== '' && chapter !== undefined) list = list.filter(x => String(x.chapter) === chapter);
      if (type) list = list.filter(x => x.type === type);
      if (kw) list = list.filter(x => qSearchText(x).toLowerCase().includes(kw));
      list.sort((a, b) => a.chapter - b.chapter || a.id - b.id);
      return sendJSON(res, 200, { list, total: list.length });
    }
    // 教师-上传题目图片（存 public/qimg/，返回相对路径）
    if (p === '/api/upload-qimg' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const data = String(body.data || '');
      const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(data);
      if (!m) return sendJSON(res, 400, { err: '仅支持 PNG/JPG/GIF/WebP 图片' });
      const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
      let buf;
      try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return sendJSON(res, 400, { err: '图片数据无效' }); }
      if (!buf.length || buf.length > 3 * 1024 * 1024) return sendJSON(res, 400, { err: '图片不能超过 3MB' });
      const dir = path.join(PUBLIC_DIR, 'qimg');
      fs.mkdirSync(dir, { recursive: true });
      const name = 'q' + Date.now() + '_' + Math.floor(Math.random() * 10000) + '.' + ext;
      fs.writeFileSync(path.join(dir, name), buf);
      return sendJSON(res, 200, { ok: 1, url: 'qimg/' + name });
    }
    // 教师-删除题目图片（可选，清理 qimg 文件）
    if (p === '/api/delete-qimg' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const u = String(body.url || '');
      if (u.indexOf('qimg/') !== 0) return sendJSON(res, 400, { err: '路径无效' });
      const f = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(u)));
      if (!f.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { err: 'forbidden' });
      try { fs.unlinkSync(f); } catch (e) { /* 文件不存在忽略 */ }
      return sendJSON(res, 200, { ok: 1 });
    }
    // 教师-新增题目
    if (p === '/api/questions/admin' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const v = validateQuestion(body);
      if (v) return sendJSON(res, 400, { err: v });
      const maxId = questions.reduce((m, x) => Math.max(m, x.id), 0);
      const nq = { id: maxId + 1, chapter: Number(body.chapter), section: Number(body.section) || 1, type: body.type, question: String(body.question).trim(), options: body.options, answer: String(body.answer).trim(), explain: String(body.explain || '').trim(), difficulty: clampDiff(body.difficulty), image: String(body.image || '').trim(), imageAlign: ['left', 'center', 'right'].includes(body.imageAlign) ? body.imageAlign : 'center', imgSize: clampImgSize(body.imgSize) };
      questions.push(nq);
      await acc.insertQuestion(nq);
      db.logs.push({ t: Date.now(), op: '新增题目#' + nq.id, by: a.user.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1, id: nq.id });
    }
    // 教师-修改题目
    if (p.startsWith('/api/questions/admin/') && req.method === 'PUT') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const id = parseInt(p.split('/').pop(), 10);
      const qq = questions.find(x => x.id === id);
      if (!qq) return sendJSON(res, 404, { err: '题目不存在' });
      const body = await readBody(req);
      const v = validateQuestion(body);
      if (v) return sendJSON(res, 400, { err: v });
      qq.chapter = Number(body.chapter); qq.section = Number(body.section) || 1; qq.type = body.type; qq.question = String(body.question).trim();
      qq.options = body.options; qq.answer = String(body.answer).trim(); qq.explain = String(body.explain || '').trim(); qq.difficulty = clampDiff(body.difficulty); qq.image = String(body.image || '').trim(); qq.imageAlign = ['left', 'center', 'right'].includes(body.imageAlign) ? body.imageAlign : 'center'; qq.imgSize = clampImgSize(body.imgSize);
      await acc.updateQuestion(qq);
      db.logs.push({ t: Date.now(), op: '修改题目#' + id, by: a.user.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1 });
    }
    // 教师-删除题目
    if (p.startsWith('/api/questions/admin/') && req.method === 'DELETE') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const id = parseInt(p.split('/').pop(), 10);
      const idx = questions.findIndex(x => x.id === id);
      if (idx < 0) return sendJSON(res, 404, { err: '题目不存在' });
      questions.splice(idx, 1);
      await acc.deleteQuestion(id);
      db.logs.push({ t: Date.now(), op: '删除题目#' + id, by: a.user.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1 });
    }
    // 教师-批量删除题目（1.0.0.5）
    if (p === '/api/questions/admin/batch-delete' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(x => parseInt(x, 10)).filter(x => Number.isInteger(x)) : [];
      if (!ids.length) return sendJSON(res, 400, { err: '请选择要删除的题目' });
      const before = questions.length;
      const keep = questions.filter(x => !ids.includes(x.id));
      const removed = questions.length - keep.length;
      questions = keep;
      acc.state.questions = keep;
      for (const id of ids) await acc.deleteQuestion(id);
      db.logs.push({ t: Date.now(), op: '批量删除题目 ' + removed + ' 道', by: a.user.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1, removed, total: questions.length });
    }
    // 教师-导出试题模板（CSV，1.0.0.5）
    if (p === '/api/questions/template' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const head = ['chapter', 'section', 'type', 'question', 'options', 'answer', 'explain', 'difficulty'];
      const sample = [
        '0,1,single,发现有人触电时，首先应做的是？,迅速断开电源;用木棍挑开电线;直接用手拉;呼叫医护人员,A,发现有人触电应先迅速断开电源或用干燥木棍挑开电线,2',
        '0,1,judge,可以用湿手触摸开关、插座等电气设备。,正确;错误,B,湿手触摸电气设备极易触电，禁止。,2',
        '0,1,multi,电气设备起火时，正确的做法是？,切断电源;用干粉灭火器灭火;用水直接浇灭;用二氧化碳灭火器灭火,A,B,先断电再用干粉或二氧化碳灭火，不可用水浇电气设备,4',
        '0,1,fill,1A=____mA（填数字）。,,1000,1A=1000mA=10⁶μA。,3',
        '12,1,matching,请将下列物理量与对应的符号连线。,左:电流|电压;右:I|U,0-0;1-1,电流-I、电压-U。,3',
        '1,3,calc,某电阻两端电压为12V，通过的电流为0.4A，求该电阻的阻值。,,30,由欧姆定律 R=U/I=12/0.4=30Ω。,3'
      ];
      let csv = 'chapter,section,type,question,options,answer,explain,difficulty\r\n';
      // 模板说明注释行（# 开头，导入时会忽略）
      csv += '# 试题导入模板说明（本行及#开头的行导入时忽略）\r\n';
      csv += '# chapter:章节号0~12；section:节号1~5；type:single单选/judge判断/multi多选/fill填空/matching连线/calc计算\r\n';
      csv += '# options:单选/判断/多选用分号(;)分隔选项（自动加A./B./C./D.前缀，已带前缀则保留）；连线题用 左:电流|电压;右:I|U\r\n';
      csv += '# answer:单选/判断填字母(A/B/C)；多选填字母逗号分隔(A,B)；填空填答案；连线填配对(0-0;1-1表示左0连右0)\r\n';
      csv += '# difficulty:难度1~5（1易~5难），留空默认3\r\n';
      for (const row of sample) csv += row + '\r\n';
      csv += '\r\n';
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="questions_template.csv"', 'Cache-Control': 'no-store' });
      return res.end('\uFEFF' + csv);
    }
    // 教师-导入试题（CSV/JSON，查重保留原题，1.0.0.5）
    if (p === '/api/questions/import' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const format = body.format === 'json' ? 'json' : 'csv';
      const text = String(body.content || '');
      if (!text.trim()) return sendJSON(res, 400, { err: '导入内容为空' });
      let items = [];
      const problems = [];
      try {
        items = format === 'json' ? parseImportJSON(text) : parseImportCSV(text);
      } catch (e) { return sendJSON(res, 400, { err: '解析失败：' + e.message }); }
      if (!items.length) return sendJSON(res, 400, { err: '没有可导入的有效题目' });
      // 查重：题干完全一致视为重复（保留原题，导入的忽略）
      const existSet = new Set(questions.map(x => normText(x.question)));
      const exists = [], added = [];
      let maxId = questions.reduce((m, x) => Math.max(m, x.id), 0);
      for (const it of items) {
        const key = normText(it.question);
        if (existSet.has(key) || added.some(x => normText(x.question) === key)) { exists.push(it.question); continue; }
        const err = validateQuestion(it);
        if (err) { problems.push('#' + it.question + '：' + err); continue; }
        const nq = { id: ++maxId, chapter: Number(it.chapter), section: Number(it.section) || 1, type: it.type, question: String(it.question).trim(), options: it.options, answer: String(it.answer).trim(), explain: String(it.explain || '').trim(), difficulty: clampDiff(it.difficulty) };
        questions.push(nq);
        acc.state.questions = questions;
        await acc.insertQuestion(nq);
        added.push(nq);
      }
      if (added.length) {
        db.logs.push({ t: Date.now(), op: '导入试题 ' + added.length + ' 道（重复跳过 ' + exists.length + '，无效 ' + problems.length + '）', by: a.user.name });
        await acc.appendLog(db.logs[db.logs.length - 1]);
      }
      return sendJSON(res, 200, { ok: 1, added: added.length, exists: exists.length, failed: problems.length, problems });
    }
    // ============ 1.4.3.0 图片OCR识别（Windows 中文OCR引擎） ============
    // 教师-上传截图/图片 → OCR 识别文字（返回行级结果）
    if (p === '/api/ocr' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      // Docker/Linux 等非 Windows 环境无 PowerShell 中文OCR引擎，明确提示（Windows 行为不变）
      if (process.platform !== 'win32') {
        return sendJSON(res, 501, { err: '当前运行环境（' + process.platform + '）不支持图片OCR识别，请使用 Windows 服务端，或改用截图上传/手动录入题目' });
      }
      const body = await readBody(req);
      const b64 = String(body.image || '');
      const m = b64.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
      const raw = m ? m[1] : b64;
      const imgBuf = Buffer.from(raw, 'base64');
      if (!imgBuf.length || imgBuf.length > 15 * 1024 * 1024) return sendJSON(res, 400, { err: '图片内容无效或过大（限15MB）' });
      const wk = path.join(ROOT, 'ocr_worker.ps1');
      if (!fs.existsSync(wk)) return sendJSON(res, 500, { err: '服务端缺少 ocr_worker.ps1，请更新服务端文件' });
      const tmpImg = path.join(acc.DATA_DIR, '_ocr_tmp_' + Date.now() + '.png');
      const outJson = path.join(acc.DATA_DIR, '_ocr_out_' + Date.now() + '.json');
      fs.writeFileSync(tmpImg, imgBuf);
      try {
        await new Promise((resolve, reject) => {
          execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wk, '-Image', tmpImg, '-Out', outJson], { timeout: 90000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err) => err ? reject(err) : resolve());
        });
        let out = {};
        try { out = JSON.parse(fs.readFileSync(outJson, 'utf8')); } catch (e) { /* 空 */ }
        if (out.ok !== true) return sendJSON(res, 500, { err: 'OCR 识别失败：' + (out.err || '未知错误') });
        db.logs.push({ t: Date.now(), op: '图片OCR识别（' + (out.lines || []).length + ' 行）', by: a.user.name });
        await acc.appendLog(db.logs[db.logs.length - 1]);
        return sendJSON(res, 200, { ok: 1, text: out.text || '', lines: out.lines || [] });
      } catch (e) {
        return sendJSON(res, 500, { err: 'OCR 执行失败：' + e.message });
      } finally {
        try { fs.unlinkSync(tmpImg); } catch (e2) { /* 忽略 */ }
        try { fs.unlinkSync(outJson); } catch (e2) { /* 忽略 */ }
      }
    }
    // 教师-保存题目截图到 qimg（返回可引用路径，配合 OCR 识别结果作题目配图）
    if (p === '/api/qimg/upload' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const b64 = String(body.image || '');
      const m = b64.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
      if (!m) return sendJSON(res, 400, { err: '仅支持 PNG/JPG/GIF/WebP 图片' });
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > 15 * 1024 * 1024) return sendJSON(res, 400, { err: '图片无效或过大（限15MB）' });
      const qimgDir = path.join(PUBLIC_DIR, 'qimg');
      fs.mkdirSync(qimgDir, { recursive: true });
      const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
      const name = 'ocr_' + Date.now() + '_' + Math.floor(Math.random() * 10000) + '.' + ext;
      fs.writeFileSync(path.join(qimgDir, name), buf);
      db.logs.push({ t: Date.now(), op: '上传题图 ' + name, by: a.user.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1, path: 'qimg/' + name });
    }
    // 教师-网页抓题：抓取网页 → 提取题目 → 返回候选列表（含图片题清单）
    if (p === '/api/fetch-questions' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const url = String(body.url || '').trim();
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return sendJSON(res, 400, { err: '请输入有效的网页地址（http/https 开头）' });
      try {
        const r = await fetchUrl(url, 3);
        const qs = extractQuestionsFromHtml(r.html, url);
        // 提取页面内图片地址（供"截图识别"二次使用）
        const imgs = [];
        const re = /<img[^>]+src=["']([^"']+)["']/gi;
        let mm;
        while ((mm = re.exec(r.html)) && imgs.length < 20) {
          try { imgs.push(new URL(mm[1], url).toString()); } catch (e) { /* 忽略坏地址 */ }
        }
        db.logs.push({ t: Date.now(), op: '网页抓题 ' + url.slice(0, 60) + '（提取 ' + qs.length + ' 题）', by: a.user.name });
        await acc.appendLog(db.logs[db.logs.length - 1]);
        return sendJSON(res, 200, { ok: 1, url, questions: qs, images: imgs, htmlLen: r.html.length });
      } catch (e) {
        return sendJSON(res, 502, { err: '网页抓取失败：' + e.message });
      }
    }
    // 教师-关卡题目数量 → 系统自动计算关卡时间（朗读时间+答题时间，1.0.0.5）
    if (p === '/api/levels/auto-time' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const lq = {};
      for (const k of ['1', '2', '3', 'boss']) {
        const v = parseInt(body[k], 10);
        lq[k] = isNaN(v) ? (LEVELS.find(l => String(l.id) === k) || { q: 6 }).q : Math.max(1, Math.min(30, v));
      }
      const res2 = computeLevelTime(lq);
      return sendJSON(res, 200, { ok: 1, ...res2 });
    }
    // 教师-组卷（按章节/难度/题型/掌握情况筛选生成，1.0.0.5）
    if (p === '/api/paper/generate' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const r = buildPaper(body);
      return sendJSON(res, 200, { ok: 1, title: r.title, groups: r.groups, total: r.total, list: r.list });
    }
    // 教师-组卷导出 Word/WPS 可打印试卷（.doc，1.0.0.5）
    if (p === '/api/paper/export' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const r = buildPaper(body);
      const doc = paperToDoc(r, !!body.includeAnswer);
      const unit = db.settings.unit || '';
      const fname = (unit ? unit + '-' : '') + r.title + (body.includeAnswer ? '-答案版' : '') + '.doc';
      res.writeHead(200, {
        'Content-Type': 'application/msword; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fname).replace(/%20/g, ' ') + '"',
        'Cache-Control': 'no-store'
      });
      return res.end(Buffer.from('\uFEFF' + doc, 'utf8'));
    }
    // ============ 1.3.0.0 考试/阅卷（西红柿阅卷） ============
    // 保存考试（创建/更新；questions: [{id, score}] 或完整题目对象）
    if (p === '/api/exam/save' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      if (!title) return sendJSON(res, 400, { err: '考试名称不能为空' });
      let qs = Array.isArray(body.questions) ? body.questions : [];
      if (!qs.length) return sendJSON(res, 400, { err: '试卷不能为空，请先组卷' });
      // 规范化题目（带分值，缺省 1 分）
      const list = qs.map(x => {
        const src = typeof x.id !== 'undefined' ? questions.find(qq => qq.id === Number(x.id)) : x;
        if (!src) return null;
        return { id: src.id, chapter: src.chapter, section: src.section || 1, type: src.type, question: src.question,
          options: src.options, answer: src.answer, difficulty: src.difficulty || 3, image: src.image || '', imageAlign: src.imageAlign || 'center', imgSize: src.imgSize || 60, score: Math.max(1, Number(x.score) || 1) };
      }).filter(Boolean);
      if (!list.length) return sendJSON(res, 400, { err: '题目无效或未找到' });
      const totalScore = list.reduce((s2, x) => s2 + x.score, 0);
      const now = Date.now();
      const exam = {
        id: body.id || 'ex' + uid(),
        title, subject: String(body.subject || '电工技术基础与技能'),
        className: String(body.className || ''), grade: String(body.grade || ''),
        createdAt: now, status: 'draft',
        questions: list, qcount: list.length, totalScore,
        createdBy: a.user.name, publishedAt: '', note: String(body.note || '')
      };
      await acc.saveExam(exam);
      db.logs.push({ t: Date.now(), op: '创建/更新考试「' + title + '」（' + list.length + '题/' + totalScore + '分）', by: a.user.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1, exam: publicExam(exam) });
    }
    // 考试列表（教师）
    if (p === '/api/exam/list' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      return sendJSON(res, 200, { list: acc.listExams().map(publicExam) });
    }
    // 考试详情（教师，含答案）
    if (p === '/api/exam/get' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const exam = acc.listExams().find(x => x.id === q.get('id'));
      if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
      return sendJSON(res, 200, { exam: publicExam(exam, true) });
    }
    // 删除考试
    if (p === '/api/exam/delete' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const exam = acc.listExams().find(x => x.id === body.id);
      await acc.deleteExam(String(body.id || ''));
      if (exam) {
        db.logs.push({ t: Date.now(), op: '删除考试「' + exam.title + '」', by: a.user.name });
        await acc.appendLog(db.logs[db.logs.length - 1]);
      }
      return sendJSON(res, 200, { ok: 1 });
    }
    // 考试状态流转（open 开考 / grading 收卷阅卷 / published 发布成绩）
    if (p === '/api/exam/status' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const exam = acc.listExams().find(x => x.id === body.id);
      if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
      const st = ['draft', 'open', 'grading', 'published'].includes(body.status) ? body.status : exam.status;
      exam.status = st;
      if (st === 'published') exam.publishedAt = Date.now();
      await acc.saveExam(exam);
      db.logs.push({ t: Date.now(), op: '考试「' + exam.title + '」状态变更为 ' + st, by: a.user.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1, status: st });
    }
    // 学生端：我的考试（进行中/已发布）
    if (p === '/api/exam/mine' && req.method === 'GET') {
      const a = auth('student');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const exams = acc.listExams().filter(x => x.status === 'open' || x.status === 'published');
      const ans = acc.listExamAnswers ? acc.listExamAnswersOf(a.user.id) : [];
      const map = {};
      (acc.listExamAnswers ? acc.listExamAnswersOf(a.user.id) : []).forEach(x => { map[x.examId] = x; });
      const list = exams.map(x => {
        const my = map[x.id];
        return { id: x.id, title: x.title, subject: x.subject, className: x.className, status: x.status,
          qcount: x.qcount, totalScore: x.totalScore, publishedAt: x.publishedAt,
          answered: !!my, myTotal: my ? my.total : null, myStatus: my ? my.status : null, grade: my ? my.total : null };
      });
      return sendJSON(res, 200, { list });
    }
    // 学生预览试卷/答题卡（只读，不含答案）
    if (p === '/api/exam/preview' && req.method === 'GET') {
      const a = auth('student');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const exam = acc.listExams().find(x => x.id === q.get('id'));
      if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
      if (exam.status !== 'open' && exam.status !== 'published') return sendJSON(res, 403, { err: '考试未开放' });
      return sendJSON(res, 200, { exam: publicExam(exam, false) });
    }
    // 学生提交答卷（客观题识别结果：objective=[{id, given}]；服务端重新判分防伪造）
    if (p === '/api/exam/submit' && req.method === 'POST') {
      const a = auth('student');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const exam = acc.listExams().find(x => x.id === body.examId);
      if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
      if (exam.status !== 'open') return sendJSON(res, 400, { err: '考试当前不可作答' });
      const given = Array.isArray(body.objective) ? body.objective : [];
      const objective = exam.questions.map(qq => {
        const g = given.find(x => String(x.id) === String(qq.id));
        const val = g ? g.given : '';
        let ok = false;
        if (qq.type === 'single' || qq.type === 'judge') {
          const letter = String(val || '').trim().toUpperCase();
          ok = letter.length === 1 && letter === String(qq.answer).toUpperCase();
        } else if (qq.type === 'multi') {
          const want = String(qq.answer).split(/[,，]/).map(s => s.trim().toUpperCase()).filter(Boolean).sort();
          const sel = String(val || '').toUpperCase().split(/[,，]/).map(s => s.trim()).filter(Boolean).sort();
          ok = want.length > 0 && want.join(',') === sel.join(',');
        } else if (qq.type === 'fill') {
          ok = answerMatch(String(val || ''), String(qq.answer));
        }
        return { id: qq.id, type: qq.type, given: val, ok, score: ok ? qq.score : 0 };
      });
      const autoScore = objective.reduce((s2, x) => s2 + x.score, 0);
      const subjective = exam.questions.filter(qq => ['matching', 'calc'].includes(qq.type))
        .map(qq => ({ id: qq.id, maxScore: qq.score, score: 0, graded: false }));
      const ans = { examId: exam.id, userId: a.user.id, name: a.user.name, t: Date.now(),
        objective, subjective, total: autoScore, status: subjective.length ? 'pending' : 'graded', img: String(body.img || '') };
      await acc.saveExamAnswer(ans);
      return sendJSON(res, 200, { ok: 1, total: ans.total, needManual: !!subjective.length });
    }
    // 教师：答卷列表（含识别结果/图片）
    if (p === '/api/exam/answers' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const examId = q.get('examId');
      const exam = acc.listExams().find(x => x.id === examId);
      if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
      const list = acc.listExamAnswers(examId).map(x => {
        const subDone = (x.subjective || []).every(s => s.graded);
        return { userId: x.userId, name: x.name, t: x.t, total: x.total, status: subDone ? 'graded' : x.status, img: x.img || '',
          objective: x.objective, subjective: x.subjective, examTotal: exam.totalScore };
      }).sort((x, y) => (x.name || '').localeCompare(y.name || '', 'zh'));
      return sendJSON(res, 200, { list, exam: publicExam(exam, true) });
    }
    // 教师：主观题批改
    if (p === '/api/exam/grade' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const exam = acc.listExams().find(x => x.id === body.examId);
      const answers = acc.listExamAnswers(body.examId);
      const ans = answers.find(x => x.userId === body.userId);
      if (!exam || !ans) return sendJSON(res, 404, { err: '答卷不存在' });
      const subs = Array.isArray(body.subjective) ? body.subjective : [];
      (ans.subjective || []).forEach(s => {
        const g = subs.find(x => String(x.id) === String(s.id));
        if (g) {
          const v = Math.max(0, Math.min(s.maxScore, Number(g.score) || 0));
          s.score = v; s.graded = true;
        }
      });
      const subTotal = (ans.subjective || []).reduce((s2, x) => s2 + (x.graded ? x.score : 0), 0);
      const objTotal = (ans.objective || []).reduce((s2, x) => s2 + x.score, 0);
      ans.total = objTotal + subTotal;
      ans.status = (ans.subjective || []).every(s => s.graded) ? 'graded' : 'pending';
      await acc.saveExamAnswer(ans);
      return sendJSON(res, 200, { ok: 1, total: ans.total, status: ans.status });
    }
    // 教师：考试统计（每题正确率 / 分数分布 / 个人成绩）
    if (p === '/api/exam/stats' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const examId = q.get('examId');
      const exam = acc.listExams().find(x => x.id === examId);
      if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
      const answers = acc.listExamAnswers(examId);
      const perQ = exam.questions.map(qq => {
        const tried = answers.filter(x => x.objective && x.objective.some(o => String(o.id) === String(qq.id) && o.given !== '' && o.given != null));
        const okN = tried.filter(x => x.objective.some(o => String(o.id) === String(qq.id) && o.ok)).length;
        return { id: qq.id, type: qq.type, question: qq.question, score: qq.score, tried: tried.length, ok: okN, acc: tried.length ? Math.round(okN / tried.length * 100) : null };
      });
      const scores = answers.map(x => x.total);
      const avg = scores.length ? Math.round(scores.reduce((s2, v) => s2 + v, 0) / scores.length * 10) / 10 : 0;
      const dist = [0, 0, 0, 0, 0];
      scores.forEach(v => { const pct = exam.totalScore ? v / exam.totalScore : 0; if (pct >= 0.9) dist[0]++; else if (pct >= 0.75) dist[1]++; else if (pct >= 0.6) dist[2]++; else dist[3]++; });
      const students = db.users.filter(x => x.role === 'student');
      const personal = students.map(st => {
        const an = answers.find(x => x.userId === st.id);
        return { id: st.id, name: st.name, total: an ? an.total : null, status: an ? an.status : 'absent', graded: an ? (an.subjective || []).every(s => s.graded) : false };
      }).sort((x, y) => (y.total == null ? -1 : y.total) - (x.total == null ? -1 : x.total));
      return sendJSON(res, 200, { exam: publicExam(exam), perQ, avg, count: answers.length, totalScore: exam.totalScore, dist, personal });
    }
    // 教师-导出标准考试试卷（.doc，1.3.0.0）
    if (p === '/api/paper/exam' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      let r = null;
      if (body.examId) {
        const exam = acc.listExams().find(x => x.id === body.examId);
        if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
        r = { title: exam.title, subject: exam.subject, total: exam.qcount, totalScore: exam.totalScore, list: exam.questions };
        const typeOrder = ['single', 'judge', 'multi', 'fill', 'matching', 'calc'];
        const typeName = { single: '单选题', judge: '判断题', multi: '多选题', fill: '填空题', matching: '连线题', calc: '计算题' };
        r.groups = typeOrder.filter(t => exam.questions.some(q => q.type === t)).map(t => ({ type: t, name: typeName[t], questions: exam.questions.filter(q => q.type === t) }));
      } else {
        r = buildPaper(body);
        r.subject = '电工技术基础与技能'; r.totalScore = r.list.reduce((s2, x) => s2 + (x.score || 1), 0);
      }
      const doc = examToDoc(r, !!body.includeAnswer);
      const unit = db.settings.unit || '';
      const fname = (unit ? unit + '-' : '') + r.title + (body.includeAnswer ? '-答案版' : '') + '-标准试卷.doc';
      res.writeHead(200, { 'Content-Type': 'application/msword; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fname).replace(/%20/g, ' ') + '"', 'Cache-Control': 'no-store' });
      return res.end(Buffer.from('\uFEFF' + doc, 'utf8'));
    }
    // 教师-导出机读答题卡（.doc，1.3.0.0）
    if (p === '/api/paper/card' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      let r = null;
      if (body.examId) {
        const exam = acc.listExams().find(x => x.id === body.examId);
        if (!exam) return sendJSON(res, 404, { err: '考试不存在' });
        r = { title: exam.title, total: exam.qcount, totalScore: exam.totalScore, list: exam.questions };
      } else {
        r = buildPaper(body);
        r.totalScore = r.list.reduce((s2, x) => s2 + (x.score || 1), 0);
      }
      const doc = cardToDoc(r);
      const unit = db.settings.unit || '';
      const fname = (unit ? unit + '-' : '') + r.title + '-机读答题卡.doc';
      res.writeHead(200, { 'Content-Type': 'application/msword; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fname).replace(/%20/g, ' ') + '"', 'Cache-Control': 'no-store' });
      return res.end(Buffer.from('\uFEFF' + doc, 'utf8'));
    }
    // 上传答题卡图片（base64 JSON，存 data/uploads）
    if (p === '/api/exam/upload' && req.method === 'POST') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const b64 = String(body.data || '');
      const m = b64.match(/^data:image\/(\w+);base64,(.+)$/s);
      if (!m) return sendJSON(res, 400, { err: '图片数据格式错误' });
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const examId = String(body.examId || 'none').replace(/[^\w-]/g, '');
      const dir = path.join(acc.DATA_DIR, 'uploads', examId);
      fs.mkdirSync(dir, { recursive: true });
      const fname = a.user.id + '_' + Date.now() + '.' + ext;
      fs.writeFileSync(path.join(dir, fname), Buffer.from(m[2], 'base64'));
      return sendJSON(res, 200, { ok: 1, url: '/uploads/' + examId + '/' + fname });
    }
    // 教师-修改用户名/密码（记录日志）
    if (p === '/api/teacher' && req.method === 'PUT') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const t = db.users.find(u => u.id === a.user.id);
      if (!t) return sendJSON(res, 404, { err: '账号不存在' });
      if (t.pass !== sha256(t.salt + String(body.curPass || ''))) return sendJSON(res, 400, { err: '当前密码错误' });
      const newName = String(body.newName || '').trim();
      if (!newName) return sendJSON(res, 400, { err: '用户名不能为空' });
      if (newName.length > 20) return sendJSON(res, 400, { err: '用户名过长（20字以内）' });
      const dup = db.users.find(u => u.id !== t.id && u.name === newName);
      if (dup) return sendJSON(res, 400, { err: '用户名已存在' });
      const newPass = String(body.newPass || '');
      t.name = newName;
      if (newPass) {
        if (newPass.length < 4) return sendJSON(res, 400, { err: '密码至少4位' });
        t.salt = uid();
        t.pass = sha256(t.salt + newPass);
      }
      await acc.updateUser(t);
      db.logs.push({ t: Date.now(), op: '教师修改账号（用户名/密码）', by: t.name });
      await acc.appendLog(db.logs[db.logs.length - 1]);
      return sendJSON(res, 200, { ok: 1, name: t.name });
    }
    // 教师-读取系统设置
    if (p === '/api/settings' && req.method === 'GET') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      return sendJSON(res, 200, { settings: db.settings || {} });
    }
    // 教师-修改系统设置（使用单位/游戏名称/闯关时间/关卡题数，记录日志）
    if (p === '/api/settings' && req.method === 'PUT') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const reasons = [];
      if ('unit' in body) {
        const unit = String(body.unit || '').trim();
        if (unit.length > 40) return sendJSON(res, 400, { err: '使用单位名称过长（40字以内）' });
        const oldUnit = db.settings.unit || '';
        db.settings.unit = unit;
        await acc.setSetting('unit', unit);
        if (unit !== oldUnit) reasons.push('使用单位 ' + oldUnit + ' → ' + unit);
      }
      if ('gameName' in body) {
        const gn = String(body.gameName || '').trim();
        if (gn.length > 20) return sendJSON(res, 400, { err: '游戏名称过长（20字以内）' });
        const oldGn = db.settings.gameName || '电闯关·电工大作战';
        db.settings.gameName = gn;
        await acc.setSetting('gameName', gn);
        if (gn !== oldGn) reasons.push('游戏名称 ' + oldGn + ' → ' + gn);
      }
      if ('timeAdd' in body) {
        const ta = parseInt(body.timeAdd, 10);
        if (isNaN(ta) || ta < 0 || ta > 60) return sendJSON(res, 400, { err: '普通题加时范围 0~60 秒' });
        db.settings.timeAdd = ta;
        await acc.setSetting('timeAdd', String(ta));
        reasons.push('普通题加时 ' + ta + ' 秒');
      }
      if ('timeMatchAdd' in body) {
        const tm = parseInt(body.timeMatchAdd, 10);
        if (isNaN(tm) || tm < 0 || tm > 60) return sendJSON(res, 400, { err: '连线题加时范围 0~60 秒' });
        db.settings.timeMatchAdd = tm;
        await acc.setSetting('timeMatchAdd', String(tm));
        reasons.push('连线题加时 ' + tm + ' 秒');
      }
      if ('levelQ' in body && body.levelQ && typeof body.levelQ === 'object') {
        const lq = {};
        for (const k of ['1', '2', '3', 'boss']) {
          const v = parseInt(body.levelQ[k], 10);
          lq[k] = isNaN(v) ? (LEVELS.find(l => String(l.id) === k) || { q: 6 }).q : Math.max(1, Math.min(30, v));
        }
        // Access 版 setSetting 存字符串、JSON 版存内存对象：统一先落库字符串再回写内存对象
        await acc.setSetting('levelQ', JSON.stringify(lq));
        db.settings.levelQ = lq;
        // 系统按题数自动计算每关每题基础时间（朗读+答题）
        const auto = computeLevelTime(lq);
        await acc.setSetting('levelTimeBase', JSON.stringify(auto.levelTimeBase));
        db.settings.levelTimeBase = auto.levelTimeBase;
        reasons.push('关卡题数 入门' + lq['1'] + '/进阶' + lq['2'] + '/实战' + lq['3'] + '/BOSS' + lq['boss'] + '，自动计时 每题' + auto.levelTimeBase['1'] + '~' + auto.levelTimeBase['boss'] + '秒');
      }
      if (reasons.length) {
        db.logs.push({ t: Date.now(), op: '系统设置修改', by: a.user.name, reason: reasons.join('；') });
        await acc.appendLog(db.logs[db.logs.length - 1]);
      }
      return sendJSON(res, 200, { ok: 1, settings: db.settings });
    }
    // 教师-操作日志
    if (p === '/api/logs') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      return sendJSON(res, 200, { list: db.logs.slice().reverse() });
    }

    sendJSON(res, 404, { err: '接口不存在' });
  } catch (e) {
    sendJSON(res, 500, { err: '服务器错误：' + e.message });
  }
});

/* ---------------- 1.0.0.5 辅助函数 ---------------- */
/* 难度钳制 1~5（默认 3） */
function clampDiff(d) {
  const v = parseInt(d, 10);
  if (isNaN(v)) return 3;
  return Math.max(1, Math.min(5, v));
}
/* 1.4.0.0：题干图片显示宽度百分比 20~100（默认 60） */
function clampImgSize(s) {
  const v = parseInt(s, 10);
  if (isNaN(v)) return 60;
  return Math.max(20, Math.min(100, v));
}
/* 读取对象型设置（JSON 版内存为对象、Access 版为 JSON 字符串，统一兼容） */
function objSetting(k, def) {
  const raw = db.settings[k];
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.trim()) { try { const o = JSON.parse(raw); if (o && typeof o === 'object') return o; } catch (e) {} }
  return def || {};
}
/* CSV 解析：支持引号包裹、逗号、换行（# 开头行为注释忽略） */
function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row); }
  return rows;
}
/* 题目搜索文本（连线题 options 为对象，兼容拼接） */
function qSearchText(x) {
  let opts = '';
  if (Array.isArray(x.options)) opts = x.options.join(' ');
  else if (x.options && Array.isArray(x.options.left) && Array.isArray(x.options.right)) opts = x.options.left.join(' ') + ' ' + x.options.right.join(' ');
  return (x.question || '') + ' ' + opts + ' ' + (x.explain || '');
}
/* 解析导入的 CSV 为题目对象数组 */
function parseImportCSV(text) {
  const rows = parseCSV(text).filter(r => !r || !r.some(c => String(c || '').trim().startsWith('#')));
  // 兼容无表头粘贴：首行不含列名时按固定列序（chapter,section,type,question,options,answer,explain,difficulty）
  if (!rows.length) return [];
  const firstLine = rows[0].map(h => h.trim().toLowerCase());
  if (!firstLine.includes('chapter') || !firstLine.includes('type') || !firstLine.includes('question')) {
    rows.unshift(['chapter', 'section', 'type', 'question', 'options', 'answer', 'explain', 'difficulty']);
  }
  const head = rows[0].map(h => h.trim().toLowerCase());
  const ci = {};
  ['chapter', 'section', 'type', 'question', 'options', 'answer', 'explain', 'difficulty'].forEach((k, i) => {
    ci[k] = head.indexOf(k);
  });
  if (ci.chapter < 0 || ci.type < 0 || ci.question < 0) throw new Error('CSV 必须包含列：chapter,type,question（可含 section,options,answer,explain,difficulty）');
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some(x => x.trim() !== '')) continue;
    const get = (k) => (ci[k] >= 0 && ci[k] < row.length ? row[ci[k]] : '');
    const question = get('question').trim();
    if (!question) continue;
    const type = get('type').trim().toLowerCase();
    const optsRaw = get('options').trim();
    let options = [];
    let answer = get('answer').trim();
    if (type === 'matching') {
      // 连线题 options 支持两种写法：
      // 1) 简写：左:电流|电压;右:I|U（推荐，无引号无逗号）
      // 2) JSON：{"left":["电流","电压"],"right":["I","U"]}（CSV 中须整体加双引号且内部引号翻倍转义）
      const lm = optsRaw.match(/^左[:：](.+?)[;；]右[:：](.+)$/);
      if (lm) {
        options = { left: lm[1].split('|').map(s => s.trim()).filter(Boolean), right: lm[2].split('|').map(s => s.trim()).filter(Boolean) };
      } else {
        try { options = JSON.parse(optsRaw); } catch (e) { throw new Error('连线题 options 请用 左:电流|电压;右:I|U 格式（第' + (r + 1) + '行）'); }
      }
      // answer 配对格式 0-0;1-1 → [[0,0],[1,1]]
      const pairs = String(answer).split(/[;,；]/).map(s => s.trim()).filter(Boolean).map(s => {
        const m = s.split('-');
        return [parseInt(m[0], 10), parseInt(m[1], 10)];
      });
      answer = JSON.stringify(pairs);
    } else {
      // 分号分隔选项；不带字母前缀的自动补 A./B./C./D.
      options = optsRaw ? optsRaw.split(/[;,；]/).map(s => s.trim()).filter(Boolean) : [];
      options = options.map((o, i) => /^[A-Za-z][.、．]/.test(o) ? o : String.fromCharCode(65 + i) + '. ' + o);
    }
    const it = {
      chapter: parseInt(get('chapter'), 10), section: parseInt(get('section'), 10) || 1,
      type, question, options, answer, explain: get('explain').trim(),
      difficulty: clampDiff(get('difficulty'))
    };
    items.push(it);
  }
  return items;
}
/* 解析导入的 JSON（数组 或 {list:[...]}） */
function parseImportJSON(text) {
  let arr = null;
  try { arr = JSON.parse(text); } catch (e) { throw new Error('JSON 格式错误：' + e.message); }
  if (!Array.isArray(arr)) {
    if (arr && Array.isArray(arr.list)) arr = arr.list;
    else throw new Error('JSON 应为题目数组 或 {"list":[...]}');
  }
  return arr.map(it => ({
    chapter: it.chapter, section: it.section || 1, type: it.type, question: it.question,
    options: it.options || [], answer: it.answer, explain: it.explain || '', difficulty: it.difficulty
  })).filter(it => it.question && String(it.question).trim());
}
/* 关卡自动计时：朗读时间（题干+选项字数 /4 字每秒）+ 答题基础时间 */
function computeLevelTime(levelQ) {
  const avgChars = {}; // 每关允许题型在题库中的平均题面字符数（含选项）
  const typesByLevel = { 1: ['single', 'judge'], 2: ['single', 'judge', 'multi', 'fill', 'matching', 'calc'], 3: ['single', 'judge', 'multi', 'fill', 'matching', 'calc'], boss: ['single', 'judge', 'multi', 'fill', 'matching', 'calc'] };
  for (const k of ['1', '2', '3', 'boss']) {
    const pool = questions.filter(q => typesByLevel[k].includes(q.type));
    if (!pool.length) { avgChars[k] = 60; continue; }
    const sum = pool.reduce((s, q) => {
      let n = (q.question || '').length;
      if (q.type === 'matching') {
        const o = q.options || {};
        n += (Array.isArray(o.left) ? o.left.join('').length : 0) + (Array.isArray(o.right) ? o.right.join('').length : 0);
      } else if (Array.isArray(q.options)) n += q.options.join('').length;
      return s + n;
    }, 0);
    avgChars[k] = Math.round(sum / pool.length);
  }
  /* 朗读时间 ≈ 字数/4（约 4 字/秒），每题基础答题时间：入门 14s / 进阶 13s / 实战 12s / BOSS 12s，
   * 再加连线题朗读余量（matching 平均多 6 字/对，统一按 +4 秒）。 */
  const readBase = { 1: 14, 2: 13, 3: 12, boss: 12 };
  const levelTimeBase = {};
  for (const k of ['1', '2', '3', 'boss']) {
    const readSec = Math.max(4, Math.round(avgChars[k] / 4));
    levelTimeBase[k] = Math.max(8, readBase[k] + readSec + (k === '1' ? 0 : 4));
  }
  return {
    avgChars, levelTimeBase,
    detail: { readSpeed: '4字/秒', readSec: avgChars, answerBase: readBase }
  };
}
/* 组卷：按章节/难度/题型/掌握情况筛选 */
function buildPaper(body) {
  const chs = Array.isArray(body.chapters) ? body.chapters.map(Number).filter(n => CHAPTERS.some(c => c.id === n)) : [];
  const diffs = Array.isArray(body.difficulties) ? body.difficulties.map(Number).filter(n => n >= 1 && n <= 5) : [];
  const types = Array.isArray(body.types) ? body.types.filter(t => ['single', 'judge', 'multi', 'fill', 'matching', 'calc'].includes(t)) : [];
  const mastery = body.mastery === 'weak' ? 'weak' : body.mastery === 'good' ? 'good' : 'all';
  const count = Math.max(1, Math.min(200, parseInt(body.count, 10) || 20));
  let pool = questions.slice();
  if (chs.length) pool = pool.filter(q => chs.includes(q.chapter));
  if (diffs.length) pool = pool.filter(q => diffs.includes(q.difficulty));
  if (types.length) pool = pool.filter(q => types.includes(q.type));
  if (mastery !== 'all') {
    // 掌握情况：按全班答题正确率筛选
    const stat = {};
    db.answerLogs.forEach(l => {
      const s = stat[l.qid] || (stat[l.qid] = { a: 0, c: 0 });
      s.a++; if (l.correct) s.c++;
    });
    pool = pool.filter(q => {
      const s = stat[q.id];
      if (!s || !s.a) return false; // 未答过的题不计入掌握筛选
      const acc = s.c / s.a;
      return mastery === 'weak' ? acc < 0.6 : acc >= 0.6;
    });
  }
  const rand = mulberry32(Date.now() % 99999);
  const picked = shuffle(pool, rand).slice(0, count);
  const chNames = chs.length ? chs.map(n => { const c = CHAPTERS.find(x => x.id === n); return n === 0 ? '导言' : '第' + n + '章 ' + c.name; }).join('、') : '全部章节';
  const title = '电工技术基础与技能 测验卷（' + chNames + (diffs.length ? '·难度' + diffs.join('/') : '') + '）';
  const typeOrder = ['single', 'judge', 'multi', 'fill', 'matching', 'calc'];
  const typeName = { single: '单选题', judge: '判断题', multi: '多选题', fill: '填空题', matching: '连线题', calc: '计算题' };
  const groups = typeOrder.filter(t => picked.some(q => q.type === t)).map(t => ({ type: t, name: typeName[t], questions: picked.filter(q => q.type === t) }));
  return { title, groups, total: picked.length, list: picked };
}
/* 渲染题干与选项文本（Word 兼容 HTML） */
function paperOptsHtml(q) {
  if (q.type === 'fill' || q.type === 'calc') return '';
  if (q.type === 'matching') {
    const o = q.options || {};
    const left = Array.isArray(o.left) ? o.left : [];
    const right = Array.isArray(o.right) ? o.right : [];
    const pairs = [];
    try { JSON.parse(q.answer || '[]').forEach(pr => pairs[pr[0]] = pr[1]); } catch (e) {}
    /* 两列对照排版：左列序号项 | 右列字母项 */
    const lc = left.map((l, i) => (i + 1) + '. ' + l).join('<br/>');
    const rc = right.map((r, i) => String.fromCharCode(65 + i) + '. ' + r).join('<br/>');
    return '<table style="width:100%;border-collapse:collapse;margin:6px 0;font-size:12pt"><tr>' +
      '<td style="width:50%;vertical-align:top;padding:4px 10px;border:1px solid #999">' + lc + '</td>' +
      '<td style="width:50%;vertical-align:top;padding:4px 10px;border:1px solid #999">' + rc + '</td>' +
      '</tr></table>' +
      (pairs.length ? '<p style="color:#666">配对参考答案：' + pairs.map((ri, li) => (li + 1) + '→' + String.fromCharCode(65 + (ri == null ? 0 : ri))).join('　') + '</p>' : '');
  }
  return '<p style="margin:2px 0">' + (Array.isArray(q.options) ? q.options.map((o, i) => String.fromCharCode(65 + i) + '. ' + String(o).replace(/^[A-Za-z][.、．]\s*/, '')).join('<br/>') : '') + '</p>';
}
/* 生成 Word/WPS 可打印 .doc（Word 兼容 HTML） */
/* 1.0.0.6 试卷排版：按题型分组、答题空间、计算题已知/求/解/答 */
/* 1.4.0.0：题干图片内嵌 base64（Word 兼容 HTML 不加载相对路径图片） */
function qimgDataUri(url) {
  if (!url) return '';
  try {
    const f = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(String(url))));
    if (!f.startsWith(PUBLIC_DIR) || !fs.existsSync(f)) return '';
    const ext = path.extname(f).replace('.', '').toLowerCase() || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return 'data:image/' + mime + ';base64,' + fs.readFileSync(f).toString('base64');
  } catch (e) { return ''; }
}
function paperToDoc(r, includeAnswer) {
  const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unit = db.settings.unit || '';
  const gameName = db.settings.gameName || '电闯关·电工大作战';
  const typeName = { single: '单选题', judge: '判断题', multi: '多选题', fill: '填空题', matching: '连线题', calc: '计算题' };
  const typeNo = { single: '一', judge: '二', multi: '三', fill: '四', matching: '五', calc: '六' };
  const typeTip = {
    single: '（每题只有一个正确答案）',
    judge: '（判断对错，正确打“√”，错误打“×”）',
    multi: '（每题有两个或两个以上正确答案，多选、少选、错选均不得分）',
    fill: '（将正确答案填写在横线上）',
    matching: '（将左列内容与右列对应的选项用线连接）',
    calc: '（请按“已知、求、解、答”四步作答，计算过程写在解中）'
  };
  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="utf-8"><title>' + escH(r.title) + '</title>';
  html += '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->';
  html += '<style>body{font-family:"宋体",SimSun,serif;font-size:12pt;line-height:1.9;color:#000;margin:0 28px} ' +
    '.paper-title{text-align:center;font-size:16pt;font-weight:bold;letter-spacing:2px;margin:6px 0} ' +
    '.paper-sub{text-align:center;font-size:10.5pt;color:#333;margin:4px 0 10px} ' +
    '.info-table{width:100%;border-collapse:collapse;margin:8px 0 14px} ' +
    '.info-table td{border:1px solid #000;padding:5px 8px;font-size:11pt;height:26px} ' +
    '.require{font-size:10.5pt;color:#333;margin:2px 0 10px} ' +
    'h3{font-size:12.5pt;font-weight:bold;margin:18px 0 6px;page-break-after:avoid} ' +
    '.q{margin:12px 0;page-break-inside:avoid} ' +
    '.opts{margin:3px 0 2px 24px;font-size:12pt;line-height:1.9} ' +
    '.judge-blank{display:inline-block;margin-left:16px} ' +
    '.fill-blank{display:inline-block;margin-left:14px;border-bottom:1.5px solid #000;width:120px;height:1.4em;vertical-align:bottom} ' +
    '.calc-frame{margin:8px 0 6px 24px;font-size:12pt;line-height:1.6} ' +
    '.calc-line{display:block;border-bottom:1px solid #000;height:1.5em;margin:6px 0 2px 2em} ' +
    '.calc-frame b{font-weight:bold} ' +
    '.ans{margin-top:4px;color:#222;font-size:10.5pt;border-top:1px dashed #aaa;padding-top:3px} .ans b{color:#c00} ' +
    '.footer{margin-top:26px;text-align:center;font-size:10.5pt;color:#555}</style></head>';
  html += '<body>';
  html += '<div class="paper-title">' + escH(r.title) + '</div>';
  html += '<div class="paper-sub">' + (unit ? escH(unit) + '　' : '') + escH(gameName) + '　共 ' + r.total + ' 题' + (includeAnswer ? '　（含参考答案）' : '') + '</div>';
  /* 考生信息栏 */
  html += '<table class="info-table"><tr><td style="width:14%">姓　名：</td><td style="width:36%">&nbsp;</td><td style="width:14%">班　级：</td><td style="width:36%">&nbsp;</td></tr>' +
    '<tr><td>学　号：</td><td>&nbsp;</td><td>得　分：</td><td>&nbsp;</td></tr></table>';
  html += '<p class="require">答题要求：' + r.groups.map(g => typeName[g.type] + ' ' + g.questions.length + ' 题').join('；') + '。请认真审题，书写工整，答完后检查。</p>';
  let no = 0;
  r.groups.forEach(g => {
    html += '<h3>' + typeNo[g.type] + '、' + typeName[g.type] + '（共 ' + g.questions.length + ' 题）' + typeTip[g.type] + '</h3>';
    g.questions.forEach(q => {
      no++;
      html += '<div class="q"><b>' + no + '.</b> ' + escH(q.question);
      const qimg = qimgDataUri(q.image);
      if (qimg) html += '<div style="text-align:' + (q.imageAlign || 'center') + ';margin:6px 0"><img src="' + qimg + '" style="width:' + (q.imgSize || 60) + '%;max-width:140mm;max-height:80mm;object-fit:contain"/></div>';
      if (q.type === 'single' || q.type === 'multi') {
        html += '<div class="opts">' + (Array.isArray(q.options) ? q.options.map((o, i) => String.fromCharCode(65 + i) + '. ' + String(o).replace(/^[A-Za-z][.、．]s*/, '')).join('　　') : '') + '</div>';
      } else if (q.type === 'judge') {
        html += '<span class="judge-blank">（&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;）</span>';
      } else if (q.type === 'fill') {
        html += '<span class="fill-blank"></span>';
      } else if (q.type === 'matching') {
        html += paperOptsHtml(q);
      } else if (q.type === 'calc') {
        /* 计算题：已知/求/解/答 答题框架 */
        html += '<div class="calc-frame"><b>已知：</b><span class="calc-line"></span><b>求：</b><span class="calc-line"></span>' +
          '<b>解：</b><span class="calc-line"></span><span class="calc-line"></span><span class="calc-line"></span>' +
          '<b>答：</b><span class="calc-line"></span></div>';
      }
      if (includeAnswer) {
        if (q.type === 'matching') {
          html += '<div class="ans">' + paperOptsHtml(q) + '</div>';
        } else {
          html += '<div class="ans">参考答案：<b>' + escH(q.answer) + '</b>' + (q.explain ? '<br/>解析：' + escH(q.explain) : '') + '</div>';
        }
      }
      html += '</div>';
    });
  });
  html += '<div class="footer">—— ' + escH(gameName) + ' · ' + escH(unit || '') + ' 自动组卷（题型：' + escH(r.groups.map(g => typeName[g.type]).join('、')) + '）——</div>';
  html += '</body></html>';
  return html;
}

/* ============ 1.3.0.0 标准试卷 / 机读答题卡导出 ============ */
/* 标准正规考试试卷（密封线/分值/注意事项/答题空间） */
function examToDoc(r, includeAnswer) {
  const escH = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unit = db.settings.unit || '';
  const gameName = db.settings.gameName || '电闯关·电工大作战';
  const typeName = { single: '单选题', judge: '判断题', multi: '多选题', fill: '填空题', matching: '连线题', calc: '计算题' };
  const typeTip = {
    single: '（每题只有一个正确答案）', judge: '（判断对错，正确打“√”，错误打“×”）',
    multi: '（每题有两个或两个以上正确答案，多选、少选、错选均不得分）', fill: '（将正确答案填写在横线上）',
    matching: '（将左列与右列对应的选项用线连接）', calc: '（请按“已知、求、解、答”四步作答，写出完整计算过程）'
  };
  let no = 0;
  const groupScore = (arr) => arr.reduce((s2, x) => s2 + (x.score || 1), 0);
  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="utf-8"><title>' + escH(r.title) + '</title>';
  html += '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->';
  html += '<style>body{font-family:"宋体",SimSun,serif;font-size:12pt;line-height:1.9;color:#000;margin:0 20px} ' +
    '.seal{position:relative;float:left;width:26px;margin:0 8px 0 0;border-left:1px dashed #000;border-right:1px dashed #000;height:740px;font-size:9pt;text-align:center;padding:4px 2px} ' +
    '.seal div{margin:10px 0;letter-spacing:3px} ' +
    '.paper-title{text-align:center;font-size:16pt;font-weight:bold;letter-spacing:3px;margin:4px 0 2px} ' +
    '.paper-sub{text-align:center;font-size:10.5pt;color:#333;margin:2px 0 6px} ' +
    '.info-table{width:100%;border-collapse:collapse;margin:6px 0 8px} .info-table td{border:1px solid #000;padding:4px 8px;font-size:11pt;height:26px} ' +
    '.require{font-size:10.5pt;color:#333;margin:4px 0 8px} .require b{color:#000} ' +
    'h3{font-size:12.5pt;font-weight:bold;margin:14px 0 6px;page-break-after:avoid} ' +
    '.q{margin:10px 0;page-break-inside:avoid} .q .no{font-weight:bold} ' +
    '.opts{margin:2px 0 2px 26px;font-size:12pt;line-height:1.9} ' +
    '.judge-blank{display:inline-block;margin-left:18px} ' +
    '.fill-blank{display:inline-block;margin-left:12px;border-bottom:1.5px solid #000;width:120px;height:1.4em;vertical-align:bottom} ' +
    '.calc-frame{margin:6px 0 4px 24px;font-size:12pt;line-height:1.6} .calc-line{display:block;border-bottom:1px solid #000;height:1.5em;margin:6px 0 2px 2em} ' +
    '.ans{margin-top:4px;color:#222;font-size:10.5pt;border-top:1px dashed #aaa;padding-top:3px} .ans b{color:#c00} ' +
    '.footer{margin-top:24px;text-align:center;font-size:10.5pt;color:#555} ' +
    '.score-row{width:100%;border-collapse:collapse;margin-top:10px} .score-row td{border:1px solid #000;height:34px;text-align:center;font-size:11pt}</style></head>';
  html += '<body><table style="width:100%;border-collapse:collapse"><tr><td style="width:34px;vertical-align:top;padding:0">';
  /* 密封线 */
  html += '<div class="seal"><div>┄┄ 装 ┄ 订 ┄ 线 ┄┄</div><div>班 级：________</div><div>姓 名：________</div><div>考 号：________</div><div>┄┄ 装 ┄ 订 ┄ 线 ┄┄</div></div>';
  html += '</td><td style="vertical-align:top;padding:0 4px">';
  html += '<div class="paper-title">' + escH(r.title) + '</div>';
  html += '<div class="paper-sub">' + (unit ? escH(unit) + '　' : '') + escH(gameName) + '　·　' + escH(r.subject || '电工技术基础与技能') +
    '　·　考试时间 60 分钟　·　满分 ' + r.totalScore + ' 分</div>';
  html += '<table class="info-table"><tr><td style="width:14%">班　级：</td><td style="width:36%">&nbsp;</td><td style="width:14%">姓　名：</td><td style="width:36%">&nbsp;</td></tr>' +
    '<tr><td>考　号：</td><td>&nbsp;</td><td>得　分：</td><td>&nbsp;</td></tr></table>';
  html += '<p class="require"><b>注意事项：</b>1. 答题前请将班级、姓名、考号填写清楚；2. 客观题（选择、判断、多选）请用 2B 铅笔在答题卡上填涂，主观题请在试卷上作答；' +
    '3. 本试卷共 ' + r.total + ' 题，满分 ' + r.totalScore + ' 分，考试时间 60 分钟；4. 请认真审题，字迹工整，答完仔细检查。</p>';
  const no2 = { single: '一', judge: '二', multi: '三', fill: '四', matching: '五', calc: '六' };
  r.groups.forEach(g => {
    const sc = groupScore(g.questions);
    html += '<h3>' + no2[g.type] + '、' + typeName[g.type] + '（共 ' + g.questions.length + ' 题，每题 ' + (g.questions[0] ? g.questions[0].score : 1) + ' 分，共 ' + sc + ' 分）' + typeTip[g.type] + '</h3>';
    g.questions.forEach(q => {
      no++;
      html += '<div class="q"><span class="no">' + no + '.</span> ' + escH(q.question);
      const qimg2 = qimgDataUri(q.image);
      if (qimg2) html += '<div style="text-align:' + (q.imageAlign || 'center') + ';margin:6px 0"><img src="' + qimg2 + '" style="width:' + (q.imgSize || 60) + '%;max-width:140mm;max-height:80mm;object-fit:contain"/></div>';
      if (q.type === 'single' || q.type === 'multi') {
        html += '<div class="opts">' + (Array.isArray(q.options) ? q.options.map((o, i) => String.fromCharCode(65 + i) + '. ' + String(o).replace(/^[A-Za-z][.、．]\s*/, '')).join('　　') : '') + '</div>';
      } else if (q.type === 'judge') {
        html += '<span class="judge-blank">（&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;）</span>';
      } else if (q.type === 'fill') {
        html += '<span class="fill-blank"></span>';
      } else if (q.type === 'matching') {
        const o = q.options || {};
        html += '<div class="opts">' + (Array.isArray(o.left) ? o.left.map((l, i) => (i + 1) + '. ' + l).join('　　') : '') + '</div>' +
          '<div class="opts">' + (Array.isArray(o.right) ? o.right.map((rr, i) => String.fromCharCode(65 + i) + '. ' + rr).join('　　') : '') + '</div>';
      } else if (q.type === 'calc') {
        html += '<div class="calc-frame"><b>已知：</b><span class="calc-line"></span><b>求：</b><span class="calc-line"></span>' +
          '<b>解：</b><span class="calc-line"></span><span class="calc-line"></span><span class="calc-line"></span><b>答：</b><span class="calc-line"></span></div>';
      }
      if (includeAnswer) {
        if (q.type === 'matching') {
          let pairs = []; try { pairs = JSON.parse(q.answer || '[]'); } catch (e) {}
          html += '<div class="ans">参考答案：<b>' + pairs.map((pr, li) => (li + 1) + '→' + String.fromCharCode(65 + (pr[1] == null ? 0 : pr[1]))).join('　') + '</b>' + (q.explain ? '<br/>解析：' + escH(q.explain) : '') + '</div>';
        } else {
          html += '<div class="ans">参考答案：<b>' + escH(q.answer) + '</b>' + (q.explain ? '<br/>解析：' + escH(q.explain) : '') + '</div>';
        }
      }
      html += '</div>';
    });
  });
  html += '<table class="score-row"><tr><td style="width:20%">题类</td><td>客观题（选择/判断/多选/填空）</td><td>主观题（连线/计算）</td><td style="width:16%">总分</td></tr>' +
    '<tr><td>得分</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table>';
  html += '<div class="footer">—— ' + escH(gameName) + ' · ' + escH(unit || '') + ' ——</div>';
  html += '</td></tr></table></body></html>';
  return html;
}
/* 标准机读答题卡（OMR）：定位标记 + 考号填涂 + 客观题涂卡 + 主观题区 */
function cardToDoc(r) {
  const escH = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unit = db.settings.unit || '';
  const gameName = db.settings.gameName || '电闯关·电工大作战';
  const typeName = { single: '单选题', judge: '判断题', multi: '多选题', fill: '填空题', matching: '连线题', calc: '计算题' };
  const singles = r.list.filter(x => x.type === 'single' || x.type === 'multi');
  const judges = r.list.filter(x => x.type === 'judge');
  const subs = r.list.filter(x => ['fill', 'matching', 'calc'].includes(x.type));
  const colW = singles.length ? Math.ceil(singles.length / 4) : 0;
  const rowH = 42;
  const letters = ['A', 'B', 'C', 'D'];
  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="utf-8"><title>' + escH(r.title) + ' 答题卡</title>';
  html += '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->';
  html += '<style>body{font-family:"宋体",SimSun,serif;font-size:11pt;color:#000;margin:0 18px} ' +
    '.reg-marks{position:relative;width:100%;height:8px} .reg{position:absolute;top:0;width:6px;height:6px;background:#000} ' +
    '.card-title{text-align:center;font-size:14pt;font-weight:bold;letter-spacing:2px;margin:2px 0} ' +
    '.card-sub{text-align:center;font-size:9.5pt;color:#333;margin:2px 0 6px} ' +
    '.info-table{width:100%;border-collapse:collapse;margin:4px 0 8px} .info-table td{border:1px solid #000;padding:3px 6px;font-size:10.5pt;height:24px} ' +
    '.info-table input{width:100%;border:none;font-size:10.5pt} ' +
    '.stu-no{width:100%;border-collapse:collapse;margin:4px 0 8px;text-align:center;font-size:9.5pt} .stu-no td{border:1px solid #000;height:26px;padding:2px 1px} .stu-no .hl{background:#000;color:#fff} ' +
    '.sec{font-size:11pt;font-weight:bold;margin:10px 0 4px;page-break-after:avoid} ' +
    '.bubble-table{width:100%;border-collapse:collapse;font-size:10pt;text-align:center;page-break-inside:avoid} ' +
    '.bubble-table td{border:1px solid #000;height:34px;padding:2px} .bubble-table .no-cell{width:38px;font-weight:bold;background:#f2f2f2} ' +
    '.bubble{display:inline-block;width:14px;height:14px;border:1.5px solid #000;border-radius:8px;margin:0 7px;vertical-align:middle} ' +
    '.sub-zone{margin:6px 0} .sub-item{page-break-inside:avoid;margin:6px 0} .sub-item .q{font-size:10.5pt} ' +
    '.sub-lines{margin:2px 0 0 8px} .sub-lines div{border-bottom:1px solid #000;height:1.6em;margin:4px 0 2px 2em} ' +
    '.calc-frame{margin:4px 0 2px 8px;font-size:10.5pt;line-height:1.5} .calc-line{display:block;border-bottom:1px solid #000;height:1.5em;margin:5px 0 2px 2em} ' +
    '.foot{margin-top:12px;text-align:center;font-size:9.5pt;color:#555;border-top:1px solid #000;padding-top:4px} ' +
    '.mark-row{width:100%;border-collapse:collapse;margin-top:8px;font-size:10pt;text-align:center} .mark-row td{border:1px solid #000;height:30px}</style></head>';
  html += '<body>';
  html += '<div class="reg-marks"><span class="reg" style="left:0"></span><span class="reg" style="right:0"></span></div>';
  html += '<div class="card-title">' + escH(r.title) + '　机读答题卡</div>';
  html += '<div class="card-sub">' + (unit ? escH(unit) + '　' : '') + escH(gameName) + '　·　共 ' + r.total + ' 题 / ' + r.totalScore + ' 分</div>';
  html += '<table class="info-table"><tr><td style="width:12%">姓　名</td><td style="width:26%">&nbsp;</td><td style="width:12%">班　级</td><td style="width:22%">&nbsp;</td><td style="width:10%">学　号</td><td>&nbsp;</td></tr></table>';
  /* 准考证号填涂（10 位） */
  html += '<div style="font-size:10pt;margin:2px 0">准 考 证 号：</div><table class="stu-no"><tr><td>考号位</td>' + [1,2,3,4,5,6,7,8,9,10].map(i => '<td>' + i + '</td>').join('') + '</tr>' +
    [0,1,2,3,4,5,6,7,8,9].map(d => '<tr><td class="hl" style="background:#000;color:#fff">' + d + '</td>' + [0,1,2,3,4,5,6,7,8,9].map(() => '<td class="bubble"></td>').join('') + '</tr>').join('') + '</table>';
  /* 客观题：单选/多选 */
  if (singles.length) {
    html += '<div class="sec">一、客观题（单选题 / 多选题）—— 用 2B 铅笔填涂，多选可涂多个</div>';
    html += '<table class="bubble-table"><tr><td class="no-cell">题号</td><td>A</td><td>B</td><td>C</td><td>D</td></tr>';
    singles.forEach((q, i) => {
      html += '<tr><td class="no-cell">' + (i + 1) + '</td><td class="bubble"></td><td class="bubble"></td><td class="bubble"></td><td class="bubble"></td></tr>';
    });
    html += '</table>';
  }
  /* 判断题 */
  if (judges.length) {
    html += '<div class="sec">二、判断题 —— 正确涂 A（√），错误涂 B（×）</div>';
    html += '<table class="bubble-table"><tr><td class="no-cell">题号</td><td>A（√）</td><td>B（×）</td></tr>';
    judges.forEach((q, i) => {
      html += '<tr><td class="no-cell">' + (singles.length + i + 1) + '</td><td class="bubble"></td><td class="bubble"></td></tr>';
    });
    html += '</table>';
  }
  /* 主观题：填空/连线/计算 手写区 */
  if (subs.length) {
    html += '<div class="sec">三、主观题（填空 / 连线 / 计算）—— 用黑色签字笔在对应区域作答</div>';
    let subNo = singles.length + judges.length;
    subs.forEach(q => {
      subNo++;
      html += '<div class="sub-item"><div class="q"><b>' + subNo + '.</b> ' + escH(q.question) + '（' + q.score + ' 分）';
      const qimg3 = qimgDataUri(q.image);
      if (qimg3) html += '<div style="text-align:' + (q.imageAlign || 'center') + ';margin:4px 0"><img src="' + qimg3 + '" style="width:' + (q.imgSize || 60) + '%;max-width:140mm;max-height:70mm;object-fit:contain"/></div>';
      html += '</div>';
      if (q.type === 'fill') {
        html += '<div class="sub-lines"><div></div><div></div></div>';
      } else if (q.type === 'matching') {
        const o = q.options || {};
        html += '<div style="font-size:10.5pt;margin:2px 0 2px 8px">' + (Array.isArray(o.left) ? o.left.map((l, i) => (i + 1) + '. ' + l).join('　　') : '') + '</div>' +
          '<div style="font-size:10.5pt;margin:2px 0 4px 8px">' + (Array.isArray(o.right) ? o.right.map((rr, i) => String.fromCharCode(65 + i) + '. ' + rr).join('　　') : '') + '</div>' +
          '<div class="sub-lines"><div></div><div></div></div>';
      } else if (q.type === 'calc') {
        html += '<div class="calc-frame"><b>已知：</b><span class="calc-line"></span><b>求：</b><span class="calc-line"></span><b>解：</b><span class="calc-line"></span><span class="calc-line"></span><span class="calc-line"></span><b>答：</b><span class="calc-line"></span></div>';
      }
      html += '</div>';
    });
  }
  html += '<table class="mark-row"><tr><td>客观题得分</td><td>主观题得分</td><td>总分</td><td>阅卷人</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table>';
  html += '<div class="reg-marks" style="margin-top:10px"><span class="reg" style="left:0"></span><span class="reg" style="right:0"></span></div>';
  html += '<div class="foot">' + escH(gameName) + ' · ' + escH(unit || '') + ' · 机读答题卡（1.3.0.0）</div>';
  html += '</body></html>';
  return html;
}
function publicExam(e, withAnswer) {
  const qs = (e.questions || []).map(q => withAnswer ? q : { id: q.id, chapter: q.chapter, section: q.section, type: q.type, question: q.question, options: q.options, difficulty: q.difficulty, score: q.score, image: q.image || '', imageAlign: q.imageAlign || 'center', imgSize: q.imgSize || 60 });
  return { id: e.id, title: e.title, subject: e.subject, className: e.className, grade: e.grade,
    createdAt: e.createdAt, status: e.status, questions: qs, qcount: e.qcount, totalScore: e.totalScore,
    createdBy: e.createdBy, publishedAt: e.publishedAt, note: e.note || '' };
}

function validateQuestion(b) {
  const chapters = CHAPTERS.map(c => c.id);
  const types = ['single', 'judge', 'multi', 'fill', 'matching', 'calc'];
  if (!chapters.includes(Number(b.chapter))) return '章节无效';
  if (!types.includes(b.type)) return '题型无效';
  if (!b.question || !String(b.question).trim()) return '题干不能为空';
  if (b.imageAlign !== undefined && !['left', 'center', 'right'].includes(b.imageAlign)) return '图片对齐方式只能是 left/center/right';
  if (b.imgSize !== undefined && !(Number(b.imgSize) >= 20 && Number(b.imgSize) <= 100)) return '图片大小需在 20~100（百分比）之间';
  if (b.type === 'matching') {
    // 连线题：options 为 {left:[...], right:[...]}，answer 为配对 JSON 字符串 [[左下标,右下标],...]
    const o = b.options;
    if (!o || !Array.isArray(o.left) || !Array.isArray(o.right) || !o.left.length || !o.right.length) return '连线题需提供左右两列（left/right 数组）';
    if (o.left.length !== o.right.length) return '连线题左右列数量必须一致';
    let pairs = [];
    try { pairs = JSON.parse(String(b.answer)); } catch (e) { return '连线题答案须为配对 JSON，如 [[0,0],[1,1]]'; }
    if (!Array.isArray(pairs) || pairs.length !== o.left.length) return '连线题答案须覆盖每一对，格式如 [[0,0],[1,1]]';
    for (const pr of pairs) {
      if (!Array.isArray(pr) || pr.length !== 2 || !Number.isInteger(pr[0]) || !Number.isInteger(pr[1]) ||
        pr[0] < 0 || pr[0] >= o.left.length || pr[1] < 0 || pr[1] >= o.right.length) return '连线题答案下标越界';
    }
    return null;
  }
  if (b.type === 'fill') {
    if (!b.answer || !String(b.answer).trim()) return '填空答案不能为空';
    return null;
  }
  if (b.type === 'calc') {
    if (!b.answer || !String(b.answer).trim()) return '计算题答案不能为空（填最终结果数值）';
    return null;
  }
  if (!Array.isArray(b.options) || b.options.length < 2) return '至少需要 2 个选项';
  if (!String(b.answer).trim()) return '答案不能为空';
  const ans = String(b.answer).trim().toUpperCase();
  if (b.type === 'multi') {
    const letters = ans.split(/[,，]/).map(x => x.trim()).filter(Boolean);
    if (!letters.length || letters.some(l => !/^[A-Z]$/.test(l))) return '多选答案格式应为 A,B,C';
    return null;
  }
  if (!/^[A-Z]$/.test(ans)) return '单选/判断答案应为 A/B/C/D 形式';
  return null;
}

/* 启动：初始化 JSON 数据库（读题库/业务库/保证教师账号）后监听 */
acc.init().then(async () => {
  questions = acc.state.questions;
  // 1.0.0.4：版本号与展示单位随程序更新（升级旧数据无需手工改库）
  if (db.settings.version !== VERSION) {
    db.settings.version = VERSION;
    await acc.setSetting('version', VERSION);
  }
  // 1.0.0.5：默认关卡题数与自动计时（无配置时初始化，教师可在时间设置中修改）
  if (!db.settings.levelQ) {
    const dq = { 1: 6, 2: 8, 3: 10, boss: 5 };
    await acc.setSetting('levelQ', JSON.stringify(dq));
    db.settings.levelQ = dq;
    const auto = computeLevelTime(dq);
    await acc.setSetting('levelTimeBase', JSON.stringify(auto.levelTimeBase));
    db.settings.levelTimeBase = auto.levelTimeBase;
    console.log('关卡配置初始化：题数 6/8/10/5，每题自动计时 ' + auto.levelTimeBase['1'] + '~' + auto.levelTimeBase['boss'] + ' 秒');
  }
  server.listen(PORT, '0.0.0.0', () => {
    process.title = '电闯关服务端-JSON版 V' + VERSION;
    try { require('child_process').execSync('title ' + process.title, { stdio: 'ignore' }); } catch (e) {}
    console.log('============================================');
    console.log('  电闯关·电工大作战 服务端已启动 (JSON 数据库)');
    console.log('  版本       : ' + VERSION);
    console.log('  本机访问   : http://localhost:' + PORT);
    console.log('  局域网访问 : http://<本机IP>:' + PORT + '  (手机/其他电脑同WiFi可访问)');
    console.log('  题库题数   : ' + questions.length);
    console.log('  数据文件   : ' + acc.DB_FILE);
    console.log('  按 Ctrl+C 停止服务');
    console.log('============================================');
  });
}).catch(e => {
  console.error('数据库初始化失败: ' + e.message);
  process.exit(1);
});
