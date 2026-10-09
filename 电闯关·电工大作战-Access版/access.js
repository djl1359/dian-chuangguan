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
        // 1.0.0.4：结果读取后即删除临时输出文件，避免 data 目录积累 .acc_tmp 残留
        try { fs.unlinkSync(outFile); } catch (e) { /* 忽略 */ }
        if (res && res.ok) return resolve(res);
        const msg = (res && res.err) ? res.err : (err ? err.message : '未知错误');
        // 1.0.0.4：数据库被短暂占用（如杀毒扫描/刚复制/重启过快）时自动重试
        if (/已在使用中|已在使用中|already in use|in use/i.test(msg)) {
          setTimeout(() => {
            callWorker(mode, sql, outFile, dbPath).then(resolve, reject);
          }, 800);
          return;
        }
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
  "CREATE TABLE users (id TEXT(32), name TEXT(50), salt TEXT(32), pass TEXT(64), role TEXT(10), score LONG, reg TEXT(20), lastLogin TEXT(20), loginCount LONG, correct LONG, total LONG, school TEXT(100), grade TEXT(20), [class] TEXT(30))",
  "CREATE TABLE sessions (token TEXT(64), userId TEXT(32), t TEXT(20))",
  "CREATE TABLE progress (userId TEXT(32), chapter LONG, lv TEXT(10), stars LONG)",
  "CREATE TABLE wrongs (userId TEXT(32), qid LONG, cnt LONG, good LONG, lastTime TEXT(20))",
  "CREATE TABLE memoryBest (userId TEXT(32), best LONG)",
  "CREATE TABLE logs (id COUNTER, t TEXT(20), op TEXT(200), who TEXT(50), name TEXT(50), reason TEXT(200))",
  "CREATE TABLE answer_logs (id COUNTER, t TEXT(20), userId TEXT(32), name TEXT(50), qid LONG, chapter LONG, [section] LONG, correct LONG)",
  "CREATE TABLE questions (id LONG, chapter LONG, [section] LONG, type TEXT(10), question MEMO, options MEMO, answer MEMO, explain MEMO, difficulty LONG, [image] TEXT(200), [imageAlign] TEXT(20), [imgSize] LONG)",
  "CREATE TABLE settings (id COUNTER, k TEXT(50), v MEMO)",
  "CREATE TABLE exams (id TEXT(32), title MEMO, subject MEMO, className TEXT(60), grade TEXT(30), createdAt TEXT(20), [status] TEXT(10), questions MEMO, qcount LONG, totalScore LONG, createdBy TEXT(50), publishedAt TEXT(20), [note] MEMO)",
  "CREATE TABLE exam_answers (id COUNTER, examId TEXT(32), userId TEXT(32), name TEXT(50), t TEXT(20), objective MEMO, subjective MEMO, total LONG, [status] TEXT(10), img MEMO)"
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
  return "INSERT INTO questions (id,chapter,[section],type,question,options,answer,explain,difficulty,[image],[imageAlign],[imgSize]) VALUES (" +
    esc(qq.id) + ',' + esc(qq.chapter) + ',' + esc(qq.section || 1) + ',' + esc(qq.type) + ',' + esc(qq.question) + ',' +
    esc(JSON.stringify(qq.options || [])) + ',' + esc(qq.answer) + ',' + esc(qq.explain || '') + ',' + esc(qq.difficulty || 3) + ',' + esc(qq.image || '') + ',' + esc(qq.imageAlign || 'center') + ',' + esc(qq.imgSize || 60) + ')';
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
/* 1.0.0.5：旧库 questions 表无 difficulty 列时补列（已存在则忽略） */
async function ensureQuestionDiff() {
  try {
    const f = tmpFile();
    await callWorker('exec', ['ALTER TABLE questions ADD COLUMN difficulty LONG'], f);
  } catch (e) { /* 列已存在等，忽略 */ }
  /* 1.4.0.0：旧库 questions 表无 image/imageAlign/imgSize 列时补列（image 为 ACE 保留字，需方括号；逐个独立尝试，已存在则跳过） */
  for (const sql of ['ALTER TABLE questions ADD COLUMN [image] TEXT(200)', 'ALTER TABLE questions ADD COLUMN [imageAlign] TEXT(20)', 'ALTER TABLE questions ADD COLUMN [imgSize] LONG']) {
    try {
      const f = tmpFile();
      await callWorker('exec', [sql], f);
    } catch (e) { /* 列已存在等，忽略 */ }
  }
  // 1.0.0.5：旧库题目无难度标注时按题型自动填充默认值（single/judge=2、fill/matching=3、multi=4）
  try {
    const rows = await q("SELECT id, type FROM questions WHERE difficulty IS NULL OR difficulty <= 0");
    if (rows.length) {
      const upd = [];
      for (const r of rows) {
        const d = r.type === 'single' || r.type === 'judge' ? 2 : (r.type === 'multi' ? 4 : 3);
        upd.push("UPDATE questions SET difficulty = " + d + " WHERE id = " + esc(r.id));
      }
      await run(upd);
    }
  } catch (e) { /* 表结构异常时忽略，查询接口按 null→3 兜底 */ }
}

