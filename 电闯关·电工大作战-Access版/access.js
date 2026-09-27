/* ============================================================
 * access.js — Access(.accdb) 数据库访问层
 * 通过系统 ACE OLEDB 驱动（Microsoft.ACE.OLEDB.16.0）读写 Access 数据库，
 * 驱动不存在时回退 12.0。零第三方 npm 依赖，可被 pkg 打包。
 * 数据表：
 *   users(id,name,salt,pass,role,score,reg,lastLogin,loginCount,correct,total)
 *   sessions(token,userId,t)
 *   progress(userId,chapter,lv,stars)
 *   wrongs(userId,qid,count,good,last)
 *   memoryBest(userId,best)
 *   logs(id,t,op,by,name,reason)
 *   questions(id,chapter,section,type,question,options,answer,explain)
 *   answer_logs(id,t,userId,name,qid,chapter,section,correct)
 * ============================================================ */
'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = path.join(APP_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'dg_data.accdb');
const TEMPLATE_FILE = path.join(DATA_DIR, 'template.accdb');
const WORKER = path.join(APP_DIR, 'access_worker.ps1');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function uid() { return crypto.randomBytes(8).toString('hex'); }
function nowStr() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

/* Access SQL 字面量转义（单引号翻倍） */
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/* 内存业务状态（启动时从 Access 载入；运行时改内存 + 增量落库） */
const state = {
  users: [],        // [{id,name,salt,pass,role,score,reg,lastLogin,loginCount,correct,total}]
  sessions: {},     // token -> userId
  progress: {},     // userId -> { chapter: { lv: stars } }
  wrongs: {},       // userId -> [{qid,count,good,last}]
  memoryBest: {},   // userId -> best
  logs: [],         // [{id,t,op,by,name,reason}]
  answerLogs: [],   // [{t,userId,name,qid,chapter,section,correct}] 每题答题明细
  settings: {},     // { unit: "使用单位名称" } 系统设置
  questions: []     // [{id,chapter,section,type,question,options,answer,explain}]
};

/* ---------------- worker 调用 ---------------- */
let tmpSeq = 0;
function callWorker(mode, sql, outFile, dbPath) {
  return new Promise((resolve, reject) => {
    const payload = typeof sql === 'string' ? sql : JSON.stringify(sql);
    const db = dbPath || DB_FILE;
    // SQL 写入临时文件，避免命令行长度限制
    const sqlFile = path.join(DATA_DIR, '.acc_sql_' + process.pid + '_' + (++tmpSeq) + '.txt');
    fs.writeFileSync(sqlFile, payload, 'utf8');
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER, '-Db', db, '-Mode', mode, '-SqlFile', sqlFile, '-Out', outFile],
      { timeout: 120000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err) => {
        try { fs.unlinkSync(sqlFile); } catch (e) { /* 忽略 */ }
        let res = null;
        try { res = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { /* 忽略 */ }
        if (res && res.ok) return resolve(res);
        const msg = (res && res.err) ? res.err : (err ? err.message : '未知错误');
        reject(new Error('Access操作失败: ' + msg));
      });
  });
}
function tmpFile() {
  tmpSeq++;
  return path.join(DATA_DIR, '.acc_tmp_' + process.pid + '_' + tmpSeq + '.json');
}

/* 查询（并发读） */
function q(sql) {
  const f = tmpFile();
  return callWorker('query', sql, f).then(r => r.rows || []);
}
/* 批量执行（写链串行，防 Access 写锁冲突） */
let writeChain = Promise.resolve();
function run(sqls) {
  const arr = Array.isArray(sqls) ? sqls : [sqls];
  if (!arr.length) return Promise.resolve();
  const f = tmpFile();
  writeChain = writeChain.then(() => callWorker('exec', arr, f));
  return writeChain;
}

