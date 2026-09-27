/* ============================================================
 * 电闯关·电工大作战 — 服务端（零依赖 Node.js + JSON 数据库，第一版）
 * 《电工技术基础与技能（第4版）》周绍敏主编 动作闯关游戏
 * 运行：node server.js   (或双击 start.bat / 电闯关服务端.exe)
 * 端口：8123（默认，可用环境变量 PORT 修改）
 * 数据：data/db.json（业务数据）+ data/questions.json（题库）
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acc = require('./store.js');

const PORT = process.env.PORT || 8123;
const ROOT = acc.APP_DIR;
const PUBLIC_DIR = path.join(ROOT, 'public');

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
  return { token, user: publicUser(user) };
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
function pickQuestions(chapter, limit, userId, allowTypes) {
  const pool = questions.filter(q => q.chapter === chapter && allowTypes.includes(q.type));
  if (!pool.length) return [];
  const recent = (db.wrongs[userId] || []).map(w => w.qid);
  let cand = pool.filter(q => !recent.includes(q.id));
  if (cand.length < limit) cand = pool;
  const seed = (userId ? userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : 7) + chapter * 131 + limit * 17 + Date.now() % 1000;
  const rand = mulberry32(seed);
  const picked = shuffle(cand, rand).slice(0, limit);
  return picked.map(q => {
    if (q.type === 'matching') {
      // 连线题：左右列原样下发（answer 为配对 JSON 字符串，客户端用于判定）
      return {
        id: q.id, chapter: q.chapter, type: q.type,
        question: q.question, options: q.options || { left: [], right: [] },
        answer: String(q.answer || ''), explain: q.explain || ''
      };
    }
    const opts = shuffle(q.options, rand);
    let answerIdx = null;
    if (q.type === 'fill') {
      answerIdx = null;
    } else if (q.type === 'multi') {
      const letters = String(q.answer).split(/[,，]/).map(x => x.trim()).filter(Boolean);
      answerIdx = letters.map(l => opts.indexOf(q.options[l.charCodeAt(0) - 65])).filter(i => i >= 0);
    } else {
      answerIdx = opts.indexOf(q.options[q.answer.charCodeAt(0) - 65]);
    }
    return {
      id: q.id, chapter: q.chapter, type: q.type,
      question: q.question, options: opts,
      answerIdx,
      answer: q.type === 'fill' ? String(q.answer) : null,
      explain: q.explain || ''
    };
  });
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
      return sendJSON(res, 200, { chapters: CHAPTERS, levels: LEVELS, unit: db.settings.unit || '', version: db.settings.version || 'V2.0', settings: db.settings || {} });
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
      const ta = parseInt(db.settings.timeAdd, 10);
      cfg.time = cfg.time + (isNaN(ta) ? 5 : ta);
      if (!CHAPTERS.find(c => c.id === chapter) || !cfg) return sendJSON(res, 400, { err: '参数错误' });
      const allowTypes = level === 1 ? ['single', 'judge'] : ['single', 'judge', 'multi', 'fill', 'matching'];
      const list = pickQuestions(chapter, cfg.q, a.user.id, allowTypes);
      if (!list.length) return sendJSON(res, 404, { err: '该章节暂无可用题目，请联系老师在题库中添加' });
      return sendJSON(res, 200, { questions: list, cfg });
    }
    // 提交答题结果（累计正确/错题/积分）
    if (p === '/api/answer' && req.method === 'POST') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const user = a.user;
      user.total = (user.total || 0) + 1;
      // 记录每题答题明细（成绩分析用：全班正确率、对/错名单、掌握情况）
      {
        const qq = questions.find(x => x.id === body.qid);
        db.answerLogs.push({ t: Date.now(), userId: user.id, name: user.name, qid: body.qid, chapter: qq ? qq.chapter : Number(body.chapter), section: qq ? (qq.section || 1) : 1, correct: !!body.correct });
        if (db.answerLogs.length > 200000) db.answerLogs = db.answerLogs.slice(-200000);
        await acc.logAnswer(db.answerLogs[db.answerLogs.length - 1]);
      }
      user.score = Math.max(0, (user.score || 0) + (parseInt(body.score, 10) || 0));
      if (body.correct) {
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
          const nw = { qid: body.qid, chapter: body.chapter, count: 1, last: Date.now(), good: 0 };
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
      return sendJSON(res, 200, { user: publicUser(user) });
    }
    // 保存关卡进度（星星）
    if (p === '/api/progress' && req.method === 'POST') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      const cp = db.progress[a.user.id] || {};
      const ch = cp[body.chapter] || {};
      const key = String(body.level) === 'boss' ? 'boss' : 'lv' + body.level;
      if (typeof body.stars === 'number' && (ch[key] === undefined || body.stars > ch[key])) ch[key] = body.stars;
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
    // 错题重练：取一道错题（随机）
    if (p === '/api/wrong/practice' && req.method === 'GET') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const wr = db.wrongs[a.user.id] || [];
      if (!wr.length) return sendJSON(res, 200, { list: [] });
      const rand = mulberry32(Date.now() % 99999);
      const picks = shuffle(wr, rand).slice(0, 5);
      const list = picks.map(w => {
        const qq = questions.find(x => x.id === w.qid);
        if (!qq) return null;
        if (qq.type === 'matching') {
          return { id: qq.id, chapter: qq.chapter, type: qq.type, question: qq.question, options: qq.options || { left: [], right: [] }, answer: String(qq.answer || ''), explain: qq.explain || '' };
        }
        const opts = shuffle(qq.options, rand);
        let answerIdx = null;
        if (qq.type === 'fill') {
          answerIdx = null;
        } else if (qq.type === 'multi') {
          const letters = String(qq.answer).split(/[,，]/).map(x => x.trim()).filter(Boolean);
          answerIdx = letters.map(l => opts.indexOf(qq.options[l.charCodeAt(0) - 65])).filter(i => i >= 0);
        } else {
          answerIdx = opts.indexOf(qq.options[qq.answer.charCodeAt(0) - 65]);
        }
        return { id: qq.id, chapter: qq.chapter, type: qq.type, question: qq.question, options: opts, answerIdx, answer: qq.type === 'fill' ? String(qq.answer) : null, explain: qq.explain || '' };
      }).filter(Boolean);
      return sendJSON(res, 200, { list });
    }
    // 物理量识记数据
    if (p === '/api/memory') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      return sendJSON(res, 200, { best: db.memoryBest[a.user.id] || 0 });
    }
    // 识记测验提交
    if (p === '/api/memory/score' && req.method === 'POST') {
      const a = auth();
      if (a.err) return sendJSON(res, 401, { err: a.err });
      const body = await readBody(req);
      if (typeof body.score === 'number' && body.score > (db.memoryBest[a.user.id] || 0)) {
        db.memoryBest[a.user.id] = body.score;
        await acc.setMemoryBest(a.user.id, body.score);
      }
      a.user.score = (a.user.score || 0) + (body.gain || 0);
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
      if (kw) list = list.filter(x => (x.question + (x.options || []).join(' ') + (x.explain || '')).toLowerCase().includes(kw));
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
      const nq = { id: maxId + 1, chapter: Number(body.chapter), section: Number(body.section) || 1, type: body.type, question: String(body.question).trim(), options: body.options, answer: String(body.answer).trim(), explain: String(body.explain || '').trim() };
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
      qq.options = body.options; qq.answer = String(body.answer).trim(); qq.explain = String(body.explain || '').trim();
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
    // 教师-修改系统设置（使用单位/闯关时间，记录日志）
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
      if (reasons.length) {
        db.logs.push({ t: Date.now(), op: '闯关时间/单位设置', by: a.user.name, reason: reasons.join('；') });
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
acc.init().then(() => {
  questions = acc.state.questions;
  server.listen(PORT, '0.0.0.0', () => {
    process.title = '电闯关服务端-JSON版 V' + (db.settings.version || '未知');
    try { require('child_process').execSync('title ' + process.title, { stdio: 'ignore' }); } catch (e) {}
    console.log('============================================');
    console.log('  电闯关·电工大作战 服务端已启动 (JSON 数据库)');
    console.log('  版本       : ' + (db.settings.version || '未知'));
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