/* V1.5.0.0：旧库 users 表补学校/年级/班级列（class 为 ACE 保留字需方括号；逐个尝试，已存在则忽略） */
async function ensureUserCols() {
  for (const sql of ['ALTER TABLE users ADD COLUMN school TEXT(100)', 'ALTER TABLE users ADD COLUMN grade TEXT(20)', 'ALTER TABLE users ADD COLUMN [class] TEXT(30)']) {
    try {
      const f = tmpFile();
      await callWorker('exec', [sql], f);
    } catch (e) { /* 列已存在等，忽略 */ }
  }
}

async function ensureTeacher() {
  const rows = await q("SELECT id FROM users WHERE name='teacher' AND role='teacher'");
  if (!rows.length) await run([insertTeacherSQL()]);
}

/* 1.0.0.4：清扫历史运行残留的临时文件（旧版本不清理，data 目录会越积越多） */
function sweepTempFiles() {
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.startsWith('.acc_tmp_') || f.startsWith('.acc_sql_')) {
        try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (e) { /* 被占用则跳过 */ }
      }
    }
  } catch (e) { /* 目录不存在等，忽略 */ }
}

/* 全量载入内存（启动时一次；1.0.0.4：串行查询，降低并发打开 Access 的锁冲突） */
async function loadAll() {
  const users = await q('SELECT * FROM users');
  const sessions = await q('SELECT * FROM sessions');
  const progress = await q('SELECT * FROM progress');
  const wrongs = await q('SELECT userId, qid, cnt, good, lastTime FROM wrongs');
  const mems = await q('SELECT * FROM memoryBest');
  const logs = await q('SELECT id, t, op, who, name, reason FROM logs ORDER BY id');
  const questions = await q('SELECT * FROM questions ORDER BY id');
  const ansLogs = await q('SELECT t, userId, name, qid, chapter, [section], correct FROM answer_logs ORDER BY id');
  const settings = await q('SELECT k, v FROM settings');
  const examsRows = await q('SELECT id, title, subject, className, grade, createdAt, [status], questions, qcount, totalScore, createdBy, publishedAt, [note] FROM exams');
  const examAnsRows = await q('SELECT examId, userId, name, t, objective, subjective, total, [status], img FROM exam_answers');
  state.users = users.map(u => ({
    id: u.id, name: u.name, salt: u.salt, pass: u.pass, role: u.role, score: u.score || 0,
    reg: parseInt(u.reg, 10) || 0, lastLogin: parseInt(u.lastLogin, 10) || 0,
    loginCount: u.loginCount || 0, correct: u.correct || 0, total: u.total || 0,
    /* V1.5.0.0：学校/年级/班级 */
    school: u.school || '', grade: u.grade || '', class: u.class || ''
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
    return { id: x.id, chapter: x.chapter, section: x.section || 1, type: x.type, question: x.question, options: opts, answer: x.answer, explain: x.explain || '', difficulty: x.difficulty == null ? 3 : x.difficulty, image: x.image || '', imageAlign: x.imageAlign || 'center', imgSize: x.imgSize || 60 };
  });
  state.exams = examsRows.map(x => {
    let qs = [];
    try { qs = JSON.parse(x.questions || '[]'); } catch (e) { qs = []; }
    return { id: x.id, title: x.title || '', subject: x.subject || '', className: x.className || '', grade: x.grade || '',
      createdAt: parseInt(x.createdAt, 10) || 0, status: x.status || 'draft', questions: Array.isArray(qs) ? qs : [],
      qcount: x.qcount || 0, totalScore: x.totalScore || 0, createdBy: x.createdBy || '', publishedAt: x.publishedAt || '', note: x.note || '' };
  });
  state.examAnswers = examAnsRows.map(x => ({
    examId: x.examId, userId: x.userId, name: x.name || '', t: parseInt(x.t, 10) || 0,
    objective: parseJSON(x.objective, []), subjective: parseJSON(x.subjective, []),
    total: x.total || 0, status: x.status || 'pending', img: x.img || ''
  }));
}
/* 解析 JSON 字段（MEMO 可能为 null） */
function parseJSON(v, def) { try { return JSON.parse(v || 'null') == null ? def : JSON.parse(v); } catch (e) { return def; } }

/* ---------------- 业务增量落库 ---------------- */
function insertUser(u) {
  return run(["INSERT INTO users (id,name,salt,pass,role,score,reg,lastLogin,loginCount,correct,total,school,grade,[class]) VALUES (" +
    esc(u.id) + ',' + esc(u.name) + ',' + esc(u.salt) + ',' + esc(u.pass) + ',' + esc(u.role) + ',' + esc(u.score) + ',' +
    esc(String(u.reg)) + ',' + esc(String(u.lastLogin)) + ',' + esc(u.loginCount) + ',' + esc(u.correct) + ',' + esc(u.total) + ',' +
    esc(u.school || '') + ',' + esc(u.grade || '') + ',' + esc(u.class || '') + ')' ]);
}
function updateUser(u) {
  return run(["UPDATE users SET name=" + esc(u.name) + ",score=" + esc(u.score) + ",lastLogin=" + esc(String(u.lastLogin)) + ",loginCount=" + esc(u.loginCount) +
    ",correct=" + esc(u.correct) + ",total=" + esc(u.total) + ",salt=" + esc(u.salt) + ",pass=" + esc(u.pass) +
    ",school=" + esc(u.school || '') + ",grade=" + esc(u.grade || '') + ",[class]=" + esc(u.class || '') + " WHERE id=" + esc(u.id)]);
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
    ",options=" + esc(JSON.stringify(qq.options || [])) + ",answer=" + esc(qq.answer) + ",difficulty=" + esc(qq.difficulty || 3) + ",explain=" + esc(qq.explain || '') + ",[image]=" + esc(qq.image || '') + ",[imageAlign]=" + esc(qq.imageAlign || 'center') + ",[imgSize]=" + esc(qq.imgSize || 60) + " WHERE id=" + esc(qq.id)]);
}
function deleteQuestion(id) {
  return run(["DELETE FROM questions WHERE id=" + esc(id)]);
}