/* ---------------- 建库 / 模板 / 初始化 ---------------- */
const DDL = [
  "CREATE TABLE users (id TEXT(32), name TEXT(50), salt TEXT(32), pass TEXT(64), role TEXT(10), score LONG, reg TEXT(20), lastLogin TEXT(20), loginCount LONG, correct LONG, total LONG)",
  "CREATE TABLE sessions (token TEXT(64), userId TEXT(32), t TEXT(20))",
  "CREATE TABLE progress (userId TEXT(32), chapter LONG, lv TEXT(10), stars LONG)",
  "CREATE TABLE wrongs (userId TEXT(32), qid LONG, cnt LONG, good LONG, lastTime TEXT(20))",
  "CREATE TABLE memoryBest (userId TEXT(32), best LONG)",
  "CREATE TABLE logs (id COUNTER, t TEXT(20), op TEXT(200), who TEXT(50), name TEXT(50), reason TEXT(200))",
  "CREATE TABLE answer_logs (id COUNTER, t TEXT(20), userId TEXT(32), name TEXT(50), qid LONG, chapter LONG, [section] LONG, correct LONG)",
  "CREATE TABLE questions (id LONG, chapter LONG, [section] LONG, type TEXT(10), question MEMO, options MEMO, answer MEMO, explain MEMO)",
  "CREATE TABLE settings (id COUNTER, k TEXT(50), v MEMO)"
];

/* 创建新库：ADOX 创建受中文路径影响，故先建在系统临时目录(ASCII)再移动到数据目录 */
function buildTemplate() {
  const os = require('os');
  const tmpDb = path.join(os.tmpdir(), 'dg_db_create_' + Date.now() + '.accdb');
  const out = tmpFile();
  return callWorker('init', DDL, out, tmpDb).then(() => {
    try { fs.copyFileSync(tmpDb, DB_FILE); }
    finally { try { fs.unlinkSync(tmpDb); } catch (e) { /* 忽略 */ } }
  });
}
function insertQuestionSQL(qq) {
  return "INSERT INTO questions (id,chapter,[section],type,question,options,answer,explain) VALUES (" +
    esc(qq.id) + ',' + esc(qq.chapter) + ',' + esc(qq.section || 1) + ',' + esc(qq.type) + ',' + esc(qq.question) + ',' +
    esc(JSON.stringify(qq.options || [])) + ',' + esc(qq.answer) + ',' + esc(qq.explain || '') + ')';
}
function insertTeacherSQL() {
  const s = uid();
  return "INSERT INTO users (id,name,salt,pass,role,score,reg,lastLogin,loginCount,correct,total) VALUES (" +
    esc(uid()) + ",'teacher'," + esc(s) + ',' + esc(sha256(s + '123456')) + ",'teacher',0," + esc(nowStr()) + ",0,0,0,0)";
}

/* 确保数据可用：库存在（无则复制模板，模板缺失则现场建库并从 questions.json 导入） */
async function createDbWithSeed() {
  await buildTemplate();
  // 导入题库（若存在 questions.json），与教师账号合并为一次批量写入，避免连续写文件锁竞态
  const all = [];
  const qs = path.join(DATA_DIR, 'questions.json');
  if (fs.existsSync(qs)) {
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(qs, 'utf8')); } catch (e) { /* 忽略 */ }
    for (const x of arr) all.push(insertQuestionSQL(x));
    console.log('题库导入完成：' + arr.length + ' 题');
  }
  all.push(insertTeacherSQL());
  await run(all);
}
async function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    if (fs.existsSync(TEMPLATE_FILE)) {
      fs.copyFileSync(TEMPLATE_FILE, DB_FILE);
    } else {
      console.log('未找到模板数据库，正在现场创建 Access 数据库…');
      await createDbWithSeed();
    }
  }
}

/* 确保教师账号存在 */
async function ensureTeacher() {
  const rows = await q("SELECT id FROM users WHERE name='teacher' AND role='teacher'");
  if (!rows.length) await run([insertTeacherSQL()]);
}

