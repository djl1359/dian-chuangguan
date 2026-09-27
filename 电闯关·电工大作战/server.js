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
const acc = require('./store.js');

const PORT = process.env.PORT || 8123;
const VERSION = '1.0.0.5';
const ROOT = acc.APP_DIR;
const PUBLIC_DIR = path.join(ROOT, 'public');
/* 试卷令牌密钥（进程启动时随机生成，重启后旧令牌自然失效） */
const PAPER_SECRET = crypto.randomBytes(32);

/* 填空题答案匹配（与前端 Norm.answerMatch 同规则） */
function normText(s) {
  return String(s == null ? '' : s).trim().replace(/[\s_　]+/g, '').toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}
function answerMatch(user, correct) {
  const a = normText(user), b = normText(correct);
  if (!a || !b) return false;
  if (a === b) return true;
  if (/^-?\d+(\.\d+)?$/.test(b) && /^-?\d+(\.\d+)?$/.test(a)) {
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
  if (qq.type === 'fill') {
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
      list.push({ id: q.id, chapter: q.chapter, type: q.type, question: q.question, options: q.options || { left: [], right: [] }, explain: q.explain || '' });
      entries.push({ id: q.id, perm: null });
      continue;
    }
    const sp = shuffleWithPerm(q.options, rand);
    list.push({
      id: q.id, chapter: q.chapter, type: q.type,
      question: q.question, options: sp.opts,
      explain: q.explain || ''
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
      let file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : decodeURIComponent(p)));
      if (!file.startsWith(PUBLIC_DIR)) { sendJSON(res, 403, { err: 'forbidden' }); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h1>404 Not Found</h1>'); return; }
        const ext = path.extname(file).toLowerCase();
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
      return sendJSON(res, 200, { chapters: CHAPTERS, levels: LEVELS, unit: db.settings.unit || '', gameName: db.settings.gameName || '电闯关·电工大作战', version: db.settings.version || 'V2.0', settings: db.settings || {} });
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
      const allowTypes = level === 1 ? ['single', 'judge'] : ['single', 'judge', 'multi', 'fill', 'matching'];
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
          list.push({ id: qq.id, chapter: qq.chapter, type: qq.type, question: qq.question, options: qq.options || { left: [], right: [] }, explain: qq.explain || '' });
          entries.push({ id: qq.id, perm: null });
          continue;
        }
        const sp = shuffleWithPerm(qq.options, rand);
        list.push({ id: qq.id, chapter: qq.chapter, type: qq.type, question: qq.question, options: sp.opts, explain: qq.explain || '' });
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
      const logs = db.answerLogs.filter(l => l.chapter === ch);
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
      const logs = db.answerLogs.filter(l => l.chapter === ch && l.section === sec);
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
      return sendJSON(res, 200, { list, total: questions.length });
    }
    // 教师-新增题目
    if (p === '/api/questions/admin' && req.method === 'POST') {
      const a = auth('teacher');
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const v = validateQuestion(body);
      if (v) return sendJSON(res, 400, { err: v });
      const maxId = questions.reduce((m, x) => Math.max(m, x.id), 0);
      const nq = { id: maxId + 1, chapter: Number(body.chapter), section: Number(body.section) || 1, type: body.type, question: String(body.question).trim(), options: body.options, answer: String(body.answer).trim(), explain: String(body.explain || '').trim(), difficulty: clampDiff(body.difficulty) };
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
      qq.options = body.options; qq.answer = String(body.answer).trim(); qq.explain = String(body.explain || '').trim(); qq.difficulty = clampDiff(body.difficulty);
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
        '12,1,matching,请将下列物理量与对应的符号连线。,左:电流|电压;右:I|U,0-0;1-1,电流-I、电压-U。,3'
      ];
      let csv = 'chapter,section,type,question,options,answer,explain,difficulty\r\n';
      // 模板说明注释行（# 开头，导入时会忽略）
      csv += '# 试题导入模板说明（本行及#开头的行导入时忽略）\r\n';
      csv += '# chapter:章节号0~12；section:节号1~5；type:single单选/judge判断/multi多选/fill填空/matching连线\r\n';
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
  const typesByLevel = { 1: ['single', 'judge'], 2: ['single', 'judge', 'multi', 'fill', 'matching'], 3: ['single', 'judge', 'multi', 'fill', 'matching'], boss: ['single', 'judge', 'multi', 'fill', 'matching'] };
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
  const types = Array.isArray(body.types) ? body.types.filter(t => ['single', 'judge', 'multi', 'fill', 'matching'].includes(t)) : [];
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
  const groups = [];
  CHAPTERS.forEach(c => {
    const qs = picked.filter(q => q.chapter === c.id);
    if (qs.length) groups.push({ chapter: c.id, name: c.name, questions: qs });
  });
  return { title, groups, total: picked.length, list: picked };
}
/* 渲染题干与选项文本（Word 兼容 HTML） */
function paperOptsHtml(q) {
  if (q.type === 'matching') {
    const o = q.options || {};
    const left = Array.isArray(o.left) ? o.left : [];
    const right = Array.isArray(o.right) ? o.right : [];
    const pairs = [];
    try { JSON.parse(q.answer || '[]').forEach(pr => pairs[pr[0]] = pr[1]); } catch (e) {}
    return '<p style="margin:4px 0">' + left.map((l, i) => (i + 1) + '. ' + l).join('　　') + '</p>' +
      '<p style="margin:4px 0">' + right.map((r, i) => String.fromCharCode(65 + i) + '. ' + r).join('　　') + '</p>' +
      (pairs.length ? '<p style="color:#666">配对参考答案：' + pairs.map((ri, li) => (li + 1) + '→' + String.fromCharCode(65 + (ri == null ? 0 : ri))).join('　') + '</p>' : '');
  }
  return '<p style="margin:2px 0">' + (Array.isArray(q.options) ? q.options.map((o, i) => String.fromCharCode(65 + i) + '. ' + String(o).replace(/^[A-Za-z][.、．]\s*/, '')).join('<br/>') : '') + '</p>';
}
/* 生成 Word/WPS 可打印 .doc（Word 兼容 HTML） */
function paperToDoc(r, includeAnswer) {
  const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unit = db.settings.unit || '';
  const gameName = db.settings.gameName || '电闯关·电工大作战';
  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="utf-8"><title>' + escH(r.title) + '</title>';
  html += '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->';
  html += '<style>body{font-family:"宋体",SimSun,serif;font-size:12pt;line-height:1.8;color:#000} .paper-title{text-align:center;font-size:16pt;font-weight:bold} .paper-sub{text-align:center;font-size:10.5pt;color:#444;margin:6px 0 12px} h3{font-size:12pt;border-bottom:1px solid #999;padding-bottom:2px} .q{margin:10px 0} .ans{color:#333;font-size:10.5pt} .ans b{color:#c00}</style></head>';
  html += '<body>';
  html += '<div class="paper-title">' + escH(r.title) + '</div>';
  html += '<div class="paper-sub">' + (unit ? escH(unit) + '　' : '') + escH(gameName) + '　共 ' + r.total + ' 题' + (includeAnswer ? '　（含参考答案）' : '') + '</div>';
  let no = 0;
  r.groups.forEach(g => {
    html += '<h3>' + (g.chapter === 0 ? '导言' : '第' + g.chapter + '章') + '　' + escH(g.name) + '（' + g.questions.length + ' 题）</h3>';
    g.questions.forEach(q => {
      no++;
      html += '<div class="q"><b>' + no + '.</b> ' + escH(q.question);
      if (q.type !== 'fill' && q.type !== 'judge') html += '<br/>' + paperOptsHtml(q);
      if (includeAnswer) {
        html += '<div class="ans">答案：<b>' + (q.type === 'matching' ? '见配对' : escH(q.answer)) + '</b>';
        if (q.explain) html += '<br/>解析：' + escH(q.explain);
        html += '</div>';
      }
      html += '</div>';
    });
  });
  if (includeAnswer) {
    html += '<p style="margin-top:16px">—— ' + escH(gameName) + ' · ' + (unit || '') + ' 自动组卷（难度标注：' + escH([1, 2, 3, 4, 5].map(n => n + '星').join('/')) + '）——</p>';
  } else {
    html += '<p style="margin-top:16px">姓名：__________　班级：__________　得分：__________</p>';
    html += '<p style="margin-top:8px;color:#666">—— 本卷由 ' + escH(gameName) + ' 自动组卷生成，请老师打印后使用 ——</p>';
  }
  html += '</body></html>';
  return html;
}

function validateQuestion(b) {
  const chapters = CHAPTERS.map(c => c.id);
  const types = ['single', 'judge', 'multi', 'fill', 'matching'];
  if (!chapters.includes(Number(b.chapter))) return '章节无效';
  if (!types.includes(b.type)) return '题型无效';
  if (!b.question || !String(b.question).trim()) return '题干不能为空';
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
