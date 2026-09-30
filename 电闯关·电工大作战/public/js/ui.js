/* ===== 界面与流程控制 ===== */
(function () {
  const S = { me: null, chapters: [], levels: [], curChapter: null, memoryQuiz: null, unit: '', gameName: '电闯关·电工大作战', qSel: {}, paper: { chapters: [], diffs: [], types: [], mastery: 'all', count: 20, includeAnswer: false } };
  /* 分页状态：学生/题库/成绩分析/日志 */
  const PG = {
    students: { page: 1, size: 20, kw: '', sort: 'name', grade: '' },
    questions: { page: 1, size: 20, sort: 'idAsc' },
    analysis: { page: 1, size: 20, kw: '', sort: 'acc', grade: '' },
    logs: { page: 1, size: 20 }
  };
  /* 工具条（查找/排序/筛选）渲染 */
  function toolRowHtml(cfg, opts) {
    return '<div class="tool-row">' +
      '<input class="tool-input" placeholder="' + opts.placeholder + '" value="' + esc(cfg.kw || '') + '" oninput="' + opts.setKw + '(this.value)">' +
      '<select class="tool-select" onchange="' + opts.setSort + '(this.value)">' + opts.sorts.map(s => '<option value="' + s.v + '"' + (cfg.sort === s.v ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select>' +
      (opts.grades ? '<select class="tool-select" onchange="' + opts.setGrade + '(this.value)"><option value="">全部等级</option>' + opts.grades.map(g => '<option' + (cfg.grade === g ? ' selected' : '') + '>' + g + '</option>').join('') + '</select>' : '') +
      '<span class="cnt">共 ' + opts.total + ' 条</span></div>';
  }
  /* 学生等级 */
  function gradeOfUser(u) {
    const a = u.total ? Math.round(u.correct / u.total * 100) : 0;
    return a >= 90 ? '优' : a >= 75 ? '良' : a >= 60 ? '中' : '差';
  }
  function pager(list, cfg) {
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / cfg.size));
    if (cfg.page > pages) cfg.page = pages;
    const start = (cfg.page - 1) * cfg.size;
    return { rows: list.slice(start, start + cfg.size), pages, total };
  }
  function pagerHtml(total, cfg, onChange) {
    const pages = Math.max(1, Math.ceil(total / cfg.size));
    let nums = '';
    const from = Math.max(1, cfg.page - 2), to = Math.min(pages, cfg.page + 2);
    for (let i = from; i <= to; i++) nums += '<button class="pg-btn' + (i === cfg.page ? ' active' : '') + '" onclick="' + onChange + '(' + i + ')">' + i + '</button>';
    return '<div class="pager">共 ' + total + ' 条 · <button class="pg-btn" onclick="' + onChange + '(' + (cfg.page - 1) + ')">上一页</button>' + nums + '<button class="pg-btn" onclick="' + onChange + '(' + (cfg.page + 1) + ')">下一页</button>' +
      '　每页 <select class="pg-size" onchange="UIM.pgSize(\'' + onChange + '\',this.value)">' +
      [10, 20, 30, 50, 100].map(n => '<option value="' + n + '"' + (cfg.size === n ? ' selected' : '') + '>' + n + '</option>').join('') +
      '<option value="custom"' + (![10, 20, 30, 50, 100].includes(cfg.size) ? ' selected' : '') + '>自定义</option></select>条</div>';
  }
  window.S = S;
  const $ = (id) => document.getElementById(id);

  /* ---------- 通用工具 ---------- */
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(t) {
    if (!t) return '—';
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function rankOf(score) {
    if (score >= 5000) return '电工技师';
    if (score >= 3000) return '高级电工';
    if (score >= 1500) return '中级电工';
    if (score >= 500) return '初级电工';
    return '新手电工';
  }
  const TYPE_NAME = { single: '单选', judge: '判断', multi: '多选', fill: '填空', matching: '连线', calc: '计算' };

  /* 填空答案归一化判定（含纯数字容差 ±1%） */
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
  window.Norm = { answerMatch };

  /* ---------- 界面切换 ---------- */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.overlay').forEach(el => el.style.display = 'none');
    $(id).style.display = (id === 'screen-login' ? 'flex' : 'block');
    if (id === 'screen-menu') renderMenu();
  }

  /* ---------- 登录 ---------- */
  async function doLogin() {
    const name = $('login-name').value.trim();
    const pass = $('login-pass').value;
    const isReg = $('tab-register').classList.contains('active');
    const msg = $('login-msg');
    if (!name || !pass) { msg.textContent = '请填写姓名和密码'; msg.className = 'msg err'; return; }
    if (isReg && pass !== $('login-pass2').value) { msg.textContent = '两次密码不一致'; msg.className = 'msg err'; return; }
    msg.textContent = '请稍候…'; msg.className = 'msg';
    try {
      const r = isReg ? await API.register(name, pass) : await API.login(name, pass);
      API.saveToken(r.token);
      S.me = r.user;
      msg.textContent = ''; msg.className = 'msg';
      if (S.me.role === 'teacher') {
        const t = $('btn-goto-teacher');
        t.style.display = '';
        document.querySelectorAll('.teacher-only').forEach(e => e.style.display = '');
      }
      showScreen('screen-menu');
      toast('欢迎回来，' + S.me.name + '！');
      // 1.0.0.4：默认弱密码提醒
      if (!isReg && r.weakPass) {
        setTimeout(() => toast('⚠️ 当前为默认密码，建议尽快修改' + (S.me.role === 'teacher' ? '（教师端→账号设置）' : '') + '！', 4000), 1200);
      }
    } catch (e) {
      msg.textContent = e.message; msg.className = 'msg err';
    }
  }

  /* ---------- 主菜单 ---------- */
  function renderMenu() {
    const m = S.me;
    $('me-name').textContent = m.name;
    $('me-rank').textContent = rankOf(m.score);
    $('me-score').textContent = '⭐ ' + m.score;
    $('me-cleared').textContent = m.cleared || 0;
    $('me-stars').textContent = m.stars || 0;
    $('me-correct').textContent = m.correct || 0;
    $('me-acc').textContent = (m.total ? Math.round(m.correct / m.total * 100) : 0) + '%';
    $('menu-progress').textContent = '已通关 ' + (m.cleared || 0) + ' 章 · 星星 ' + (m.stars || 0) + ' 颗';
    API.wrong().then(r => {
      $('menu-wrong-count').textContent = '错题 ' + (r.list ? r.list.length : 0) + ' 道，可一键重练';
    }).catch(() => {});
    if (m.role === 'teacher') {
      $('btn-goto-teacher').style.display = '';
      document.querySelectorAll('.teacher-only').forEach(e => e.style.display = '');
    }
  }

  /* ---------- 地图与选关 ---------- */
  function chapterUnlocked(idx) {
    if (idx === 0) return true;
    if (S.chapters[idx] && S.chapters[idx].id === 12) return true; // 物理量识记向全员开放
    const prev = S.chapters[idx - 1];
    const p = (S.me.progress || {})[prev.id] || {};
    return (p.boss || 0) >= 1;
  }
  function levelUnlocked(ch, lv) {
    if (ch.id === 12) return true; // 物理量识记关卡向全员开放
    if (lv === 1) return true;
    const p = (S.me.progress || {})[ch.id] || {};
    if (lv === 2) return (p.lv1 || 0) >= 1;
    if (lv === 3) return (p.lv2 || 0) >= 1;
    return (p.lv3 || 0) >= 1;
  }
  function renderMap() {
    const g = $('map-grid');
    g.innerHTML = '';
    S.chapters.forEach((c, i) => {
      const unlocked = chapterUnlocked(i);
      const p = (S.me.progress || {})[c.id] || {};
      const stars = Object.values(p).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
      const d = document.createElement('div');
      d.className = 'map-node' + (unlocked ? '' : ' locked');
      d.innerHTML = '<div class="ch-icon">' + c.icon + '</div><div class="ch-name">第' + (c.id === 0 ? '0' : c.id) + '章 ' + c.name + '</div><div class="ch-sub">' + c.sub + '</div><div class="ch-stars">' + (unlocked ? '⭐ ' + stars + ' 颗' : '🔒 未解锁') + '</div>';
      if (unlocked) d.onclick = () => renderChapter(c);
      g.appendChild(d);
    });
    $('map-stars').textContent = '⭐ ' + (S.me.stars || 0);
  }
  function renderChapter(ch) {
    S.curChapter = ch;
    $('chapter-title').textContent = '第' + (ch.id === 0 ? '0' : ch.id) + '章 ' + ch.name;
    $('chapter-info').innerHTML = '<div class="ch-name">' + ch.icon + ' ' + esc(ch.name) + '</div><div class="ch-sub">' + esc(ch.sub) + '</div>';
    const list = $('level-list');
    list.innerHTML = '';
    S.levels.forEach(lv => {
      const p = (S.me.progress || {})[ch.id] || {};
      const key = lv.id === 'boss' ? 'boss' : 'lv' + lv.id;
      const stars = p[key] || 0;
      const unlocked = levelUnlocked(ch, lv.id);
      const d = document.createElement('div');
      d.className = 'level-card' + (lv.id === 'boss' ? ' boss' : '') + (unlocked ? '' : ' locked');
      d.innerHTML = '<div class="level-num">' + (lv.id === 'boss' ? '👑' : '关' + lv.id) + '</div>' +
        '<div class="level-info"><div class="level-name">' + (lv.id === 'boss' ? 'BOSS战：' : '') + lv.name + '</div><div class="level-meta">' + lv.q + ' 题 · 每道 ' + lv.time + ' 秒' + (lv.id === 'boss' ? ' · 答错BOSS回血' : '') + '</div></div>' +
        '<div class="level-stars">' + (unlocked ? '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)) : '🔒') + '</div>';
      if (unlocked) d.onclick = () => startLevel(ch, lv);
      list.appendChild(d);
    });
    showScreen('screen-chapter');
  }

  /* ---------- 开始关卡 ---------- */
  async function startLevel(ch, lv) {
    showScreen('screen-game');
    toast('正在抽取题目…');
    try {
      const r = await API.questions(ch.id, lv.id);
      Game.start(ch, lv, r.questions, r.cfg, r.pt);
    } catch (e) {
      toast(e.message);
      showScreen('screen-chapter');
    }
  }

  /* ---------- 关卡结算 ---------- */
  async function onLevelResult(res) {
    const ch = S.curChapter, lv = res.level;
    // 保存进度
    try {
      await API.progress(ch.id, lv.id === 'boss' ? 'boss' : lv.id, res.stars);
      S.me = (await API.me()).user;
    } catch (e) {}
    $('result-title').textContent = res.pass ? '🎉 通关成功！' : '💥 闯关失败';
    $('result-title').className = 'result-title' + (res.pass ? '' : ' fail');
    $('result-stars').innerHTML = res.pass ? '★★★'.slice(0, res.stars * 2) + '☆'.repeat(Math.max(0, 3 - res.stars) * 2) : '—';
    const praise = res.pass
      ? (res.acc >= 90 || res.stars === 3 ? '🎉 太棒了！几乎全对，你就是电学小达人！' :
         res.acc >= 75 || res.stars === 2 ? '👍 表现不错！再细心一点，就能冲击三星！' :
         '💪 成功通关！多练几关，星星会越来越多！')
      : '🌟 别灰心！看看错题本，调整策略再来挑战！';
    const pr = $('result-praise');
    if (pr) { pr.textContent = praise; pr.className = 'result-praise' + (res.pass ? '' : ' fail'); }
    $('result-score').textContent = res.score;
    $('result-acc').textContent = res.acc + '%';
    $('result-combo').textContent = res.maxCombo;
    $('result-gain').textContent = res.gain;
    $('screen-result').style.display = 'flex';
    $('btn-result-next').style.display = res.pass && nextLevelExists() ? '' : 'none';
    $('btn-result-retry').onclick = () => { hideResult(); startLevel(ch, lv); };
    $('btn-result-next').onclick = () => { hideResult(); const n = nextLevel(); if (n) startLevel(ch, n); };
    $('btn-result-back').onclick = () => { hideResult(); renderChapter(ch); };
  }
  function hideResult() { $('screen-result').style.display = 'none'; }
  function nextLevel() {
    const lvs = S.levels;
    const i = lvs.findIndex(l => l.id === window._curLevelId);
    if (i >= 0 && i + 1 < lvs.length) return lvs[i + 1];
    return null;
  }
  function nextLevelExists() { return !!nextLevel(); }

  /* ---------- 排行榜 ---------- */
  async function openRank() {
    showScreen('screen-rank');
    const p = $('rank-list');
    p.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const r = await API.leaderboard();
      if (!r.list.length) { p.innerHTML = '<div class="empty-tip">暂无排行数据，快去闯关吧！</div>'; return; }
      p.innerHTML = r.list.map((u, i) =>
        '<div class="rank-row"><span class="rank-no' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + esc(u.name) + ' <small style="color:var(--dim)">' + rankOf(u.score) + '</small></span>' +
        '<span class="rank-score">' + u.score + '</span></div>').join('');
    } catch (e) { p.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }

  /* ---------- 错题本 ---------- */
  async function openWrong() {
    showScreen('screen-wrong');
    const p = $('wrong-list');
    p.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const r = await API.wrong();
      if (!r.list.length) { p.innerHTML = '<div class="empty-tip">太棒了，当前没有错题！</div>'; return; }
      p.innerHTML = r.list.map(q => wrongCard(q)).join('');
    } catch (e) { p.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }
  function wrongCard(q) {
    const correctLetters = String(q.answer || '');
    let body = '<div class="q-body">[' + esc(TYPE_NAME[q.type]) + ' · 第' + q.chapter + '章] ' + esc(q.question) + '</div>';
    if (q.type === 'fill') {
      body += '<div class="opts">答案：<span class="right">' + esc(q.answer) + '</span></div>';
    } else {
      body += q.options.map((o, i) => {
        const letter = String.fromCharCode(65 + i);
        const isRight = q.type === 'multi' ? correctLetters.split(/[,，]/).includes(letter) : q.answer === letter;
        return '<div class="opts ' + (isRight ? 'right' : '') + '">' + esc(o) + '</div>';
      }).join('');
    }
    if (q.explain) body += '<div style="color:var(--dim);margin-top:4px">解析：' + esc(q.explain) + '</div>';
    return '<div class="q-card">' + body + '</div>';
  }

  /* 错题重练（1.0.0.4：判分走服务端，答案不下发） */
  let practiceList = [], practiceIdx = 0, practicePt = '';
  async function startPractice() {
    $('practice-card').style.display = 'flex';
    try {
      const r = await API.wrongPractice();
      practiceList = r.list || [];
      practicePt = r.pt || '';
      practiceIdx = 0;
      if (!practiceList.length) { $('p-msg').textContent = '没有错题可练'; return; }
      showPracticeQ();
    } catch (e) { $('p-msg').textContent = e.message; }
  }
  function practiceReport(res) {
    const q = practiceList[practiceIdx];
    API.answer({ pt: practicePt, qid: q.id, choice: res.choice, mode: 'practice' }).then(r => {
      practiceMark(r.correct, r.answer);
    }).catch(() => { practiceMark(false, null); });
  }
  function practiceMark(correct, answerText) {
    const q = practiceList[practiceIdx];
    if (correct) { $('p-msg').innerHTML = '<span style="color:var(--ok)">✅ 答对！' + (q.explain ? ' ' + esc(q.explain) : '') + '</span>'; }
    else { $('p-msg').innerHTML = '<span style="color:var(--danger)">❌ 答错' + (answerText ? '，正确答案：' + esc(answerText) : '') + (q.explain ? '，解析：' + esc(q.explain) : '') + '</span>'; }
    $('p-next').dataset.done = '1';
  }
  function showPracticeQ() {
    const q = practiceList[practiceIdx];
    $('p-question').textContent = '[' + TYPE_NAME[q.type] + '] ' + q.question;
    $('p-msg').textContent = '';
    const optBox = $('p-options'), fillBox = $('p-fill');
    optBox.innerHTML = ''; fillBox.style.display = 'none';
    if (q.type === 'matching') { buildMatchUI(optBox, q, (userPairs) => { practiceReport({ choice: userPairs }); }); return; }
    if (q.type === 'fill') {
      fillBox.style.display = 'flex';
      $('p-fill-input').value = '';
      return;
    }
    q.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'opt-btn';
      b.textContent = o;
      b.dataset.idx = i;
      b.onclick = () => {
        API.answer({ pt: practicePt, qid: q.id, choice: i, mode: 'practice' }).then(r => {
          b.className = 'opt-btn ' + (r.correct ? 'right' : 'wrong');
          practiceMark(r.correct, r.answer);
        }).catch(() => {
          b.className = 'opt-btn wrong';
          practiceMark(false, null);
        });
        b.disabled = true;
        b.parentNode.querySelectorAll('.opt-btn').forEach(x => { if (x.dataset.idx !== String(i)) x.disabled = true; });
      };
      optBox.appendChild(b);
    });
  }
  $('p-fill-submit').onclick = () => {
    practiceReport({ choice: $('p-fill-input').value });
  };
  $('p-next').onclick = () => {
    if ($('p-next').dataset.done !== '1' && practiceList.length) { toast('请先回答本题'); return; }
    practiceIdx++;
    if (practiceIdx >= practiceList.length) {
      $('practice-card').style.display = 'none';
      toast('本轮错题重练完成！');
      openWrong();
    } else showPracticeQ();
  };

  /* ---------- 物理量识记 ---------- */
  const MEMORY_DATA = [
    ['电流', 'I', '安培 A', '1A=10³mA=10⁶μA'],
    ['电压', 'U', '伏特 V', '1kV=10³V'],
    ['电阻', 'R', '欧姆 Ω', '1MΩ=10³kΩ=10⁶Ω'],
    ['电功率', 'P', '瓦特 W', 'P=UI=I²R=U²/R'],
    ['电能', 'W', '焦耳 J', '1kW·h=3.6×10⁶J，W=Pt'],
    ['电容', 'C', '法拉 F', '1F=10⁶μF=10¹²pF，C=Q/U'],
    ['电感', 'L', '亨利 H', '1H=10³mH=10⁶μH'],
    ['频率', 'f', '赫兹 Hz', '工频50Hz，f=1/T'],
    ['周期', 'T', '秒 s', 'T=1/f=0.02s(工频)'],
    ['角频率', 'ω', '弧度/秒 rad/s', 'ω=2πf≈314rad/s'],
    ['磁感应强度', 'B', '特斯拉 T', '1T=1Wb/m²，F=BILsinθ'],
    ['磁通', 'Φ', '韦伯 Wb', 'Φ=BS'],
    ['感抗', 'XL', '欧姆 Ω', 'XL=2πfL'],
    ['容抗', 'XC', '欧姆 Ω', 'XC=1/(2πfC)'],
    ['有功功率', 'P', '瓦特 W', 'P=UIcosφ'],
    ['无功功率', 'Q', '乏 var', 'Q=UIsinφ'],
    ['视在功率', 'S', '伏安 VA', 'S=UI=√(P²+Q²)'],
    ['功率因数', 'cosφ', '无量纲', 'cosφ=P/S，并联电容可提高']
  ];
  function renderMemory() {
    showScreen('screen-memory');
    $('memory-table').innerHTML = '<tr><th>物理量</th><th>符号</th><th>单位</th><th>关系 / 换算</th></tr>' +
      MEMORY_DATA.map(r => '<tr><td>' + r[0] + '</td><td><b>' + r[1] + '</b></td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('');
    API.memory().then(r => { $('memory-best').textContent = '最高 ' + (r.best || 0) + ' 分'; }).catch(() => {});
  }
  function startMemoryQuiz() {
    const box = $('memory-quiz');
    box.style.display = 'block';
    const items = MEMORY_DATA.slice().sort(() => Math.random() - 0.5).slice(0, 8);
    const qs = items.map((d, i) => {
      const mode = i % 4;
      if (mode === 0) return { t: '物理量「' + d[0] + '」的符号是？', a: d[1], info: d };
      if (mode === 1) return { t: '物理量「' + d[0] + '」的国际单位是？', a: d[2].split(' ')[0], info: d };
      if (mode === 2) return { t: '物理量「' + d[0] + '」：' + d[3], a: '', info: d };
      return { t: '「' + d[2] + '」是哪个物理量的单位？', a: d[0], info: d };
    });
    let score = 0, idx = 0, correctN = 0;
    const render = () => {
      if (idx >= qs.length) {
        const gain = correctN * 5;
        API.memoryScore(score, gain).then(r => { S.me = r.user; $('memory-best').textContent = '最高 ' + r.best + ' 分'; }).catch(() => {});
        box.innerHTML = '<div class="memory-card"><div class="m-q">🎉 自测完成！得分：' + score + '　答对 ' + correctN + '/' + qs.length + '　获得积分 +' + gain + '</div></div>';
        toast('识记自测完成，+ ' + gain + ' 积分');
        return;
      }
      const q = qs[idx];
      box.innerHTML = '<div class="memory-card"><div class="m-q">' + (idx + 1) + '/8　' + esc(q.t) + '</div>' +
        '<div style="margin-top:8px"><input id="mq-input" type="text" placeholder="输入答案（填空）" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div style="margin-top:8px;display:flex;gap:8px"><button class="btn primary" id="mq-submit" style="flex:1">提交</button><button class="btn ghost" id="mq-skip">跳过</button></div>' +
        '<div class="msg" id="mq-msg"></div></div>';
      $('mq-submit').onclick = () => {
        const v = $('mq-input').value.trim();
        if (!v) { $('mq-msg').textContent = '请输入答案'; return; }
        const correct = Norm.answerMatch(v, q.a);
        if (correct) { score += 10; correctN++; $('mq-msg').innerHTML = '<span style="color:var(--ok)">✅ 答对 +10 分</span>'; }
        else $('mq-msg').innerHTML = '<span style="color:var(--danger)">❌ 正确答案：' + esc(q.a) + '</span>';
        $('mq-submit').disabled = true;
        setTimeout(() => { idx++; render(); }, 900);
      };
      $('mq-skip').onclick = () => { idx++; render(); };
    };
    render();
  }

  /* ---------- 教师端 ---------- */
  async function openTeacher() {
    showScreen('screen-teacher');
    loadStudents();
    loadQuestions();
    loadAnalysis();
    loadLogs();
  }
  async function loadStudents() {
    const p = $('student-list');
    p.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const r = await API.users();
      if (!r.list.length) { p.innerHTML = '<div class="empty-tip">暂无学生注册</div>'; return; }
      let list = r.list.slice();
      const kw = (PG.students.kw || '').toLowerCase();
      if (kw) list = list.filter(u => (u.name || '').toLowerCase().includes(kw));
      if (PG.students.grade) list = list.filter(u => gradeOfUser(u) === PG.students.grade);
      const cmps = {
        name: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'),
        score: (a, b) => (b.score || 0) - (a.score || 0),
        acc: (a, b) => (b.total ? b.correct / b.total : 0) - (a.total ? a.correct / a.total : 0),
        stars: (a, b) => (b.stars || 0) - (a.stars || 0),
        reg: (a, b) => String(b.reg || '').localeCompare(String(a.reg || ''))
      };
      list.sort(cmps[PG.students.sort] || cmps.name);
      const pp = pager(list, PG.students);
      p.innerHTML = toolRowHtml(PG.students, {
        placeholder: '按姓名查找学生…',
        sorts: [{ v: 'name', label: '按姓名' }, { v: 'score', label: '按积分↓' }, { v: 'acc', label: '按正确率↓' }, { v: 'stars', label: '按星星↓' }, { v: 'reg', label: '按注册时间↓' }],
        grades: ['优', '良', '中', '差'],
        setKw: 'UIM.setStuKw', setSort: 'UIM.setStuSort', setGrade: 'UIM.setStuGrade',
        total: list.length
      }) +
        pagerHtml(list.length, PG.students, 'UIM.gotoStudents') +
        '<table class="data-table"><tr><th>姓名</th><th>积分</th><th>答对/总数</th><th>正确率</th><th>等级</th><th>星星</th><th>通关章</th><th>错题</th><th>注册时间</th><th>最近登录</th><th>操作</th></tr>' +
        pp.rows.map(u => {
          const g = gradeOfUser(u);
          return '<tr><td><a class="stu-link" href="javascript:void(0)" onclick="UIM.viewStudent(\'' + u.id + '\',\'' + esc(u.name) + '\')">' + esc(u.name) + '</a></td><td>' + u.score + '</td><td>' + u.correct + '/' + u.total + '</td><td>' + (u.total ? Math.round(u.correct / u.total * 100) : 0) + '%</td><td style="color:' + (g === '优' ? 'var(--ok)' : g === '差' ? 'var(--danger)' : 'var(--accent2)') + ';font-weight:700">' + g + '</td><td>' + u.stars + '</td><td>' + u.cleared + '</td><td>' + u.wrongCount + '</td><td>' + fmtTime(u.reg) + '</td><td>' + fmtTime(u.lastLogin) + '</td>' +
            '<td><div class="actions-row">' +
            '<button class="btn small" onclick="UIM.scoreModal(\'' + u.id + '\',\'' + esc(u.name) + '\')">加减分</button>' +
            '<button class="btn small" onclick="UIM.resetModal(\'' + u.id + '\',\'' + esc(u.name) + '\')">重置密码</button>' +
            '<button class="btn small danger" onclick="UIM.deleteUser(\'' + u.id + '\',\'' + esc(u.name) + '\')">删除</button>' +
            '</div></td></tr>';
        }).join('') + '</table>';
    } catch (e) { p.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }
  async function loadQuestions() {
    const p = $('question-list');
    p.innerHTML = '<div class="empty-tip">加载中…</div>';
    const ch = $('q-filter-chapter').value, type = $('q-filter-type').value, kw = $('q-filter-kw').value.trim();
    try {
      const r = await API.qList({ chapter: ch, type, kw });
      if (!r.list.length) { p.innerHTML = '<div class="empty-tip">没有符合条件的题目（题库共 ' + r.total + ' 题）</div>'; return; }
      let list = r.list.slice();
      const qsort = PG.questions.sort || 'idAsc';
      if (qsort === 'idDesc') list.sort((a, b) => b.id - a.id);
      else if (qsort === 'ch') list.sort((a, b) => (a.chapter - b.chapter) || ((a.section || 1) - (b.section || 1)) || (a.id - b.id));
      else list.sort((a, b) => a.id - b.id);
      const pp = pager(list, PG.questions);
      p.innerHTML = '<div class="tool-row"><select class="tool-select" onchange="UIM.setQSort(this.value)">' +
        '<option value="idAsc"' + (qsort === 'idAsc' ? ' selected' : '') + '>ID 升序</option>' +
        '<option value="idDesc"' + (qsort === 'idDesc' ? ' selected' : '') + '>ID 降序</option>' +
        '<option value="ch"' + (qsort === 'ch' ? ' selected' : '') + '>按章节</option></select>' +
        '<span class="cnt">题库共 ' + r.total + ' 题，当前显示第 ' + ((PG.questions.page - 1) * PG.questions.size + 1) + '~' + ((PG.questions.page - 1) * PG.questions.size + pp.rows.length) + ' 条</span></div>' +
        pagerHtml(list.length, PG.questions, 'UIM.gotoQuestions') +
        '<table class="data-table"><tr><th style="width:28px"><input type="checkbox" id="qsel-all" onclick="UIM.qSelAll(this)"></th><th>ID</th><th>章</th><th>节</th><th>题型</th><th>题干</th><th>难度</th><th>答案</th><th>操作</th></tr>' +
        pp.rows.map(q =>
          '<tr><td style="width:28px"><input type="checkbox" data-qid="' + q.id + '"' + (S.qSel[q.id] ? ' checked' : '') + ' onchange="UIM.qSelOne(' + q.id + ',this)"></td><td>' + q.id + '</td><td>' + q.chapter + '</td><td>' + (q.section || 1) + '</td><td>' + TYPE_NAME[q.type] + '</td><td style="max-width:200px">' + esc(q.question) + '</td><td>' + UIM.diffStar(q.difficulty) + '</td><td>' + (q.type === 'matching' ? '配对' : esc(String(q.answer))) + '</td>' +
          '<td><div class="actions-row"><button class="btn small" onclick="UIM.editQ(' + q.id + ')">编辑</button><button class="btn small danger" onclick="UIM.delQ(' + q.id + ')">删除</button></div></td></tr>').join('') + '</table>';
    } catch (e) { p.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }
  async function loadAnalysis() {
    const p = $('class-analysis');
    p.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const [r, users] = await Promise.all([API.classAnalysis(), API.users()]);
      S.users = users.list || [];
      // 填充学生下拉（个人分析选择器）
      const stuSel = $('ana-student-select');
      const cur = stuSel.value;
      stuSel.innerHTML = '<option value="">— 选择学生查看个人分析 —</option>' +
        (users.list || []).map(u => '<option value="' + u.id + '"' + (u.id === cur ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('');
      S.anaStu = cur;
      S.anaStuName = cur ? ((users.list || []).find(u => u.id === cur) || {}).name || '' : '';
      $('student-analysis').style.display = 'none';
      // 填充章节下拉（答题情况分析在 renderAnaMode 中统一加载）
      const chSel = $('ana-chapter-select');
      const curCh = chSel.value || '0';
      chSel.innerHTML = S.chapters.map(c => '<option value="' + c.id + '">第' + (c.id === 0 ? '0' : c.id) + '章 ' + c.name + '</option>').join('');
      chSel.value = curCh;
      if (!r.count) { p.innerHTML = '<div class="empty-tip">暂无学生数据</div>'; return; }
      const total = r.gradeCount['优'] + r.gradeCount['良'] + r.gradeCount['中'] + r.gradeCount['差'] || 1;
      const gradeCards = ['优', '良', '中', '差'].map(g => {
        const label = g === '优' ? '优秀(≥90%)' : g === '良' ? '良好(≥75%)' : g === '中' ? '中等(≥60%)' : '较差(<60%)';
        return '<div class="stat-card' + (PG.analysis.grade === g ? ' active' : '') + '" onclick="UIM.setAnaGrade(\'' + g + '\')"><div class="v">' + r.gradeCount[g] + '</div><div class="k">' + label + '</div></div>';
      }).join('');
      // 明细：查找/排序/等级筛选
      let rows = (r.rows || []).slice();
      const akw = (PG.analysis.kw || '').toLowerCase();
      if (akw) rows = rows.filter(x => (x.name || '').toLowerCase().includes(akw));
      if (PG.analysis.grade) rows = rows.filter(x => x.grade === PG.analysis.grade);
      const cmps = {
        acc: (a, b) => (b.acc || 0) - (a.acc || 0),
        score: (a, b) => (b.score || 0) - (a.score || 0),
        stars: (a, b) => (b.stars || 0) - (a.stars || 0)
      };
      rows.sort(cmps[PG.analysis.sort] || cmps.acc);
      const pp = pager(rows, PG.analysis);
      p.innerHTML = '<div class="stat-cards">' +
        '<div class="stat-card"><div class="v">' + r.count + '</div><div class="k">学生人数</div></div>' +
        '<div class="stat-card"><div class="v">' + r.avgAcc + '%</div><div class="k">平均正确率</div></div>' + gradeCards +
        '</div>' +
        (PG.analysis.grade ? '<div class="q-meta" style="margin-top:6px">当前筛选：<b style="color:var(--accent)">' + PG.analysis.grade + '等</b> 学生 ' + rows.length + ' 人（点击上方等次数字可切换或取消）</div>' : '') +
        '<div class="grade-bar"><div class="g-优" style="width:' + (r.gradeCount['优'] / total * 100) + '%"></div><div class="g-良" style="width:' + (r.gradeCount['良'] / total * 100) + '%"></div><div class="g-中" style="width:' + (r.gradeCount['中'] / total * 100) + '%"></div><div class="g-差" style="width:' + (r.gradeCount['差'] / total * 100) + '%"></div></div>' +
        toolRowHtml(PG.analysis, {
          placeholder: '按姓名查找学生…',
          sorts: [{ v: 'acc', label: '按正确率↓' }, { v: 'score', label: '按积分↓' }, { v: 'stars', label: '按星星↓' }],
          grades: null,
          setKw: 'UIM.setAnaKw', setSort: 'UIM.setAnaSort', setGrade: 'UIM.setAnaGrade',
          total: rows.length
        }) +
        '<table class="data-table" style="margin-top:10px"><tr><th>姓名</th><th>积分</th><th>答对/总数</th><th>正确率</th><th>等级</th><th>星星</th></tr>' +
        pp.rows.map(x => '<tr><td><a class="stu-link" href="javascript:void(0)" onclick="UIM.viewStudent(\'' + ((S.users.find(u => u.name === x.name) || {}).id || '') + '\',\'' + esc(x.name) + '\')">' + esc(x.name) + '</a></td><td>' + x.score + '</td><td>' + x.correct + '/' + x.total + '</td><td>' + x.acc + '%</td><td style="color:' + (x.grade === '优' ? 'var(--ok)' : x.grade === '差' ? 'var(--danger)' : 'var(--accent2)') + ';font-weight:700">' + x.grade + '</td><td>' + x.stars + '</td></tr>').join('') + '</table>' +
        pagerHtml(rows.length, PG.analysis, 'UIM.gotoAnalysis');
      renderAnaMode();
    } catch (e) { p.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }
    
  
  
  
  
  function renderAnaMode() {
    const stuId = S.anaStu;
    const tq = $('ana-title-q');
    if (tq) tq.textContent = stuId ? '📊 答题情况分析（个人）' : '📊 答题情况分析（全班）';
    const tm = $('ana-title-m');
    if (tm) tm.textContent = stuId ? '📋 同学掌握情况汇总（个人 · 章·节·题）' : '📋 同学掌握情况汇总（章·节·题）';
    const chSel = $('ana-chapter-select');
    loadChapterAnalysis(parseInt(chSel ? chSel.value || '0' : '0', 10));
    loadMastery();
  }
  async function loadStudentAnalysis(id) {
    const p = $('student-analysis');
    try {
      const [r, m] = await Promise.all([API.studentAnalysis(id), API.mastery()]);
      const mu = (m.list || []).find(x => x.id === id);
      p.style.display = 'block';
      const stars = r.chapterStars.reduce((s, c) => s + (c.stars || 0), 0);
      let html = '<div class="ana-title">个人成绩分析：' + esc(r.user.name) + '</div>';
      // 统计卡（积分/答对总数/正确率/等级/星星）
      html += '<div class="stat-cards">' +
        '<div class="stat-card"><div class="v">' + r.user.score + '</div><div class="k">积分</div></div>' +
        '<div class="stat-card"><div class="v">' + r.user.correct + '/' + r.user.total + '</div><div class="k">答对/总数</div></div>' +
        '<div class="stat-card"><div class="v">' + r.user.acc + '%</div><div class="k">正确率</div></div>' +
        '<div class="stat-card"><div class="v">' + r.grade + '</div><div class="k">等级</div></div>' +
        '<div class="stat-card"><div class="v">' + stars + ' &#11088;</div><div class="k">星星</div></div>' +
        '</div>';
      // 章节情况（各章获得星星）
      html += '<table class="data-table" style="margin-top:14px"><tr><th>章节</th><th>获得星星</th><th>答对/总数</th><th>正确率</th></tr>' +
        r.chapterStars.map(c => {
          const chd = mu && mu.chapters.find(x => x.chapter === c.chapter);
          return '<tr><td>第' + (c.chapter === 0 ? '0' : c.chapter) + '章 ' + esc(c.name) + '</td><td>' + (c.stars || 0) + ' &#9733;</td><td>' + (chd && chd.answered ? chd.correct + '/' + chd.answered : '—') + '</td><td>' + (chd && chd.answered ? chd.acc + '%' : '—') + '</td></tr>';
        }).join('') + '</table>';
      // 章节答题明细（章→节→题，直接列出）
      if (mu && mu.chapters.length) {
        html += mu.chapters.map(ch => {
          const secHtml = ch.sections.map(s =>
            '<div style="margin:6px 0 0 12px"><b>' + esc(s.name) + '</b>：答对 ' + s.correct + '/' + s.answered + '（' + (s.answered ? Math.round(s.correct / s.answered * 100) : 0) + '%）</div>' +
            s.questions.map(q => {
              const mark = q.answered ? (q.ok === q.answered ? '&#9989;' : (q.ok > 0 ? '&#9888;&#65039; 部分' : '&#10060;')) : '—';
              return '<div style="margin:2px 0 2px 24px;font-size:12px">' + mark + ' #' + q.id + ' ' + esc(q.question) + '（答对 ' + q.ok + '/' + q.answered + '）</div>';
            }).join('')
          ).join('');
          return '<div class="ana-title" style="margin-top:14px">第' + (ch.chapter === 0 ? '0' : ch.chapter) + '章 ' + esc(ch.name) + '：' + (ch.answered ? ch.acc + '%' : '—') + '（答对 ' + ch.correct + '/' + ch.answered + '）</div>' + secHtml;
        }).join('');
      } else { html += '<div class="empty-tip">该生暂无答题记录</div>'; }
      p.innerHTML = html;
    } catch (e) { p.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }
async function loadChapterAnalysis(ch) {
    const box = $('ana-chapter');
    box.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const r = await API.chapterAnalysis(ch);
      let mch = null;
      if (S.anaStu) {
        const m = await API.mastery();
        const mu = (m.list || []).find(x => x.id === S.anaStu);
        mch = mu && mu.chapters.find(x => x.chapter === ch);
      }
      // 等次筛选（全班模式）：按选中等次重算章/节/题
      const gradeSet = (!S.anaStu && PG.analysis.grade) ? new Set((S.users || []).filter(u => gradeOfUser(u) === PG.analysis.grade).map(u => u.name)) : null;
      let r2 = r;
      if (gradeSet) {
        const qs = r.questions.map(qq => {
          const okN = (qq.correctUsers || []).filter(n => gradeSet.has(n));
          const badN = (qq.wrongUsers || []).filter(n => gradeSet.has(n));
          const tot = okN.length + badN.length;
          return { ...qq, correctUsers: okN, wrongUsers: badN, correct: okN.length, wrong: badN.length, acc: tot ? Math.round(okN.length / tot * 100) : null };
        });
        const secAgg = {};
        qs.forEach(qq => {
          const s = qq.section || 1;
          if (!secAgg[s]) secAgg[s] = { section: s, name: (r.sections.find(x => x.section === s) || {}).name || ('第' + s + '节'), questions: 0, answered: 0, correct: 0 };
          secAgg[s].questions++;
          secAgg[s].answered += qq.answered; secAgg[s].correct += qq.correct;
        });
        const secs = Object.values(secAgg).map(s => ({ ...s, acc: s.answered ? Math.round(s.correct / s.answered * 100) : null }));
        const allA = qs.reduce((s, qq) => s + qq.answered, 0);
        const allC = qs.reduce((s, qq) => s + qq.correct, 0);
        r2 = { ...r, sections: secs, questions: qs, answered: allA, correct: allC, acc: allA ? Math.round(allC / allA * 100) : null };
      }
      const accTxt = r2.acc === null ? '暂无答题数据' : r2.acc + '%';
      let html = '<div class="q-meta">' + (S.anaStu ? '本章个人正确率：' : (PG.analysis.grade ? '本章筛选正确率（' + PG.analysis.grade + '等）：' : '本章全班正确率：')) + '<b style="color:var(--accent);font-size:15px">' + (mch && mch.answered ? mch.acc + '%' : accTxt) + '</b>' + (S.anaStu ? '（该生答对 ' + (mch ? mch.correct : 0) + '/' + (mch ? mch.answered : 0) + '）' : '（已答题 ' + r2.answered + ' 人次，答对 ' + r2.correct + ' 人次）') + '</div>';
      html += '<div class="sec-grid">' + r2.sections.map(s => {
        const a = s.acc === null ? '—' : s.acc + '%';
        const sCh = mch && mch.sections.find(x => x.section === s.section);
        const sa = sCh && sCh.answered ? Math.round(sCh.correct / sCh.answered * 100) + '%' : a;
        return '<div class="sec-card" onclick="UIM.toggleSec(' + ch + ',' + s.section + ',this)">' +
          '<div class="s-name">' + esc(s.name) + '</div>' +
          '<div class="s-acc">' + (S.anaStu ? sa : a) + '</div>' +
          '<div class="s-meta">' + s.questions + ' 题 · ' + (S.anaStu ? (sCh && sCh.answered ? '该生答对 ' + sCh.correct + '/' + sCh.answered : '该生未作答') : '答对 ' + s.correct + '/' + s.answered) + '</div>' +
          '<div class="s-meta" style="color:var(--dim2)">点击展开每题对错名单</div></div>';
      }).join('') + '</div>';
      // 每题明细（个人模式只显示该生对错；等次筛选只显示该等次学生）
      html += '<div class="qrow-list">' + r2.questions.map(q => qRowHtml(q, mch, gradeSet)).join('') + '</div>';
      box.innerHTML = html;
    } catch (e) { box.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }
  async function loadSectionAnalysis(ch, sec, cardEl) {
    try {
      const r = await API.sectionAnalysis(ch, sec);
      if (!cardEl) return;
      const exist = cardEl.parentNode.querySelector('.sec-detail');
      if (exist) { exist.remove(); return; }
      let mch = null;
      if (S.anaStu) {
        const m = await API.mastery();
        const mu = (m.list || []).find(x => x.id === S.anaStu);
        mch = mu && mu.chapters.find(x => x.chapter === ch);
      }
      const gradeSet = (!S.anaStu && PG.analysis.grade) ? new Set((S.users || []).filter(u => gradeOfUser(u) === PG.analysis.grade).map(u => u.name)) : null;
      let r2 = r;
      if (gradeSet) {
        const qs = r.questions.map(qq => {
          const okN = (qq.correctUsers || []).filter(n => gradeSet.has(n));
          const badN = (qq.wrongUsers || []).filter(n => gradeSet.has(n));
          const tot = okN.length + badN.length;
          return { ...qq, correctUsers: okN, wrongUsers: badN, correct: okN.length, wrong: badN.length, acc: tot ? Math.round(okN.length / tot * 100) : null };
        });
        const allA = qs.reduce((s, qq) => s + qq.answered, 0);
        const allC = qs.reduce((s, qq) => s + qq.correct, 0);
        r2 = { ...r, questions: qs, answered: allA, correct: allC, acc: allA ? Math.round(allC / allA * 100) : null };
      }
      const div = document.createElement('div');
      div.className = 'mastery-detail sec-detail';
      const sCh = mch && mch.sections.find(x => x.section === sec);
      div.innerHTML = '<div class="q-meta">『' + esc(r2.section.name) + '』' + (S.anaStu ? '个人正确率：' : (PG.analysis.grade ? '筛选正确率（' + PG.analysis.grade + '等）：' : '全班正确率：')) + '<b style="color:var(--accent)">' + (S.anaStu ? (sCh && sCh.answered ? Math.round(sCh.correct / sCh.answered * 100) + '%' : '—') : (r2.acc === null ? '—' : r2.acc + '%')) + '</b>' + (S.anaStu ? '（答对 ' + (sCh ? sCh.correct : 0) + '/' + (sCh ? sCh.answered : 0) + '）' : '（答对 ' + r2.correct + '/' + r2.answered + '）') + '</div>' +
        r2.questions.map(q => qRowHtml(q, mch, gradeSet)).join('');
      cardEl.parentNode.insertBefore(div, cardEl.nextSibling);
    } catch (e) { alert(e.message); }
  }
  function qRowHtml(q, mch, gradeSet) {
    let qq = q;
    if (!mch && gradeSet) {
      const okN = (q.correctUsers || []).filter(n => gradeSet.has(n));
      const badN = (q.wrongUsers || []).filter(n => gradeSet.has(n));
      qq = { ...q, correctUsers: okN, wrongUsers: badN, correct: okN.length, wrong: badN.length, acc: (okN.length + badN.length) ? Math.round(okN.length / (okN.length + badN.length) * 100) : null };
    }
    const a = qq.acc === null ? '—' : qq.acc + '%';
    let correctHtml, wrongHtml;
    if (mch) {
      let qd = null;
      mch.sections.forEach(s => { const f = s.questions.find(x => x.id === q.id); if (f) qd = f; });
      const ok = qd && qd.answered && qd.ok === qd.answered;
      const bad = qd && qd.answered && qd.ok < qd.answered;
      const un = !qd || !qd.answered;
      correctHtml = '答对：' + (ok ? '<span class="chip ok">' + esc(S.anaStuName) + '</span>' : (un ? '<span class="chip" style="color:var(--dim)">未作答</span>' : '<span class="chip" style="color:var(--dim)">无</span>'));
      wrongHtml = '答错：' + (bad ? '<span class="chip bad">' + esc(S.anaStuName) + '</span>' : '<span class="chip" style="color:var(--dim)">无</span>');
    } else {
      correctHtml = '答对：' + (qq.correctUsers.length ? qq.correctUsers.map(n => '<span class="chip ok">' + esc(n) + '</span>').join('') : '<span class="chip" style="color:var(--dim)">无</span>');
      wrongHtml = '答错：' + (qq.wrongUsers.length ? qq.wrongUsers.map(n => '<span class="chip bad">' + esc(n) + '</span>').join('') : '<span class="chip" style="color:var(--dim)">无</span>');
    }
    return '<div class="qrow">' +
      '<div class="q-text">#' + qq.id + ' ' + esc(qq.question) + '</div>' +
      '<div class="q-meta">' + (TYPE_NAME[qq.type] || qq.type) + ' · ' + (gradeSet ? '筛选正确率' : '全班正确率') + ' <b style="color:var(--accent)">' + a + '</b> · 答对 ' + qq.correct + ' / 答错 ' + qq.wrong + '</div>' +
      '<div>' + correctHtml + '</div>' +
      '<div>' + wrongHtml + '</div>' +
      '</div>';
  }
  async function loadMastery() {
    const box = $('ana-mastery');
    box.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const r = await API.mastery();
      if (!r.list.length) { box.innerHTML = '<div class="empty-tip">暂无学生数据</div>'; return; }
      if (S.anaStu) {
        const u = r.list.find(x => x.id === S.anaStu);
        if (!u) { box.innerHTML = '<div class="empty-tip">该生暂无数据</div>'; return; }
        // 只显示选中学生一行（高亮），隐藏其他学生行
        let html = '<table class="mastery-table"><tr><th>学生</th>';
        S.chapters.forEach(c => { html += '<th>第' + (c.id === 0 ? '0' : c.id) + '章</th>'; });
        html += '</tr>';
        html += '<tr style="background:rgba(80,200,120,.14)"><td style="text-align:left;font-weight:700;color:var(--accent)">' + esc(u.name) + ' ⭐</td>';
        S.chapters.forEach(c => {
          const chd = u.chapters.find(x => x.chapter === c.id);
          if (!chd || !chd.answered) { html += '<td style="color:var(--dim)">—</td>'; return; }
          html += '<td class="m-cell" onclick="UIM.toggleMastery(\'' + u.id + '\',' + c.id + ',this)">' +
            '<span class="m-acc">' + chd.acc + '%</span>' +
            '<span class="m-sub">答对 ' + chd.correct + '/' + chd.answered + '</span></td>';
        });
        html += '</tr></table>';
        // 该生个人明细（按章节可收缩）
        html += '<div class="ana-title" style="margin-top:12px">📌 该生章节掌握明细（点击章名收缩/展开）</div>';
        html += u.chapters.map(ch => {
          const secHtml = ch.sections.map(s =>
            '<div style="margin:6px 0 0 14px"><b>' + esc(s.name) + '</b>：答对 ' + s.correct + '/' + s.answered + '（' + (s.answered ? Math.round(s.correct / s.answered * 100) : 0) + '%）</div>' +
            s.questions.map(q => {
              const mark = q.answered ? (q.ok === q.answered ? '✅' : (q.ok > 0 ? '⚠️ 部分' : '❌')) : '—';
              return '<div style="margin:2px 0 2px 26px;font-size:12px">' + mark + ' #' + q.id + ' ' + esc(q.question) + '（答对 ' + q.ok + '/' + q.answered + '）</div>';
            }).join('')
          ).join('');
          return '<details class="m-fold" data-ch="' + ch.chapter + '"><summary>第' + (ch.chapter === 0 ? '0' : ch.chapter) + '章 ' + esc(ch.name) + '：' + (ch.answered ? ch.acc + '%' : '—') + '（答对 ' + ch.correct + '/' + ch.answered + '）</summary>' + secHtml + '</details>';
        }).join('');
        box.innerHTML = html;
        return;
      }
      let html = '<table class="mastery-table"><tr><th>学生</th>';
      S.chapters.forEach(c => { html += '<th>第' + (c.id === 0 ? '0' : c.id) + '章</th>'; });
      html += '</tr>';
      S.masteryList = r.list; // 缓存全班掌握数据（点击单元格直接出明细）
      const gF = PG.analysis.grade;
      const kwName = (PG.analysis.kw || '').trim();
      const kwFound = kwName ? r.list.some(u => u.name === kwName) : false;
      let gradeShown = 0;
      r.list.forEach(u => {
        const ua = u.acc;
        const ug = ua == null ? '差' : (ua >= 90 ? '优' : ua >= 75 ? '良' : ua >= 60 ? '中' : '差');
        const isKw = kwName && u.name === kwName;
        if (kwName && !isKw) return; // 查找框锁定学生：表格只显示该生一行，隐藏其他行
        if (gF && ug !== gF) return; // 等次筛选：表格只显示选中（优/良/中/差）等次的学生行
        gradeShown++;
        const rowStyle = isKw ? ' style="background:rgba(80,200,120,.14)"' : (gF ? ' style="background:rgba(80,200,120,.14)"' : '');
        html += '<tr' + rowStyle + '><td style="text-align:left;font-weight:700">' + esc(u.name) + ((isKw || gF) ? ' ⭐' : '') + '</td>';
        S.chapters.forEach(c => {
          const chd = u.chapters.find(x => x.chapter === c.id);
          if (!chd || !chd.answered) { html += '<td style="color:var(--dim)">—</td>'; return; }
          html += '<td class="m-cell" onclick="UIM.toggleMastery(\'' + u.id + '\',' + c.id + ',this)">' +
            '<span class="m-acc">' + chd.acc + '%</span>' +
            '<span class="m-sub">答对 ' + chd.correct + '/' + chd.answered + '</span></td>';
        });
        html += '</tr>';
      });
      html += '</table>';
      if (kwName && !kwFound) html += '<div class="empty-tip" style="margin-top:6px">未找到学生「' + esc(kwName) + '」的掌握数据</div>';
      else if (gF && !gradeShown) html += '<div class="empty-tip" style="margin-top:6px">当前筛选（' + esc(gF) + '等）下暂无学生掌握数据</div>';
      html += '<div id="mastery-detail-zone"></div>'; // 全班模式章节掌握明细（同个人模式结构）
      box.innerHTML = html;
    } catch (e) { box.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }
  async function loadLogs() {
    const p = $('log-list');
    p.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const r = await API.logs();
      if (!r.list.length) { p.innerHTML = '<div class="empty-tip">暂无操作记录</div>'; return; }
      const pp = pager(r.list, PG.logs);
      p.innerHTML = pagerHtml(r.list.length, PG.logs, 'UIM.gotoLogs') +
        '<table class="data-table"><tr><th>时间</th><th>操作</th><th>对象</th><th>操作人</th><th>备注</th></tr>' +
        pp.rows.map(l => '<tr><td>' + fmtTime(l.t) + '</td><td>' + esc(l.op) + '</td><td>' + esc(l.name || '') + '</td><td>' + esc(l.by || '') + '</td><td>' + esc(l.reason || '') + '</td></tr>').join('') + '</table>';
    } catch (e) { p.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
  }

  /* ---------- 弹窗 ---------- */
  function openModal(html) { $('modal-body').innerHTML = html; $('modal').style.display = 'flex'; }
  function closeModal() { $('modal').style.display = 'none'; }

  /* 题目表单（新增/编辑） */
  function questionForm(q) {
    const chapters = S.chapters.map(c => '<option value="' + c.id + '"' + (q && q.chapter === c.id ? ' selected' : '') + '>第' + (c.id === 0 ? '0' : c.id) + '章 ' + c.name + '</option>').join('');
    const typeOpts = { single: '单选', judge: '判断', multi: '多选', fill: '填空', matching: '连线', calc: '计算' };
    const typeSel = Object.keys(typeOpts).map(t => '<option value="' + t + '"' + (q && q.type === t ? ' selected' : '') + '>' + typeOpts[t] + '</option>').join('');
    const fillRow = q && q.type === 'fill' ? '' : '';
    openModal(
      '<h3 style="margin-bottom:12px">' + (q ? '编辑题目 #' + q.id : '新增题目') + '</h3>' +
      '<div class="form-row"><label style="font-size:12px;color:var(--dim)">所属章节</label><select id="qf-chapter" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.8);color:var(--text)">' + chapters + '</select></div>' +
      '<div class="form-row"><label style="font-size:12px;color:var(--dim)">节（成绩分析用，1~20）</label><input id="qf-section" type="number" min="1" max="20" value="' + (q ? (q.section || 1) : 1) + '" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
      '<div class="form-row"><label style="font-size:12px;color:var(--dim)">题型</label><select id="qf-type" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.8);color:var(--text)">' + typeSel + '</select></div>' +
      '<div class="form-row"><label style="font-size:12px;color:var(--dim)">题干</label><textarea id="qf-question" rows="3" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)">' + esc(q ? q.question : '') + '</textarea></div>' +
      '<div class="form-row" id="qf-opts-row"><label style="font-size:12px;color:var(--dim)">选项（每行一个，如：A. 50Hz；多选答案填字母如 A,C；填空题型不填选项）</label><textarea id="qf-options" rows="4" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)">' + (q && q.options && Array.isArray(q.options) ? q.options.join('\n') : '') + '</textarea></div>' +
      '<div class="form-row" id="qf-match-row" style="display:none">' +
      '<label style="font-size:12px;color:var(--dim)">连线题·左列（每行一项）</label><textarea id="qf-m-left" rows="3" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)">' + (q && q.type === 'matching' && q.options ? (q.options.left || []).join('\n') : '') + '</textarea>' +
      '<label style="font-size:12px;color:var(--dim);margin-top:6px">右列（每行一项，数量与左列一致）</label><textarea id="qf-m-right" rows="3" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)">' + (q && q.type === 'matching' && q.options ? (q.options.right || []).join('\n') : '') + '</textarea>' +
      '<label style="font-size:12px;color:var(--dim);margin-top:6px">配对（每行一对：左序号-右序号，从0开始，如 0-0、1-3）</label><textarea id="qf-m-pairs" rows="3" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)">' + (q && q.type === 'matching' ? String(q.answer).replace(/\[\[/g, '').replace(/\]\]/g, '').split('],[').map(s => s.replace(',', '-')).join('\n') : '') + '</textarea></div>' +
      '<div class="form-row"><label style="font-size:12px;color:var(--dim)">答案（单选/判断填字母如 A；多选填 A,C；填空/计算填答案文本，计算题填最终结果数值如 30；连线题在下方配对区填写）</label><input id="qf-answer" type="text" value="' + esc(q ? q.answer : '') + '"></div>' +
      '<div class="form-row"><label style="font-size:12px;color:var(--dim)">难度等级（1 最易 ~ 5 最难）</label><select id="qf-diff" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.8);color:var(--text)">' + [1,2,3,4,5].map(n => '<option value="' + n + '"' + ((q ? q.difficulty : 3) === n ? ' selected' : '') + '>' + n + ' 星' + (n === 1 ? '（易）' : n === 5 ? '（难）' : '') + '</option>').join('') + '</select></div>' +'<div class="form-row"><label style="font-size:12px;color:var(--dim)">解析（可选）</label><input id="qf-explain" type="text" value="' + esc(q ? q.explain : '') + '"></div>' +
      '<div class="msg" id="qf-msg"></div>' +
      '<div class="result-btns"><button class="btn ghost" onclick="UIM.closeModal()">取消</button><button class="btn primary" id="qf-save">保存</button></div>');
    const syncForm = () => {
      const isM = $('qf-type').value === 'matching';
      $('qf-opts-row').style.display = isM ? 'none' : '';
      $('qf-match-row').style.display = isM ? '' : 'none';
    };
    $('qf-type').onchange = syncForm;
    syncForm();
    $('qf-save').onclick = () => saveQuestion(q);
  }
  async function saveQuestion(q) {
    const type = $('qf-type').value;
    const section = parseInt($('qf-section').value, 10) || 1;
    let options = [], answer = $('qf-answer').value.trim();
    if (type === 'matching') {
      const left = $('qf-m-left').value.split('\n').map(s => s.trim()).filter(Boolean);
      const right = $('qf-m-right').value.split('\n').map(s => s.trim()).filter(Boolean);
      const pairs = $('qf-m-pairs').value.split('\n').map(s => s.trim()).filter(Boolean).map(s => s.split(/[-–,，]/).map(x => parseInt(x, 10)));
      options = { left, right };
      const bad = pairs.some(pr => !Array.isArray(pr) || pr.length !== 2 || isNaN(pr[0]) || isNaN(pr[1]));
      if (!left.length || !right.length) { $('qf-msg').textContent = '连线题需填写左右两列'; return; }
      if (left.length !== right.length) { $('qf-msg').textContent = '连线题左右列数量必须一致'; return; }
      if (bad || pairs.length !== left.length) { $('qf-msg').textContent = '配对须覆盖全部行且格式为 左序号-右序号'; return; }
      answer = JSON.stringify(pairs.map(pr => [pr[0], pr[1]]));
    } else {
      options = (type === 'fill' || type === 'calc') ? [] : $('qf-options').value.split('\n').map(s => s.trim()).filter(Boolean);
    }
    const data = {
      chapter: parseInt($('qf-chapter').value, 10),
      section,
      type,
      question: $('qf-question').value.trim(),
      options,
      answer,
      explain: $('qf-explain').value.trim(),
      difficulty: parseInt($('qf-diff').value, 10) || 3
    };
    const msg = $('qf-msg');
    if (!data.question) { msg.textContent = '题干不能为空'; return; }
    if (type !== 'fill' && type !== 'calc' && type !== 'matching' && options.length < 2) { msg.textContent = '选项至少 2 个'; return; }
    if (!data.answer) { msg.textContent = '答案不能为空'; return; }
    try {
      if (q) await API.qUpdate(q.id, data);
      else await API.qAdd(data);
      closeModal();
      toast('题目已保存');
      loadQuestions();
    } catch (e) { msg.textContent = e.message; }
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('tab-login').onclick = () => { $('tab-login').classList.add('active'); $('tab-register').classList.remove('active'); $('login-pass2').style.display = 'none'; };
    $('tab-register').onclick = () => { $('tab-register').classList.add('active'); $('tab-login').classList.remove('active'); $('login-pass2').style.display = ''; };
    $('btn-login').onclick = doLogin;
    $('login-pass').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };

    $('btn-logout').onclick = () => { API.clearToken(); S.me = null; location.reload(); };
    $('btn-goto-map').onclick = () => { renderMap(); showScreen('screen-map'); };
    $('btn-map-back').onclick = () => showScreen('screen-menu');
    $('btn-chapter-back').onclick = () => { renderMap(); showScreen('screen-map'); };
    $('btn-goto-wrong').onclick = openWrong;
    $('btn-wrong-back').onclick = () => showScreen('screen-menu');
    $('btn-wrong-practice').onclick = startPractice;
    $('btn-goto-rank').onclick = openRank;
    $('btn-rank-back').onclick = () => showScreen('screen-menu');
    $('btn-goto-memory').onclick = renderMemory;
    $('btn-memory-back').onclick = () => showScreen('screen-menu');
    $('btn-memory-quiz').onclick = startMemoryQuiz;
    $('btn-goto-exam').onclick = () => { showScreen('screen-exam'); EXM.studentRender(); };
    $('btn-exam-back').onclick = () => showScreen('screen-menu');
    $('btn-goto-teacher').onclick = openTeacher;
    $('btn-teacher-back').onclick = () => showScreen('screen-menu');

    document.querySelectorAll('.teacher-tabs .tab-btn').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.teacher-tabs .tab-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.querySelectorAll('.tabs-body .tab-body').forEach(x => x.style.display = 'none');
        $('tab-' + b.dataset.tab).style.display = 'block';
        if (b.dataset.tab === 'students') loadStudents();
        if (b.dataset.tab === 'questions') loadQuestions();
        if (b.dataset.tab === 'analysis') loadAnalysis();
        if (b.dataset.tab === 'logs') loadLogs();
        if (b.dataset.tab === 'paper') UIM.renderPaperTab();
        if (b.dataset.tab === 'exam') EXM.render();
      };
    });
    // 题库筛选
    $('q-filter-btn').onclick = loadQuestions;
    $('q-filter-kw').onkeydown = (e) => { if (e.key === 'Enter') loadQuestions(); };
    $('q-add-btn').onclick = () => questionForm(null);
    const qtb = $('q-template-btn'); if (qtb) qtb.onclick = () => UIM.qTemplateDownload();
    const qib = $('q-import-btn'); if (qib) qib.onclick = () => UIM.openImportModal();
    const qbb = $('q-batchdel-btn'); if (qbb) qbb.onclick = () => UIM.qBatchDeleteAct();
    // 成绩分析选学生
    $('ana-student-select').onchange = (e) => {
      const v = e.target.value;
      S.anaStu = v;
      S.anaStuName = v ? (e.target.selectedOptions[0] || {}).textContent || '' : '';
      if (v) {
        // 选中学生：下方查找框同步填入姓名并联动筛选
        const fi = document.querySelector('#tab-analysis .tool-input');
        if (fi) { fi.value = S.anaStuName; fi.dispatchEvent(new Event('input', { bubbles: true })); }
        else { PG.analysis.kw = S.anaStuName; loadAnalysis(); }
      } else {
        // 取消选择 → 清空查找框，显示所有成员
        const fi = document.querySelector('#tab-analysis .tool-input');
        if (fi) fi.value = '';
        PG.analysis.kw = '';
        loadAnalysis();
      }
    };
    $('ana-chapter-btn').onclick = () => loadChapterAnalysis(parseInt($('ana-chapter-select').value, 10));
    const bus = $('btn-unit-set');
    if (bus) bus.onclick = () => UIM.openUnitModal();
    const bts = $('btn-time-set');
    if (bts) bts.onclick = () => UIM.openTimeModal();
    const bas = $('btn-acct-set');
    if (bas) bas.onclick = () => UIM.openAcctModal();
  }

  async function init() {
    bind();
    // 预载章节配置
    try {
      const meta = await API.meta();
      S.chapters = meta.chapters; S.levels = meta.levels; S.unit = meta.unit || '';
      S.settings = meta.settings || {};
      S.version = meta.version || '';
      window.GAME_SETTINGS = S.settings;
      const av = $('app-version');
      if (av && meta.version) av.textContent = meta.version;
      if (meta.unit) {
        S.gameName = meta.gameName || '电闯关·电工大作战';
        document.title = (meta.unit ? meta.unit + ' · ' : '') + S.gameName;
        const gt = document.querySelector('.game-title');
        if (gt) gt.textContent = S.gameName;
        const ut = $('unit-title');
        if (ut) ut.textContent = meta.unit;
        const ul = $('unit-login');
        if (ul) ul.textContent = meta.unit;
      }
      document.querySelectorAll('.copyright-line').forEach(el => { el.textContent = '河北省滦州市职业技术教育中心 空城流水老师利用豆包AI制做'; });
      const chSel = $('q-filter-chapter');
      chSel.innerHTML = '<option value="">全部章节</option>' + meta.chapters.map(c => '<option value="' + c.id + '">第' + (c.id === 0 ? '0' : c.id) + '章 ' + c.name + '</option>').join('');
      const stuSel = $('ana-student-select');
      stuSel.innerHTML = '<option value="">— 选择学生查看个人分析 —</option>';
    } catch (e) { console.error(e); }
    // 尝试自动登录
    if (API.token) {
      try {
        S.me = (await API.me()).user;
        if (S.me.role === 'teacher') document.querySelectorAll('.teacher-only').forEach(el => el.style.display = '');
        showScreen('screen-menu');
        renderMenu();
        return;
      } catch (e) { API.clearToken(); }
    }
    showScreen('screen-login');
  }

  /* 连线题通用构建（game.js 关卡 / 错题重练共用） */
  function buildMatchUI(container, q, onSubmit) {
    const opts = q.options || { left: [], right: [] };
    const left = opts.left.slice(), right = opts.right.slice();
    for (let i = right.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [right[i], right[j]] = [right[j], right[i]]; }
    const pairs = [];
    let selL = -1;
    const COLOR = ['#3bff8f', '#2fd6ff', '#ff9f1a', '#b07bff', '#ff5a5a', '#ffd93b', '#ff7edb', '#7ee787'];
    container.innerHTML = '<div class="match-box"><div class="m-col" id="mc-left"></div><div class="m-mid">⇄</div><div class="m-col" id="mc-right"></div></div>' +
      '<button class="ab-btn" id="match-ok" style="margin-top:8px;background:linear-gradient(135deg,var(--accent2),#ff9f1a);color:#3a2600;font-weight:700">✓ 确认连线</button>';
    const colL = container.querySelector('#mc-left'), colR = container.querySelector('#mc-right');
    const paint = () => {
      [...colL.children].forEach((el, i) => { el.className = 'match-item' + (selL === i ? ' sel' : '') + (pairs[i] !== undefined ? ' paired' : ''); el.style.borderColor = pairs[i] !== undefined ? COLOR[pairs[i] % COLOR.length] : ''; el.textContent = left[i]; });
      [...colR.children].forEach((el, j) => {
        const matched = left.map((_, i) => pairs[i] === right[j] ? i : -1).filter(x => x >= 0)[0];
        el.className = 'match-item' + (matched >= 0 ? ' paired' : '');
        el.style.borderColor = matched >= 0 ? COLOR[matched % COLOR.length] : '';
        el.textContent = right[j];
      });
    };
    left.forEach((txt, i) => {
      const b = document.createElement('button');
      b.className = 'match-item'; b.textContent = txt;
      b.onclick = () => { selL = (selL === i ? -1 : i); paint(); };
      colL.appendChild(b);
    });
    right.forEach((txt, j) => {
      const b = document.createElement('button');
      b.className = 'match-item'; b.textContent = txt;
      b.onclick = () => {
        if (selL < 0) return;
        pairs[selL] = opts.right.indexOf(txt);
        selL = -1; paint();
      };
      colR.appendChild(b);
    });
    container.querySelector('#match-ok').onclick = () => {
      if (pairs.some(p => p === undefined)) { toastMsg && toastMsg('请完成全部连线'); return; }
      // 1.0.0.4：答案不下发，把配对交给调用方提交服务端判分
      onSubmit(pairs.map((r, l) => [l, r]));
    };
    paint();
  }

  const UIM = {
    showScreen, renderMenu, renderMap, renderChapter, onLevelResult, toast, buildMatchUI,
    /* 学生管理：查找/排序/等级筛选 */
    setStuKw(v) { PG.students.kw = v; PG.students.page = 1; loadStudents(); },
    setStuSort(v) { PG.students.sort = v; PG.students.page = 1; loadStudents(); },
    setStuGrade(v) { PG.students.grade = v; PG.students.page = 1; loadStudents(); },
    /* 题库管理：排序 */
    setQSort(v) { PG.questions.sort = v; PG.questions.page = 1; loadQuestions(); },
    /* 成绩分析：查找/排序/等次筛选 */
    setAnaKw(v) {
      PG.analysis.kw = v; PG.analysis.page = 1;
      // 查找框清空 → 取消学生个人模式，显示所有成员
      if (!v && S.anaStu) {
        const sel = $('ana-student-select');
        if (sel) sel.value = '';
        S.anaStu = '';
        S.anaStuName = '';
      }
      loadAnalysis();
    },
    setAnaSort(v) { PG.analysis.sort = v; PG.analysis.page = 1; loadAnalysis(); },
    setAnaGrade(v) {
      const next = (PG.analysis.grade === v ? '' : v);
      PG.analysis.grade = next;
      PG.analysis.page = 1;
      if (!next) { // 取消筛选：清空查找框
        PG.analysis.kw = '';
        const inp = document.querySelector('#class-analysis .tool-input');
        if (inp) inp.value = '';
      }
      loadAnalysis();
    },
    /* 点击学生姓名 → 跳转到成绩分析并查看其个人分析 */
    viewStudent(id, name) {
      if (!id && S.users && S.users.length) {
        const u = S.users.find(x => x.name === name);
        if (u) id = u.id;
      }
      const b = [...document.querySelectorAll('.teacher-tabs .tab-btn')].find(t => t.dataset.tab === 'analysis');
      if (b) b.click();
      setTimeout(() => {
        const sel = $('ana-student-select');
        if (sel) {
          const opt = [...sel.options].find(o => o.value === id);
          if (opt) {
            sel.value = id;
            S.anaStu = id;
            S.anaStuName = opt.textContent;
            PG.analysis.kw = opt.textContent;
            loadAnalysis();
          }
        }
        const sc = $('tab-analysis');
        if (sc) sc.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    },
    gotoStudents(page) { PG.students.page = page; loadStudents(); },
    gotoQuestions(page) { PG.questions.page = page; loadQuestions(); },
    gotoAnalysis(page) { PG.analysis.page = page; loadAnalysis(); },
    gotoLogs(page) { PG.logs.page = page; loadLogs(); },
    pgSize(onChange, val) {
      const cfg = onChange.indexOf('Students') >= 0 ? PG.students : onChange.indexOf('Questions') >= 0 ? PG.questions : onChange.indexOf('Analysis') >= 0 ? PG.analysis : PG.logs;
      if (val === 'custom') {
        const n = prompt('请输入每页显示条数（1~500）', cfg.size);
        const num = parseInt(n, 10);
        if (num && num >= 1 && num <= 500) { cfg.size = num; cfg.page = 1; }
      } else { cfg.size = parseInt(val, 10); cfg.page = 1; }
      if (onChange.indexOf('Students') >= 0) loadStudents();
      else if (onChange.indexOf('Questions') >= 0) loadQuestions();
      else if (onChange.indexOf('Analysis') >= 0) loadAnalysis();
      else loadLogs();
    },
    openAcctModal() {
      const me = S.me || {};
      openModal('<h3 style="margin-bottom:12px">👤 教师账号设置</h3>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">当前密码</label><input id="ac-cur" type="password" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">新用户名</label><input id="ac-name" type="text" value="' + esc(me.name || '') + '" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">新密码（留空则不修改）</label><input id="ac-pass" type="password" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="msg" id="ac-msg"></div>' +
        '<div class="result-btns"><button class="btn ghost" onclick="UIM.closeModal()">取消</button><button class="btn primary" id="ac-save">保存</button></div>');
      $('ac-save').onclick = async () => {
        const cur = $('ac-cur').value;
        const name = $('ac-name').value.trim();
        const pass = $('ac-pass').value;
        if (!cur) { $('ac-msg').textContent = '请输入当前密码'; return; }
        if (!name) { $('ac-msg').textContent = '新用户名不能为空'; return; }
        if (pass && pass.length < 4) { $('ac-msg').textContent = '新密码至少4位'; return; }
        try {
          const r = await API.setTeacher({ curPass: cur, newName: name, newPass: pass });
          if (S.me) S.me.name = r.name || name;
          closeModal();
          toast('账号已更新，下次登录请使用新用户名/新密码');
        } catch (e) { $('ac-msg').textContent = e.message; }
      };
    },
    openTimeModal() {
      const st = S.settings || {};
      const lq = (typeof st.levelQ === 'string' ? (function(){ try { return JSON.parse(st.levelQ) || {}; } catch(e){ return {}; } })() : (st.levelQ || {}));
      const ltb = (typeof st.levelTimeBase === 'string' ? (function(){ try { return JSON.parse(st.levelTimeBase) || {}; } catch(e){ return {}; } })() : (st.levelTimeBase || {}));
      const lvNames = { 1: '入门测试', 2: '技能进阶', 3: '实战演练', boss: '章节霸主' };
      const lvKeys = ['1', '2', '3', 'boss'];
      openModal('<h3 style="margin-bottom:12px">⏱️ 闯关时间与题目数量设置</h3>' +
        '<div style="font-size:12px;color:var(--dim);margin-bottom:10px">设置每关题目数量后，系统按（朗读时间 + 答题时间）自动计算每关每题时长；朗读按 4 字/秒估算题面字数。</div>' +
        lvKeys.map(k => '<div class="form-row"><label style="font-size:12px;color:var(--dim)">' + lvNames[k] + ' · 题目数量（1~30）</label><input id="lq-' + k + '" type="number" min="1" max="30" value="' + (lq[k] != null ? lq[k] : (k === '1' ? 6 : k === '2' ? 8 : k === '3' ? 10 : 5)) + '" style="width:calc(50% - 8px);padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"><span style="margin-left:8px;font-size:12px;color:var(--accent2)" id="lqt-' + k + '">自动计时: ' + (ltb[k] != null ? ltb[k] : 0) + '秒/题</span></div>').join('') +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">普通题加时（秒，在自动计时基础上增加）</label><input id="tm-add" type="number" min="0" max="60" value="' + (st.timeAdd != null ? st.timeAdd : 5) + '" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">连线题额外加时（秒，在普通题基础上再增加）</label><input id="tm-match" type="number" min="0" max="60" value="' + (st.timeMatchAdd != null ? st.timeMatchAdd : 10) + '" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="msg" id="tm-msg"></div>' +
        '<div class="result-btns"><button class="btn ghost" onclick="UIM.closeModal()">取消</button><button class="btn primary" id="tm-save">保存并自动计时</button></div>');
      // 输入题数实时请求自动计时预览
      lvKeys.forEach(k => {
        const inp = $('lq-' + k);
        if (!inp) return;
        inp.onchange = async () => {
          const lq2 = {};
          lvKeys.forEach(k2 => { lq2[k2] = parseInt($('lq-' + k2).value, 10) || 0; });
          try {
            const r = await API.levelAutoTime(lq2);
            if (r && r.levelTimeBase) lvKeys.forEach(k2 => { const el = $('lqt-' + k2); if (el) el.textContent = '自动计时: ' + r.levelTimeBase[k2] + '秒/题'; });
          } catch (e) { /* 忽略预览失败 */ }
        };
      });
      $('tm-save').onclick = async () => {
        const ta = parseInt($('tm-add').value, 10);
        const tm = parseInt($('tm-match').value, 10);
        if (isNaN(ta) || ta < 0 || ta > 60) { $('tm-msg').textContent = '普通题加时范围 0~60 秒'; return; }
        if (isNaN(tm) || tm < 0 || tm > 60) { $('tm-msg').textContent = '连线题加时范围 0~60 秒'; return; }
        const lq2 = {};
        lvKeys.forEach(k => { const v = parseInt($('lq-' + k).value, 10); if (isNaN(v) || v < 1 || v > 30) { $('tm-msg').textContent = '每关题目数量范围 1~30'; throw null; } lq2[k] = v; });
        try {
          await API.setSettings({ timeAdd: ta, timeMatchAdd: tm, levelQ: lq2 });
          const st2 = (await API.settings()).settings;
          S.settings = st2;
          window.GAME_SETTINGS = st2;
          closeModal();
          toast('闯关时间与题目数量已更新（自动计时）');
        } catch (e) { if (e) $('tm-msg').textContent = e.message; }
      };
    },
    openUnitModal() {
      openModal('<h3 style="margin-bottom:12px">⚙️ 系统设置</h3>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">游戏名称（页面标题与首页显示，20字以内）</label><input id="um-game" type="text" value="' + esc(S.gameName || '电闯关·电工大作战') + '" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">使用单位（页面标题显示，40字以内）</label><input id="um-unit" type="text" value="' + esc(S.unit || '') + '" placeholder="输入使用单位名称" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="msg" id="um-msg"></div>' +
        '<div class="result-btns"><button class="btn ghost" onclick="UIM.closeModal()">取消</button><button class="btn primary" id="um-save">保存</button></div>');
      $('um-save').onclick = async () => {
        const unit = $('um-unit').value.trim();
        const gameName = $('um-game').value.trim();
        if (!unit) { $('um-msg').textContent = '单位名称不能为空'; return; }
        if (!gameName) { $('um-msg').textContent = '游戏名称不能为空'; return; }
        try {
          await API.setSettings({ unit, gameName });
          S.unit = unit; S.gameName = gameName;
          closeModal();
          toast('系统设置已保存，页面标题将同步显示');
          location.reload();
        } catch (e) { $('um-msg').textContent = e.message; }
      };
    },
    
    async toggleSec(ch, sec, cardEl) {
      const parent = cardEl.parentNode;
      const exist = parent.querySelector('.sec-detail');
      if (exist) { exist.remove(); return; }
      await loadSectionAnalysis(ch, sec, cardEl);
    },
    async toggleMastery(uid, ch, cell) {
      // 个人模式：点击单元格 → 该生该章章节掌握明细收缩/展开
      if (S.anaStu) {
        if (uid !== S.anaStu) return; // 仅选中学生的单元格联动其章节明细
        const d = [...document.querySelectorAll('#ana-mastery details.m-fold')].find(x => x.dataset.ch === String(ch));
        if (d) { d.toggleAttribute('open'); return; }
      }
      // 全班模式：同个人模式结构的可收缩掌握明细（缓存数据，无需请求）
      const u = (S.masteryList || []).find(x => x.id === uid);
      const c = u && u.chapters.find(x => x.chapter === ch);
      if (!u || !c || !c.answered) return;
      let zone = document.getElementById('mastery-detail-zone');
      if (!zone) {
        zone = document.createElement('div');
        zone.id = 'mastery-detail-zone';
        const box = document.getElementById('ana-mastery');
        if (box) box.appendChild(zone);
      }
      const key = uid + '_' + ch;
      const cur = zone.firstElementChild;
      if (cur && zone.dataset.key === key) { cur.toggleAttribute('open'); return; }
      const secHtml = c.sections.map(s =>
        '<div style="margin:6px 0 0 14px"><b>' + esc(s.name) + '</b>：答对 ' + s.correct + '/' + s.answered + '（' + (s.answered ? Math.round(s.correct / s.answered * 100) : 0) + '%）</div>' +
        s.questions.map(q => {
          const mark = q.answered ? (q.ok === q.answered ? '✅' : (q.ok > 0 ? '⚠️ 部分' : '❌')) : '—';
          return '<div style="margin:2px 0 2px 26px;font-size:12px">' + mark + ' #' + q.id + ' ' + esc(q.question) + '（答对 ' + q.ok + '/' + q.answered + '）</div>';
        }).join('')
      ).join('');
      zone.innerHTML = '<details class="m-fold" open data-ch="' + ch + '"><summary>第' + (ch === 0 ? '0' : ch) + '章 ' + esc(c.name) + '：' + c.acc + '%（答对 ' + c.correct + '/' + c.answered + '）</summary>' + secHtml + '</details>';
      zone.dataset.key = key;
    },
    openModal, closeModal, questionForm, saveQuestion,
    scoreModal(id, name) {
      openModal('<h3 style="margin-bottom:12px">为「' + esc(name) + '」加减分</h3>' +
        '<div class="form-row"><input id="sm-delta" type="number" placeholder="积分变化，加分填正数，减分填负数，如 100 或 -50"></div>' +
        '<div class="form-row"><input id="sm-reason" type="text" placeholder="原因（可选）"></div>' +
        '<div class="msg" id="sm-msg"></div>' +
        '<div class="result-btns"><button class="btn ghost" onclick="UIM.closeModal()">取消</button><button class="btn primary" id="sm-save">确定</button></div>');
      $('sm-save').onclick = async () => {
        const delta = parseInt($('sm-delta').value, 10);
        if (!delta) { $('sm-msg').textContent = '请输入有效的积分变化'; return; }
        try { await API.addScore(id, delta, $('sm-reason').value.trim()); closeModal(); toast('已更新积分'); loadStudents(); }
        catch (e) { $('sm-msg').textContent = e.message; }
      };
    },
    resetModal(id, name) {
      openModal('<h3 style="margin-bottom:12px">重置「' + esc(name) + '」的密码</h3>' +
        '<div class="form-row"><input id="rm-pass" type="text" value="123456" placeholder="新密码"></div>' +
        '<div class="msg" id="rm-msg"></div>' +
        '<div class="result-btns"><button class="btn ghost" onclick="UIM.closeModal()">取消</button><button class="btn primary" id="rm-save">确定重置</button></div>');
      $('rm-save').onclick = async () => {
        try { await API.resetPassword(id, $('rm-pass').value || '123456'); closeModal(); toast('密码已重置'); }
        catch (e) { $('rm-msg').textContent = e.message; }
      };
    },
    async deleteUser(id, name) {
      if (!confirm('确定删除学生「' + name + '」？其进度和成绩将一并删除，且无法恢复！')) return;
      try { await API.deleteUser(id); toast('已删除'); loadStudents(); }
      catch (e) { toast(e.message); }
    },
    editQ(id) {
      API.qList({}).then(r => {
        const q = r.list.find(x => x.id === id);
        if (q) questionForm(q);
      });
    },
    async delQ(id) {
      if (!confirm('确定删除题目 #' + id + '？')) return;
      try { await API.qDelete(id); toast('已删除'); loadQuestions(); }
      catch (e) { toast(e.message); }
    },
    /* ---- 1.0.0.5 题库管理扩展 ---- */
    diffStar(d) {
      const n = parseInt(d, 10) || 3;
      return '<span title="难度 ' + n + ' 星" style="color:' + (n >= 4 ? '#ff5a5a' : n >= 3 ? '#ff9f1a' : '#3bff8f') + '">' + '★'.repeat(n) + '☆'.repeat(5 - n) + '</span>';
    },
    qSelAll(ck) {
      document.querySelectorAll('#question-list input[data-qid]').forEach(c => { c.checked = ck.checked; if (ck.checked) S.qSel[parseInt(c.dataset.qid, 10)] = true; else delete S.qSel[parseInt(c.dataset.qid, 10)]; });
    },
    qSelOne(id, ck) { if (ck.checked) S.qSel[id] = true; else delete S.qSel[id]; },
    async qTemplateDownload() {
      try {
        const blob = await API.download('/api/questions/template', 'GET', null);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = '题库导入模板.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        toast('模板已导出，可用 WPS/Excel 编辑后导入');
      } catch (e) { toast(e.message); }
    },
    openImportModal() {
      openModal('<h3 style="margin-bottom:12px">📤 导入试题</h3>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">格式</label><select id="imp-format" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.8);color:var(--text)"><option value="csv">CSV（推荐，与导出的模板一致）</option><option value="json">JSON</option></select></div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">粘贴试题内容（查重：与题库完全相同的题干会保留原题、跳过导入）</label><textarea id="imp-content" rows="10" placeholder="可先在 WPS/Excel 里按模板编辑后复制到此处…" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></textarea></div>' +
        '<div class="msg" id="imp-msg"></div>' +
        '<div class="result-btns"><button class="btn ghost" onclick="UIM.closeModal()">取消</button><button class="btn primary" id="imp-save">开始导入</button></div>');
      $('imp-save').onclick = async () => {
        const content = $('imp-content').value;
        if (!content.trim()) { $('imp-msg').textContent = '请粘贴导入内容'; return; }
        try {
          const r = await API.qImport($('imp-format').value, content);
          $('imp-msg').innerHTML = '<b style="color:var(--ok)">导入完成：新增 ' + r.added + ' 道</b>，重复跳过 ' + r.exists + ' 道，无效 ' + r.failed + ' 道' + (r.problems && r.problems.length ? '<br><span style="color:var(--danger)">' + esc(r.problems.join('<br>')) + '</span>' : '');
          loadQuestions();
        } catch (e) { $('imp-msg').textContent = e.message; }
      };
    },
    async qBatchDeleteAct() {
      const ids = Object.keys(S.qSel).map(Number);
      if (!ids.length) { toast('请先勾选要删除的题目'); return; }
      if (!confirm('确定批量删除选中的 ' + ids.length + ' 道题目？删除后不可恢复！')) return;
      try {
        const r = await API.qBatchDelete(ids);
        S.qSel = {};
        toast('已删除 ' + r.removed + ' 道题目');
        loadQuestions();
      } catch (e) { toast(e.message); }
    },
    /* ---- 1.0.0.5 组卷打印 ---- */
    renderPaperTab() {
      const box = $('paper-box');
      if (!box) return;
      const P = S.paper;
      const chChips = S.chapters.map(c => '<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0;font-size:13px"><input type="checkbox" class="p-ch" value="' + c.id + '"' + (P.chapters.includes(c.id) ? ' checked' : '') + '> 第' + (c.id === 0 ? '0' : c.id) + '章 ' + esc(c.name) + '</label>').join('');
      const diffChips = [1, 2, 3, 4, 5].map(n => '<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0;font-size:13px"><input type="checkbox" class="p-diff" value="' + n + '"' + (P.diffs.includes(n) ? ' checked' : '') + '> ' + n + ' 星</label>').join('');
      const typeChips = [['single', '单选'], ['judge', '判断'], ['multi', '多选'], ['fill', '填空'], ['matching', '连线'], ['calc', '计算']].map(t => '<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0;font-size:13px"><input type="checkbox" class="p-type" value="' + t[0] + '"' + (P.types.includes(t[0]) ? ' checked' : '') + '> ' + t[1] + '</label>').join('');
      box.innerHTML = '<h3 style="margin-bottom:10px">📄 自动组卷（按章节/难度/题型/掌握情况，可导出 Word 打印）</h3>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">选择章节（不选 = 全部章节）</label><br>' + chChips + '</div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">难度等级（不选 = 全部难度）</label><br>' + diffChips + '</div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">题型（不选 = 全部题型）</label><br>' + typeChips + '</div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">按学生掌握情况筛选</label><select id="p-mastery" style="width:60%;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.8);color:var(--text)">' +
        '<option value="all"' + (P.mastery === 'all' ? ' selected' : '') + '>不筛选（全部题目）</option>' +
        '<option value="weak"' + (P.mastery === 'weak' ? ' selected' : '') + '>薄弱题（全班正确率 &lt;60%）</option>' +
        '<option value="good"' + (P.mastery === 'good' ? ' selected' : '') + '>掌握较好（全班正确率 ≥60%）</option></select></div>' +
        '<div class="form-row"><label style="font-size:12px;color:var(--dim)">出题数量（1~200）</label><input id="p-count" type="number" min="1" max="200" value="' + P.count + '" style="width:120px;padding:9px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>' +
        '<div class="form-row"><label style="display:inline-flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="p-ans"> 试卷含参考答案与解析（不打勾 = 纯试题卷，供学生作答）</label></div>' +
        '<div class="result-btns" style="margin:10px 0"><button class="btn primary" id="p-build">🎯 生成试卷</button><button class="btn" id="p-export" disabled>📥 导出 Word/WPS 打印</button></div>' +
        '<div id="p-preview" style="font-size:13px;line-height:1.9"></div>';
      const collect = () => {
        P.chapters = [...document.querySelectorAll('.p-ch:checked')].map(x => parseInt(x.value, 10));
        P.diffs = [...document.querySelectorAll('.p-diff:checked')].map(x => parseInt(x.value, 10));
        P.types = [...document.querySelectorAll('.p-type:checked')].map(x => x.value);
        P.mastery = $('p-mastery').value;
        P.count = parseInt($('p-count').value, 10) || 20;
        P.includeAnswer = $('p-ans').checked;
      };
      $('p-build').onclick = async () => {
        collect();
        const pv = $('p-preview');
        pv.innerHTML = '<div class="empty-tip">组卷中…</div>';
        try {
          const r = await API.paperGenerate({ chapters: P.chapters, difficulties: P.diffs, types: P.types, mastery: P.mastery, count: P.count });
          S.paperTitle = r.title; S.paperGroups = r.groups; S.paperTotal = r.total;
          const ex = $('p-export'); if (ex) ex.disabled = false;
          pv.innerHTML = '<b style="color:var(--accent2)">' + esc(r.title) + '</b>　共 ' + r.total + ' 题<br>' +
            r.groups.map(g => '<div style="margin:6px 0"><b>' + esc(g.name) + '（' + g.questions.length + '题）</b><br>' +
              g.questions.map((q, i) => '&nbsp;&nbsp;' + (i + 1) + '. ' + esc(q.question) + '　<span style="color:#ff9f1a">' + UIM.diffStar(q.difficulty) + '</span>').join('<br>')).join('') +
            '<div style="margin-top:8px;color:var(--dim)">导出 Word 后可在 WPS/Word 中打开打印。</div>';
        } catch (e) { pv.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>'; }
      };
      $('p-export').onclick = async () => {
        collect();
        try {
          const blob = await API.download('/api/paper/export', 'POST', { chapters: P.chapters, difficulties: P.diffs, types: P.types, mastery: P.mastery, count: P.count, includeAnswer: P.includeAnswer });
          const a = document.createElement('a');
          const fname = (S.unit ? S.unit + '-' : '') + (S.paperTitle || '组卷') + (P.includeAnswer ? '-答案版' : '') + '.doc';
          a.href = URL.createObjectURL(blob); a.download = fname; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 3000);
          toast('试卷已导出，可用 Word/WPS 打开打印');
        } catch (e) { toast(e.message); }
      };
    }
  };
  window.UIM = UIM;

  document.addEventListener('DOMContentLoaded', init);
})();