/* 全量载入内存（启动时一次） */
async function loadAll() {
  const [users, sessions, progress, wrongs, mems, logs, questions, ansLogs, settings] = await Promise.all([
    q('SELECT * FROM users'),
    q('SELECT * FROM sessions'),
    q('SELECT * FROM progress'),
    q('SELECT userId, qid, cnt, good, lastTime FROM wrongs'),
    q('SELECT * FROM memoryBest'),
    q('SELECT id, t, op, who, name, reason FROM logs ORDER BY id'),
    q('SELECT * FROM questions ORDER BY id'),
    q('SELECT t, userId, name, qid, chapter, [section], correct FROM answer_logs ORDER BY id'),
    q('SELECT k, v FROM settings')
  ]);
  state.users = users.map(u => ({
    id: u.id, name: u.name, salt: u.salt, pass: u.pass, role: u.role, score: u.score || 0,
    reg: parseInt(u.reg, 10) || 0, lastLogin: parseInt(u.lastLogin, 10) || 0,
    loginCount: u.loginCount || 0, correct: u.correct || 0, total: u.total || 0
  }));
  state.sessions = {};
  sessions.forEach(s => { state.sessions[s.token] = s.userId; });
  state.progress = {};
  progress.forEach(p => {
    if (!state.progress[p.userId]) state.progress[p.userId] = {};
    if (!state.progress[p.userId][p.chapter]) state.progress[p.userId][p.chapter] = {};
    state.progress[p.userId][p.chapter][p.lv] = p.stars;
  });
  state.wrongs = {};
  wrongs.forEach(w => {
    if (!state.wrongs[w.userId]) state.wrongs[w.userId] = [];
    state.wrongs[w.userId].push({ qid: w.qid, count: w.cnt || 1, good: w.good || 0, last: parseInt(w.lastTime, 10) || 0 });
  });
  state.memoryBest = {};
  mems.forEach(m => { state.memoryBest[m.userId] = m.best || 0; });
  state.logs = logs.map(l => ({ id: l.id, t: parseInt(l.t, 10) || 0, op: l.op || '', by: l.who || '', name: l.name || '', reason: l.reason || '' }));
  state.answerLogs = ansLogs.map(l => ({ t: parseInt(l.t, 10) || 0, userId: l.userId || '', name: l.name || '', qid: l.qid, chapter: l.chapter, section: l.section || 1, correct: !!l.correct }));
  state.settings = {};
  settings.forEach(s => { state.settings[s.k] = s.v; });
  state.questions = questions.map(x => {
    let opts = [];
    try { opts = JSON.parse(x.options || '[]'); } catch (e) { opts = []; }
    return { id: x.id, chapter: x.chapter, section: x.section || 1, type: x.type, question: x.question, options: opts, answer: x.answer, explain: x.explain || '' };
  });
}

