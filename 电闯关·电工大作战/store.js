/* ============================================================
 * store.js — JSON 文件数据库访问层（第一版：零依赖）
 * 数据文件：
 *   data/questions.json  题库（教师增删改查）
 *   data/db.json         业务数据：users/sessions/progress/wrongs/memoryBest/logs
 * 与 access.js 保持同一套接口，因此 server.js 业务代码两版共用。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = path.join(APP_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const QS_FILE = path.join(DATA_DIR, 'questions.json');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function uid() { return crypto.randomBytes(8).toString('hex'); }
function readJSON(f, def) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; }
}

/* 内存业务状态（与 access.js 的 state 同构） */
const state = {
  users: [],        // [{id,name,salt,pass,role,score,reg,lastLogin,loginCount,correct,total}]
  sessions: {},     // token -> userId
  progress: {},     // userId -> { chapter: { lv: stars } }
  wrongs: {},       // userId -> [{qid,count,good,last}]
  memoryBest: {},   // userId -> best
  logs: [],         // [{id,t,op,by,name,reason}]
  answerLogs: [],   // [{t,userId,name,qid,chapter,section,correct}] 每题答题明细（成绩分析）
  settings: {},     // { unit: '使用单位名称' } 系统设置
  questions: []     // [{id,chapter,section,type,question,options,answer,explain}]
};

/* 写链：所有落盘串行执行，防并发写坏文件 */
let writeChain = Promise.resolve();
function saveDB() {
  const snap = {
    users: state.users, sessions: state.sessions, progress: state.progress,
    wrongs: state.wrongs, memoryBest: state.memoryBest, logs: state.logs,
    answerLogs: state.answerLogs, settings: state.settings
  };
  writeChain = writeChain.then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(snap, null, 2), 'utf8');
  });
  return writeChain;
}
function saveQuestions() {
  writeChain = writeChain.then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(QS_FILE, JSON.stringify(state.questions, null, 2), 'utf8');
  });
  return writeChain;
}

/* ---------------- 启动初始化 ---------------- */
async function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // 题库
  if (fs.existsSync(QS_FILE)) {
    state.questions = readJSON(QS_FILE, []);
    if (!Array.isArray(state.questions) || !state.questions.length) { state.questions = []; await saveQuestions(); }
  } else {
    state.questions = [];
    await saveQuestions();
  }
  // 业务库
  const loaded = fs.existsSync(DB_FILE) ? readJSON(DB_FILE, null) : null;
  if (loaded) {
    state.users = loaded.users || [];
    state.sessions = loaded.sessions || {};
    state.progress = loaded.progress || {};
    state.wrongs = loaded.wrongs || {};
    state.memoryBest = loaded.memoryBest || {};
    state.logs = loaded.logs || [];
    state.answerLogs = loaded.answerLogs || [];
    state.settings = loaded.settings || {};
  } else {
    await saveDB();
  }
  // 确保教师账号存在（teacher / 123456）
  if (!state.users.some(u => u.role === 'teacher')) {
    const tSalt = uid();
    state.users.push({ id: uid(), name: 'teacher', salt: tSalt, pass: sha256(tSalt + '123456'), role: 'teacher', score: 0, reg: Date.now(), lastLogin: 0, loginCount: 0, correct: 0, total: 0 });
    await saveDB();
  }
}

/* ---------------- 业务增量落盘（与 access.js 同签名） ---------------- */

function insertUser(u) { return saveDB(); }
function updateUser(u) { return saveDB(); }
function upsertSession(token, userId) { state.sessions[token] = userId; return saveDB(); }
function deleteUser(id) {
  Object.keys(state.sessions).forEach(t => { if (state.sessions[t] === id) delete state.sessions[t]; });
  return saveDB();
}
function upsertProgress(userId, chapter, lv, stars) { return saveDB(); }
function upsertWrong(userId, w) { return saveDB(); }
function removeWrong(userId, qid) { return saveDB(); }
function setMemoryBest(userId, best) { return saveDB(); }
function appendLog(entry) { return saveDB(); }
function logAnswer(entry) { return saveDB(); }
function setSetting(key, value) { state.settings[key] = value; return saveDB(); }
function insertQuestion(qq) { return saveQuestions(); }
function updateQuestion(qq) { return saveQuestions(); }
function deleteQuestion(id) { return saveQuestions(); }

module.exports = {
  APP_DIR, DATA_DIR, DB_FILE, QS_FILE,
  state, sha256, uid,
  init, saveDB, saveQuestions,
  insertUser, updateUser, upsertSession, deleteUser,
  upsertProgress, upsertWrong, removeWrong, setMemoryBest, appendLog, logAnswer, setSetting,
  insertQuestion, updateQuestion, deleteQuestion
};