/* ---------------- 1.3.0.0 考试/阅卷任务 ---------------- */
/* 旧库补建 exams / exam_answers 表（已存在则忽略）并载入 */
async function ensureExamTables() {
  try {
    const f = tmpFile();
    await callWorker('exec', ["CREATE TABLE exams (id TEXT(32), title MEMO, subject MEMO, className TEXT(60), grade TEXT(30), createdAt TEXT(20), [status] TEXT(10), questions MEMO, qcount LONG, totalScore LONG, createdBy TEXT(50), publishedAt TEXT(20), [note] MEMO)",
      "CREATE TABLE exam_answers (id COUNTER, examId TEXT(32), userId TEXT(32), name TEXT(50), t TEXT(20), objective MEMO, subjective MEMO, total LONG, [status] TEXT(10), img MEMO)"], f);
  } catch (e) { /* 表已存在等，忽略 */ }
  try {
    const examsRows = await q("SELECT id, title, subject, className, grade, createdAt, [status], questions, qcount, totalScore, createdBy, publishedAt, [note] FROM exams");
    state.exams = examsRows.map(x => {
    let qs = [];
    try { qs = JSON.parse(x.questions || '[]'); } catch (e) { qs = []; }
    return { id: x.id, title: x.title || '', subject: x.subject || '', className: x.className || '', grade: x.grade || '',
      createdAt: parseInt(x.createdAt, 10) || 0, status: x.status || 'draft', questions: Array.isArray(qs) ? qs : [],
      qcount: x.qcount || 0, totalScore: x.totalScore || 0, createdBy: x.createdBy || '', publishedAt: x.publishedAt || '', note: x.note || '' };
  });
  } catch (e) { /* 表不存在则跳过 */ }
  try {
    const examAnsRows = await q("SELECT examId, userId, name, t, objective, subjective, total, [status], img FROM exam_answers");
    state.examAnswers = examAnsRows.map(x => ({
      examId: x.examId, userId: x.userId, name: x.name || '', t: parseInt(x.t, 10) || 0,
      objective: parseJSON(x.objective, []), subjective: parseJSON(x.subjective, []),
      total: x.total || 0, status: x.status || 'pending', img: x.img || ''
    }));
  } catch (e) { /* 表不存在则跳过 */ }
}
function listExams() { return state.exams.slice(); }
function saveExam(e) {
  const sql = ["DELETE FROM exams WHERE id=" + esc(e.id),
    "INSERT INTO exams (id,title,subject,className,grade,createdAt,[status],questions,qcount,totalScore,createdBy,publishedAt,[note]) VALUES (" +
    esc(e.id) + ',' + esc(e.title || '') + ',' + esc(e.subject || '') + ',' + esc(e.className || '') + ',' + esc(e.grade || '') + ',' +
    esc(String(e.createdAt || Date.now())) + ',' + esc(e.status || 'draft') + ',' + esc(JSON.stringify(e.questions || [])) + ',' +
    esc(e.qcount || 0) + ',' + esc(e.totalScore || 0) + ',' + esc(e.createdBy || '') + ',' + esc(e.publishedAt || '') + ',' + esc(e.note || '') + ')'];
  const i = state.exams.findIndex(x => x.id === e.id);
  if (i >= 0) state.exams[i] = e; else state.exams.push(e);
  return run(sql);
}
function deleteExam(id) {
  state.exams = state.exams.filter(x => x.id !== id);
  state.examAnswers = state.examAnswers.filter(x => x.examId !== id);
  return run(["DELETE FROM exams WHERE id=" + esc(id), "DELETE FROM exam_answers WHERE examId=" + esc(id)]);
}
function listExamAnswers(examId) {
  return state.examAnswers.filter(x => x.examId === examId);
}
function listExamAnswersOf(userId) {
  return state.examAnswers.filter(x => x.userId === userId);
}
function saveExamAnswer(a) {
  const sql = ["DELETE FROM exam_answers WHERE examId=" + esc(a.examId) + " AND userId=" + esc(a.userId),
    "INSERT INTO exam_answers (examId,userId,name,t,objective,subjective,total,[status],img) VALUES (" +
    esc(a.examId) + ',' + esc(a.userId) + ',' + esc(a.name || '') + ',' + esc(String(a.t || Date.now())) + ',' +
    esc(JSON.stringify(a.objective || [])) + ',' + esc(JSON.stringify(a.subjective || [])) + ',' + esc(a.total || 0) + ',' +
    esc(a.status || 'pending') + ',' + esc(a.img || '') + ')'];
  const i = state.examAnswers.findIndex(x => x.examId === a.examId && x.userId === a.userId);
  if (i >= 0) state.examAnswers[i] = a; else state.examAnswers.push(a);
  return run(sql);
}
function deleteExamAnswers(examId) {
  state.examAnswers = state.examAnswers.filter(x => x.examId !== examId);
  return run(["DELETE FROM exam_answers WHERE examId=" + esc(examId)]);
}

/* 启动初始化入口 */
async function init() {
  sweepTempFiles();
  await ensureDb();
  await ensureQuestionDiff();
  await ensureUserCols();
  await ensureExamTables();
  await loadAll();
  await ensureTeacher();
  // 1.2.0.1：不再自动创建演示学生账号（闯关测试员），由教师按需自行注册/添加
}

module.exports = {
  APP_DIR, DATA_DIR, DB_FILE, TEMPLATE_FILE, WORKER,
  state, q, run, esc, sha256, uid, nowStr,
  init, ensureDb, createDbWithSeed, loadAll, ensureTeacher, buildTemplate,
  insertUser, updateUser, upsertSession, deleteUser,
  upsertProgress, upsertWrong, removeWrong, setMemoryBest, appendLog, logAnswer, setSetting,
  insertQuestion, batchInsertQuestions, updateQuestion, deleteQuestion,
  ensureExamTables, listExams, saveExam, deleteExam, listExamAnswers, listExamAnswersOf, saveExamAnswer, deleteExamAnswers
};