/* ---------------- 业务增量落库 ---------------- */
function insertUser(u) {
  return run(["INSERT INTO users (id,name,salt,pass,role,score,reg,lastLogin,loginCount,correct,total) VALUES (" +
    esc(u.id) + ',' + esc(u.name) + ',' + esc(u.salt) + ',' + esc(u.pass) + ',' + esc(u.role) + ',' + esc(u.score) + ',' +
    esc(String(u.reg)) + ',' + esc(String(u.lastLogin)) + ',' + esc(u.loginCount) + ',' + esc(u.correct) + ',' + esc(u.total) + ')' ]);
}
function updateUser(u) {
  return run(["UPDATE users SET name=" + esc(u.name) + ",score=" + esc(u.score) + ",lastLogin=" + esc(String(u.lastLogin)) + ",loginCount=" + esc(u.loginCount) +
    ",correct=" + esc(u.correct) + ",total=" + esc(u.total) + ",salt=" + esc(u.salt) + ",pass=" + esc(u.pass) + " WHERE id=" + esc(u.id)]);
}
function upsertSession(token, userId) {
  return run(["DELETE FROM sessions WHERE token=" + esc(token), "INSERT INTO sessions (token,userId,t) VALUES (" + esc(token) + ',' + esc(userId) + ',' + esc(nowStr()) + ')' ]);
}
function deleteUser(id) {
  return run([
    "DELETE FROM users WHERE id=" + esc(id),
    "DELETE FROM sessions WHERE userId=" + esc(id),
    "DELETE FROM progress WHERE userId=" + esc(id),
    "DELETE FROM wrongs WHERE userId=" + esc(id),
    "DELETE FROM memoryBest WHERE userId=" + esc(id),
    "DELETE FROM answer_logs WHERE userId=" + esc(id)
  ]);
}
function upsertProgress(userId, chapter, lv, stars) {
  const sqls = ["DELETE FROM progress WHERE userId=" + esc(userId) + " AND chapter=" + esc(chapter) + " AND lv=" + esc(lv),
    "INSERT INTO progress (userId,chapter,lv,stars) VALUES (" + esc(userId) + ',' + esc(chapter) + ',' + esc(lv) + ',' + esc(stars) + ')' ];
  return run(sqls);
}
function upsertWrong(userId, w) {
  return run(["DELETE FROM wrongs WHERE userId=" + esc(userId) + " AND qid=" + esc(w.qid),
    "INSERT INTO wrongs (userId,qid,cnt,good,lastTime) VALUES (" + esc(userId) + ',' + esc(w.qid) + ',' + esc(w.count) + ',' + esc(w.good) + ',' + esc(String(w.last)) + ')' ]);
}
function removeWrong(userId, qid) {
  return run(["DELETE FROM wrongs WHERE userId=" + esc(userId) + " AND qid=" + esc(qid)]);
}
function setMemoryBest(userId, best) {
  return run(["DELETE FROM memoryBest WHERE userId=" + esc(userId), "INSERT INTO memoryBest (userId,best) VALUES (" + esc(userId) + ',' + esc(best) + ')' ]);
}
function appendLog(entry) {
  return run(["INSERT INTO logs (t,op,who,name,reason) VALUES (" + esc(String(entry.t || Date.now())) + ',' + esc(entry.op || '') + ',' + esc(entry.by || '') + ',' + esc(entry.name || '') + ',' + esc(entry.reason || '') + ')' ]);
}
function setSetting(k, v) {
  return run(["DELETE FROM settings WHERE k=" + esc(k), "INSERT INTO settings (k,v) VALUES (" + esc(k) + "," + esc(String(v)) + ")"]);
}
function logAnswer(e) {
  return run(["INSERT INTO answer_logs (t,userId,name,qid,chapter,[section],correct) VALUES (" +
    esc(String(e.t || Date.now())) + ',' + esc(e.userId) + ',' + esc(e.name) + ',' + esc(e.qid) + ',' + esc(e.chapter) + ',' + esc(e.section || 1) + ',' + esc(e.correct ? 1 : 0) + ')' ]);
}
function insertQuestion(qq) {
  return run([insertQuestionSQL(qq)]);
}
function batchInsertQuestions(arr) {
  return run(arr.map(insertQuestionSQL));
}
function updateQuestion(qq) {
  return run(["UPDATE questions SET chapter=" + esc(qq.chapter) + ",[section]=" + esc(qq.section || 1) + ",type=" + esc(qq.type) + ",question=" + esc(qq.question) +
    ",options=" + esc(JSON.stringify(qq.options || [])) + ",answer=" + esc(qq.answer) + ",explain=" + esc(qq.explain || '') + " WHERE id=" + esc(qq.id)]);
}
function deleteQuestion(id) {
  return run(["DELETE FROM questions WHERE id=" + esc(id)]);
}

/* 启动初始化入口 */
async function init() {
  await ensureDb();
  await loadAll();
  await ensureTeacher();
}

module.exports = {
  APP_DIR, DATA_DIR, DB_FILE, TEMPLATE_FILE, WORKER,
  state, q, run, esc, sha256, uid, nowStr,
  init, ensureDb, createDbWithSeed, loadAll, ensureTeacher, buildTemplate,
  insertUser, updateUser, upsertSession, deleteUser,
  upsertProgress, upsertWrong, removeWrong, setMemoryBest, appendLog, logAnswer, setSetting,
  insertQuestion, batchInsertQuestions, updateQuestion, deleteQuestion
};
