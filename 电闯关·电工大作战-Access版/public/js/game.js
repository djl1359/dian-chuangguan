/* ============================================================
 * 电闯关·电工大作战 — 动作闯关游戏引擎（Canvas）
 * 玩法：控制电工角色躲避故障怪，答对题目释放电击清怪/攻击BOSS
 * 电脑：A/D或←/→移动，W/Space/↑跳跃，1-4选答案，Enter确认，Esc退出
 * 手机：虚拟摇杆按钮移动/跳跃，可直接点答案按钮或画面上的答案台
 * ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const VW = 960, VH = 540, GROUND = 470;
  let canvas, ctx, cw = 0, ch = 0, dpr = 1;
  let state = null, rafId = 0, lastT = 0;
  const KEYS = {};
  /* roundRect 兼容（旧浏览器） */
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
      return this;
    };
  }
  const ENEMY_TYPES = [
    { name: '短路怪', color: '#ff5a5a', speed: 46, r: 26 },
    { name: '断路怪', color: '#b07bff', speed: 60, r: 24 },
    { name: '过载怪', color: '#ff9f1a', speed: 72, r: 22 },
    { name: '漏电怪', color: '#3bff8f', speed: 88, r: 20 }
  ];
  const BOSS_COLORS = ['#ff5a5a', '#ff9f1a', '#b07bff', '#ffd93b', '#3bff8f', '#2fd6ff', '#ff6bd6', '#9bff5a'];

  /* ---------- 画布与尺寸 ---------- */
  function resize() {
    const wrap = $('game-canvas');
    dpr = window.devicePixelRatio || 1;
    const rect = wrap.parentElement.getBoundingClientRect();
    cw = rect.width;
    const vh = window.innerHeight;
    const chLimit = Math.max(280, vh - 360);
    ch = clamp(Math.min(cw * VH / VW, chLimit), 260, vh * 0.78);
    wrap.width = Math.floor(cw * dpr);
    wrap.height = Math.floor(ch * dpr);
    wrap.style.height = ch + 'px';
    ctx = wrap.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* 显示尺寸自适应：根据视口宽度调整题目/选项/人物静音按钮字号 */
    const w = window.innerWidth;
    const root = document.documentElement;
    root.style.setProperty('--qfs', w < 380 ? '13.5px' : (w < 600 ? '15px' : '17px'));
    root.style.setProperty('--bfs', w < 380 ? '11.5px' : (w < 600 ? '13px' : '14.5px'));
    root.style.setProperty('--pfs', w < 380 ? '20px' : (w < 600 ? '24px' : '30px'));
  }
  function vx(x) { return x * cw / VW; }
  function vy(y) { return y * ch / VH; }
  function sx(s) { return s * cw / VW; }

  /* ---------- 静音开关：顶部 HUD 与答题区人物按钮双向联动 ---------- */
  function syncVoiceBtns() {
    const icon = window.__voiceMuted ? '🔇' : '🔊';
    const a = $('btn-voice');
    if (a) a.textContent = icon;
    const c = $('btn-voice3');
    if (c) { const v = c.querySelector('.mp-vol'); if (v) v.textContent = icon; }
  }
  function toggleVoice() {
    window.__voiceMuted = !window.__voiceMuted;
    syncVoiceBtns();
    if (window.__voiceMuted) {
      /* 打开静音：立即停止当前朗读 */
      if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
      if (state) state.reading = false;
    } else {
      /* 关闭静音：恢复前音量，重新朗读当前题 */
      if (state && state.phase === 'play' && !state.graded && !state.over && state.questions) {
        const q = curQ();
        if (q && window.speechSynthesis) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
          state.reading = false;
          speakQuestion(q);
        }
      }
    }
  }

  /* ---------- 小工具 ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 关卡启动 ---------- */
  function start(chapter, level, questions, cfg, pt) {
    window._curLevelId = level.id;
    $('screen-game').style.display = 'block';
    resize();
    window.addEventListener('resize', resize);
    const vbtn = $('btn-voice');
    if (vbtn) { vbtn.textContent = window.__voiceMuted ? '🔇' : '🔊'; vbtn.onclick = toggleVoice; }
    syncVoiceBtns();
    state = {
      chapter, level, questions, cfg, pt: pt || '',
      qi: 0,                 // 当前题序号
      hearts: 3, maxHearts: 3,
      score: 0, apiGain: 0,
      combo: 0, maxCombo: 0,
      correctN: 0,
      time: cfg.time,        // 当前题剩余秒
      reading: false,        // 语音读题中（倒计时暂停）
      phase: level.id === 'boss' ? 'ready' : 'play',   // ready(BOSS准备) | play | over
      over: false,
      isBoss: level.id === 'boss',
      player: {
        x: VW / 2, y: GROUND, vx: 0, vy: 0, dir: 1,
        onGround: true, invuln: 0, stun: 0, walkT: 0
      },
      enemies: [],
      bolts: [],
      particles: [],
      popups: [],
      spawnT: 0,
      boss: null,
      bossShootT: 0,
      shockFx: 0, shockFrom: 0,
      selected: new Set(),   // 多选已选下标
      graded: false,
      fillWrong: false,
      shake: 0
    };
    state.selected = new Set();
    applyTouchLayout();
    buildAnswerUI();
    showQuestion();
    if (state.isBoss) showBossReady();
    lastT = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- 题目与作答 UI ---------- */
  function curQ() { return state.questions[state.qi]; }
  const LETTERS = ['A', 'B', 'C', 'D'];

  function buildAnswerUI() {
    const q = curQ();
    const box = $('answer-buttons');
    box.innerHTML = '';
    $('fill-box').style.display = 'none';
    if (!q) return;
    if (q.type === 'fill' || q.type === 'calc') {
      $('fill-box').style.display = 'flex';
      $('fill-input').value = '';
      $('fill-input').focus();
      return;
    }
    if (q.type === 'matching') {
      window.UIM.buildMatchUI(box, q, (userPairs) => {
        if (!state || state.phase !== 'play' || state.over || state.graded) return;
        if (state.isBoss && state.reading) { readBlockTip(); return; }
        state.graded = true;
        submitAnswer(userPairs);
      });
      return;
    }
    q.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'ab-btn';
      b.innerHTML = '<b>' + LETTERS[i] + '</b> ' + escOpt(o);
      b.dataset.idx = i;
      b.onclick = () => pick(i);
      box.appendChild(b);
    });
    if (q.type === 'multi') {
      const ok = document.createElement('button');
      ok.className = 'ab-btn';
      ok.id = 'multi-ok';
      ok.style.background = 'linear-gradient(135deg,var(--accent2),#ff9f1a)';
      ok.style.color = '#3a2600';
      ok.style.fontWeight = '700';
      ok.textContent = '✓ 确认作答';
      ok.onclick = () => confirmMulti();
      box.appendChild(ok);
    }
    /* 答题选项区中间：人物静音开关（与顶部 HUD 双向联动） */
    const midBtn = document.createElement('button');
    midBtn.className = 'mute-person';
    midBtn.id = 'btn-voice3';
    midBtn.title = '语音开关';
    midBtn.innerHTML = '<span class="mp-face">🧑‍🔧</span><span class="mp-vol">' + (window.__voiceMuted ? '🔇' : '🔊') + '</span>';
    midBtn.onclick = (e) => { e.stopPropagation(); toggleVoice(); };
    const midIdx = Math.floor(box.children.length / 2);
    box.insertBefore(midBtn, box.children[midIdx]);
  }
  function escOpt(o) {
    let s = String(o).replace(/^[A-D][.．、]\s*/, '');
    return s.length > 14 ? s.slice(0, 14) + '…' : s;
  }
  function pick(i) {
    if (!state || state.phase !== 'play' || state.graded) return;
    const q = curQ();
    if (!q) return;
    if (q.type === 'multi') {
      if (state.selected.has(i)) state.selected.delete(i);
      else state.selected.add(i);
      document.querySelectorAll('#answer-buttons .ab-btn').forEach(b => {
        b.classList.toggle('active', state.selected.has(parseInt(b.dataset.idx, 10)));
      });
      return;
    }
    grade(i);
  }
  function confirmMulti() {
    if (state.selected.size === 0) { toastMsg('请先选择选项'); return; }
    grade([...state.selected]);
  }

  function showQuestion() {
    const q = curQ();
    const cfg = state.cfg;
    // 连线题额外加时（教师可设置）
    state.time = cfg.time + (q.type === 'matching' ? (parseInt((window.GAME_SETTINGS || {}).timeMatchAdd, 10) || 0) : 0);
    state.graded = false;
    state.selected = new Set();
    state.fillWrong = false;
    $('q-type').textContent = TYPE_NAME[q.type];
    $('q-no').textContent = '第 ' + (state.qi + 1) + ' / ' + cfg.q + ' 题';
    $('q-combo').textContent = state.combo >= 2 ? '连击 ×' + state.combo : '';
    const qImg = q.image ? '<div style="text-align:' + (q.imageAlign || 'center') + '"><img src="' + q.image + '" class="q-quest-img" style="width:' + (q.imgSize || 60) + '%" alt="题干图片"></div>' : '';
    $('q-text').innerHTML = esc(q.question) + qImg;
    const hint = state.isBoss
      ? '答对电击BOSS（BOSS -1 血），答错 BOSS 回血！'
      : '答对电击消灭故障怪，答错或超时损失一颗心！';
    $('q-hint').textContent = q.type === 'multi' ? hint + '（多选：点选项勾选后点“确认作答”）' : (q.type === 'fill' || q.type === 'calc' ? hint + '（计算/填空题：在输入框填写答案）' : (q.type === 'matching' ? hint + '（连线：先点左侧一项，再点右侧对应项配对）' : hint));
    buildAnswerUI();
    // 每题的敌人刷新
    state.enemies = [];
    if (!state.isBoss) {
      const n = state.level.id === 1 ? 2 : (state.level.id === 2 ? 3 : 4);
      spawnWave(n);
    }
    state.spawnT = 1.2;
    // 换题：清空弹幕与特效（人物保持原位，读题暂停动画，不重置位置）
    state.bolts = [];
    state.particles = [];
    state.popups = [];
    state.shockFx = 0;
    state.shake = 0;
    if (state.phase === 'play') speakQuestion(q);
  }
  /* 语音读题：朗读题干与选项，读题期间倒计时暂停 */
  function speakQuestion(q) {
    if (window.__voiceMuted) return;
    const ss = window.speechSynthesis;
    if (!ss) return;
    try { ss.cancel(); } catch (e) {}
    let text = String(q.question).replace(/<[^>]*>/g, '');
    if (q.type === 'single' || q.type === 'judge' || q.type === 'multi') {
      (q.options || []).forEach((o, i) => {
        text += '。' + LETTERS[i] + '，' + String(o).replace(/<[^>]*>/g, '').replace(/^[A-D][.．、]\s*/, '');
      });
    } else if (q.type === 'fill' || q.type === 'calc') {
      text += '。请在输入框中填写答案';
    } else if (q.type === 'matching') {
      text += '。请将左右两项连线配对';
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.95;
    u.volume = window.__voiceVol || 1;
    state.reading = true;
    const myToken = (state.speakToken = (state.speakToken || 0) + 1);
    u.onend = () => { if (state.speakToken === myToken) state.reading = false; };
    u.onerror = () => { if (state.speakToken === myToken) state.reading = false; };
    ss.speak(u);
  }
  function spawnWave(n) {
    const sp = speedMul();
    for (let i = 0; i < n; i++) {
      const t = ENEMY_TYPES[Math.floor(rnd(0, ENEMY_TYPES.length))];
      const fromLeft = Math.random() < 0.5;
      state.enemies.push({
        type: t, x: fromLeft ? -30 : VW + 30,
        y: GROUND - t.r, hp: 1, t: rnd(0, 6), sp: t.speed * sp
      });
    }
  }
  function speedMul() {
    const id = state.level.id;
    return id === 1 ? 0.42 : (id === 2 ? 0.62 : (state.isBoss ? 0.6 : 0.82));
  }

  /* ---------- 作答判定（1.0.0.4：提交 choice 由服务端判分） ---------- */
  /* 提交答案：choice = 选项下标/下标数组/填空文本/连线配对，null 表示超时或放弃 */
  function submitAnswer(choice) {
    const q = curQ();
    if (!q) { applyAnswer(false); return; }
    API.answer({
      pt: state.pt, qid: q.id, choice,
      combo: state.combo + 1, tLeft: Math.max(0, state.time)
    }).then(r => {
      applyAnswer(!!r.correct);
    }).catch(() => {
      // 网络异常等：按答错处理，保证游戏可继续
      applyAnswer(false);
    });
  }
  function grade(pick) {
    if (!state || state.phase !== 'play' || state.over || state.graded) return;
    if (state.isBoss && state.reading) { readBlockTip(); return; }
    const q = curQ();
    state.graded = true;
    if (q.type === 'matching') { submitAnswer(null); return; }
    submitAnswer(q.type === 'multi' ? (pick || []).slice() : pick);
  }
  function submitFill() {
    const q = curQ();
    if (!q || state.graded || state.over) return;
    if (state.isBoss && state.reading) { readBlockTip(); return; }
    state.graded = true;
    submitAnswer($('fill-input').value);
  }
  /* BOSS 战读题期间禁止答题：节流提示（每 1.5 秒最多提示一次） */
  function readBlockTip() {
    const now = Date.now();
    if (!state._readTipT || now - state._readTipT > 1500) {
      state._readTipT = now;
      toastMsg('⏳ 正在读题，请听完后再作答');
    }
  }
  function applyAnswer(correct) {
    const q = curQ();
    const tLeft = Math.max(0, state.time);
    let delta = 0, comboNow = 0;
    if (correct) {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      comboNow = state.combo;
      delta = 100 + 50 * (comboNow - 1) + Math.round(tLeft * 2);
      state.score += delta;
      state.apiGain += delta;
      state.correctN++;
      pop('+' + delta, state.player.x, state.player.y - 70, '#3bff8f');
      if (state.isBoss && state.boss) {
        state.boss.hp--;
        state.boss.hitFlash = 0.18;
        state.shockFx = 0.5;
        state.shake = 0.35;
        /* 战斗感强化：电光爆发 + 伤害飘字 + BOSS 被电击击退 */
        burstBossParticles(state.boss.x, state.boss.y - 40, '#ffd93b', 12);
        burstBossParticles(state.boss.x, state.boss.y - 40, '#2fd6ff', 8);
        pop('-1', state.boss.x, state.boss.y - 122, '#ff5a5a');
        const away = state.boss.x > state.player.x ? 1 : -1;
        state.boss.x = clamp(state.boss.x + away * 46, 90, VW - 90);
        if (state.boss.hp <= 0) {
          /* 击杀：爆炸粒子 + 大飘字 + 强震动；延迟结算让特效完整展示 */
          burstBossParticles(state.boss.x, state.boss.y - 40, '#ff9f1a', 28);
          burstBossParticles(state.boss.x, state.boss.y - 40, '#ff5a5a', 18);
          burstBossParticles(state.boss.x, state.boss.y - 40, '#ffd93b', 14);
          state.shake = 0.9;
          pop('⚡ BOSS 击败！', state.boss.x, state.boss.y - 160, '#ffd93b');
          state.bolts = [];
          state.player.invuln = Math.max(state.player.invuln, 1.2);
          if (!state._killT) {
            state._killT = 0.9;
            setTimeout(() => { if (state && !state.over) endLevel(true); }, 900);
          }
          return;
        }
      } else {
        state.shockFx = 0.5;
        killEnemies();
      }
    } else {
      state.combo = 0;
      delta = -30;
      state.score = Math.max(0, state.score + delta);
      state.apiGain += delta;
      loseHeart();
      pop('-30', state.player.x, state.player.y - 70, '#ff5a5a');
      // 答错：电浪震退故障怪，给玩家喘息
      state.enemies.forEach(e => { if (!e.dead) e.x += (e.x > state.player.x ? 1 : -1) * 150; });
      if (state.isBoss && state.boss) {
        state.boss.hp = Math.min(state.cfg.q, state.boss.hp + 1);
        /* 战斗感强化：回血飘字 + 绿色回复粒子 + 立即反击射击 */
        pop('BOSS 回血 +1', state.boss.x, state.boss.y - 122, '#3bff8f');
        burstBossParticles(state.boss.x, state.boss.y - 40, '#3bff8f', 10);
        state.bossShootT = Math.min(state.bossShootT, 0.15);
      }
    }
    // 上报已在 submitAnswer 中完成（服务端判分）
    if (!state.over && state.hearts > 0) setTimeout(nextQuestion, correct ? 900 : 1200);
    else if (!state.over && state.hearts <= 0) { /* 等 loseHeart 的 endLevel */ }
  }
  function killEnemies() {
    state.enemies.forEach(e => { e.dead = 1; });
    state.particles.push({
      x: state.player.x, y: state.player.y - 30, life: 0.6, max: 0.6,
      draw(c, p) { c.beginPath(); c.arc(p.x, p.y, 40 * (1 - p.life / p.max), 0, 7); c.strokeStyle = 'rgba(47,214,255,' + (p.life / p.max) + ')'; c.lineWidth = 4; c.stroke(); }
    });
  }
  function loseHeart() {
    state.hearts = Math.max(0, state.hearts - 1);
    state.player.invuln = 1.6;
    state.player.stun = 0.7;
    state.shake = 0.3;
    if (state.hearts <= 0) { setTimeout(() => endLevel(false), 800); }
  }
  function nextQuestion() {
    if (state.over) return;
    state.qi++;
    if (state.qi >= state.questions.length) {
      endLevel(state.hearts > 0);
      return;
    }
    showQuestion();
  }

  /* ---------- 结算 ---------- */
  function endLevel(pass) {
    if (state.over) return;
    state.over = true;
    /* 结算：停止播放读题语音 */
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    state.reading = false;
    cancelAnimationFrame(rafId);
    const acc = Math.round(state.correctN / state.questions.length * 100);
    let stars = 0;
    if (pass) {
      stars = (state.hearts === state.maxHearts && acc >= 90) ? 3 : (state.hearts >= 2 ? 2 : 1);
    }
    const res = {
      level: state.level, chapter: state.chapter,
      score: state.score, acc, maxCombo: state.maxCombo,
      heartsLeft: state.hearts, stars, pass,
      gain: Math.max(0, state.apiGain)
    };
    window.removeEventListener('resize', resize);
    setTimeout(() => UIM.onLevelResult(res), 300);
  }

  function abandon() {
    if (!state || state.over) return;
    if (confirm('确定退出当前关卡？进度不会保存。')) {
      state.over = true;
      /* 放弃关卡：停止播放读题语音 */
      if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
      state.reading = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      UIM.renderChapter(state.chapter);
    }
  }

  /* ---------- 主循环 ---------- */
  function loop(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000);
    lastT = t;
    update(dt);
    draw();
    if (!state || !state.over) rafId = requestAnimationFrame(loop);
  }
  function update(dt) {
    const s = state;
    if (!s || s.phase !== 'play' || s.over) return;
    /* 语音读题/读选项期间：暂停动画与倒计时，画面静止；读完后恢复播放 */
    if (s.reading) {
      $('hud-timer').textContent = Math.ceil(Math.max(0, s.time)) + 's';
      return;
    }
    s.time -= dt;
    $('hud-timer').textContent = Math.ceil(Math.max(0, s.time)) + 's';
    if (s.time <= 0 && !s.graded) {
      s.time = 0;
      state.graded = true;
      submitAnswer(null);   // 超时：服务端判为答错
    }
    /* 玩家 */
    const p = s.player;
    let move = 0;
    if (KEYS['ArrowLeft'] || KEYS['a'] || KEYS['A']) move -= 1;
    if (KEYS['ArrowRight'] || KEYS['d'] || KEYS['D']) move += 1;
    p.vx = move * 320;
    if (p.stun > 0) { p.stun -= dt; p.vx = 0; }
    p.x = clamp(p.x + p.vx * dt, 26, VW - 26);
    if (p.invuln > 0) p.invuln -= dt;
    if (!p.onGround) {
      p.vy += 2200 * dt;
      p.y += p.vy * dt;
      if (p.y >= GROUND) { p.y = GROUND; p.vy = 0; p.onGround = true; }
    }
    if (move !== 0) { p.dir = move > 0 ? 1 : -1; p.walkT += dt * 8; } else p.walkT = 0;
    /* 敌人 */
    s.enemies.forEach(e => {
      if (e.dead) return;
      e.t += dt;
      const dir = p.x > e.x ? 1 : -1;
      e.x += dir * e.sp * dt;
      if (Math.abs(e.x - p.x) < 40 && Math.abs(e.y - p.y) < 46 && p.invuln <= 0) {
        loseHeart();
      }
    });
    s.enemies = s.enemies.filter(e => {
      if (e.dead) { s.particles.push(zapParticle(e.x, e.y, e.type.color)); return false; }
      return e.x > -60 && e.x < VW + 60;
    });
    /* BOSS 射击 */
    if (s.isBoss && s.boss) {
      s.boss.t += dt;
      if (s.boss.hitFlash > 0) s.boss.hitFlash -= dt;
      s.bossShootT -= dt;
      if (s.bossShootT <= 0) {
        const angry = s.boss.hp <= Math.ceil(s.cfg.q / 2);
        s.bossShootT = angry ? rnd(0.9, 1.6) : rnd(1.3, 2.2);
        const nShot = angry ? 3 : 1;
        const baseAng = Math.atan2(p.y - (s.boss.y - 40), p.x - s.boss.x);
        for (let i = 0; i < nShot; i++) {
          const a = baseAng + (nShot === 3 ? (i - 1) * 0.22 : 0);
          s.bolts.push({ x: s.boss.x, y: s.boss.y - 60, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, r: 9, t: 0 });
        }
      }
      if (s.boss.hp >= 1) {
        // 随机生成巡逻小怪（BOSS战的干扰）
        if (s.enemies.length < 1 && Math.random() < 0.004) {
          const t = ENEMY_TYPES[Math.floor(rnd(0, ENEMY_TYPES.length))];
          s.enemies.push({ type: t, x: Math.random() < 0.5 ? -30 : VW + 30, y: GROUND - t.r, hp: 1, t: 0, sp: t.speed * speedMul() });
        }
      }
    }
    /* 电弹 */
    s.bolts.forEach(b => {
      b.x += b.vx * dt; b.y += b.vy * dt; b.t += dt;
      if (Math.abs(b.x - p.x) < 24 && Math.abs(b.y - p.y) < 40 && p.invuln <= 0) {
        b.dead = 1; loseHeart();
      }
    });
    s.bolts = s.bolts.filter(b => !b.dead && b.x > -40 && b.x < VW + 40 && b.y < VH + 40);
    /* 特效 */
    s.particles.forEach(pt => pt.life -= dt);
    s.particles = s.particles.filter(pt => pt.life > 0);
    s.popups.forEach(pu => pu.life -= dt);
    s.popups = s.popups.filter(pu => pu.life > 0);
    s.shockFx = Math.max(0, s.shockFx - dt);
    s.shake = Math.max(0, s.shake - dt);
  }
  function zapParticle(x, y, color) {
    return {
      x, y, life: 0.5, max: 0.5, color,
      draw(c, p) {
        c.beginPath(); c.arc(p.x, p.y, 34 * (1 - p.life / p.max), 0, 7);
        c.strokeStyle = color; c.lineWidth = 3; c.stroke();
      }
    };
  }
  function burstBossParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(60, 230);
      const life = rnd(0.3, 0.7);
      state.particles.push({
        x, y, life, max: life, color,
        draw(c, p) {
          c.save();
          c.globalAlpha = Math.max(0, p.life / p.max);
          c.fillStyle = color;
          c.beginPath();
          c.arc(p.x + Math.cos(a) * (1 - p.life / p.max) * sp * 0.38, p.y + Math.sin(a) * (1 - p.life / p.max) * sp * 0.38, 4 + 4 * (p.life / p.max), 0, 7);
          c.fill();
          c.restore();
        }
      });
    }
  }
  function pop(text, x, y, color) {
    state.popups.push({ text, x, y, life: 1.1, max: 1.1, color });
  }
  function toastMsg(m) {
    const t = $('toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1400);
  }

  /* ---------- 绘制 ---------- */
  function draw() {
    ctx.clearRect(0, 0, cw, ch);
    if (!state) return;
    ctx.save();
    if (state.shake > 0) {
      ctx.translate(rnd(-5, 5) * sx(1), rnd(-5, 5) * sx(1));
    }
    ctx.scale(cw / VW, ch / VH);
    drawBG();
    drawPedestals();
    state.enemies.forEach(e => { if (!e.dead) drawEnemy(e); });
    if (state.isBoss && state.boss) drawBoss();
    state.bolts.forEach(drawBolt);
    drawPlayer();
    state.particles.forEach(pt => pt.draw(ctx, pt));
    state.popups.forEach(drawPopup);
    if (state.shockFx > 0) drawShock();
    if (state.isBoss && state.boss) drawBossHp();
    drawTimerBar();
    ctx.restore();
    updateHud();
  }
  function drawBG() {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#101638');
    g.addColorStop(1, '#1b2b63');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    // 远处的电路线条
    ctx.strokeStyle = 'rgba(47,214,255,.10)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const y = 60 + i * 56;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x < VW; x += 60) ctx.lineTo(x + 30, y + (i % 2 ? 16 : -16));
      ctx.stroke();
    }
    // 地面
    ctx.fillStyle = '#0d1430';
    ctx.fillRect(0, GROUND, VW, VH - GROUND);
    ctx.fillStyle = 'rgba(47,214,255,.18)';
    ctx.fillRect(0, GROUND, VW, 4);
    for (let x = 0; x < VW; x += 48) {
      ctx.fillStyle = x % 96 ? 'rgba(255,255,255,.03)' : 'rgba(255,217,59,.12)';
      ctx.fillRect(x, GROUND + 4, 24, VH - GROUND - 4);
    }
    // 警戒灯
    for (let x = 40; x < VW; x += 90) {
      ctx.fillStyle = 'rgba(255,90,90,' + (0.4 + 0.3 * Math.sin(performance.now() / 300 + x)) + ')';
      ctx.beginPath(); ctx.arc(x, 26, 5, 0, 7); ctx.fill();
    }
  }
  function drawPedestals() {
    const q = curQ();
    if (!q || q.type === 'fill' || q.type === 'calc' || q.type === 'matching') return;  /* 1.4.4.2-fix: matching options 为对象，跳过柱台避免 forEach 崩溃 */
    const n = q.options.length;
    const w = Math.min(170, VW / (n + 1) - 20);
    q.options.forEach((o, i) => {
      const cx = (i + 1) * VW / (n + 1);
      const px = cx - w / 2, py = GROUND - 76, pw = w, ph = 76;
      const near = Math.abs(state.player.x - cx) < w / 2 + 30;
      const isSel = state.selected.has(i);
      ctx.fillStyle = near ? 'rgba(47,214,255,.25)' : 'rgba(255,255,255,.06)';
      ctx.strokeStyle = isSel ? '#ffd93b' : (near ? '#2fd6ff' : 'rgba(147,164,200,.45)');
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, 10);
      ctx.fill(); ctx.stroke();
      // 立柱
      ctx.fillStyle = 'rgba(120,160,255,.35)';
      ctx.fillRect(cx - 7, GROUND - 86, 14, 10);
      // 字母
      ctx.fillStyle = isSel ? '#ffd93b' : (near ? '#2fd6ff' : '#93a4c8');
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(LETTERS[i], cx, py + 34);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#c9d6f5';
      const label = String(o).replace(/^[A-D][.．、]\s*/, '');
      ctx.fillText(label.length > 10 ? label.slice(0, 10) + '…' : label, cx, py + 58);
    });
  }
  function drawPlayer() {
    const p = state.player;
    if (p.invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.dir < 0) ctx.scale(-1, 1);
    const bob = p.onGround ? Math.sin(p.walkT) * 2 : 0;
    // 身体
    ctx.fillStyle = '#ffd93b';
    ctx.fillRect(-12, -44 + bob, 24, 30);
    // 工作服
    ctx.fillStyle = '#2f6bff';
    ctx.fillRect(-12, -30 + bob, 24, 18);
    // 腰带
    ctx.fillStyle = '#ff9f1a';
    ctx.fillRect(-12, -26 + bob, 24, 4);
    // 头盔
    ctx.fillStyle = '#e8eef8';
    ctx.beginPath(); ctx.arc(0, -50 + bob, 13, Math.PI, 0); ctx.fill();
    ctx.fillRect(-13, -50 + bob, 26, 7);
    // 帽檐
    ctx.fillStyle = '#ffd93b';
    ctx.fillRect(-16, -44 + bob, 32, 5);
    // 眼睛
    ctx.fillStyle = '#122';
    ctx.fillRect(3, -50 + bob, 5, 4);
    // 腿
    ctx.strokeStyle = '#2a3a6e'; ctx.lineWidth = 7;
    const step = p.onGround ? Math.sin(p.walkT) * 6 : 0;
    ctx.beginPath(); ctx.moveTo(-6, -14 + bob); ctx.lineTo(-7, step - 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -14 + bob); ctx.lineTo(7, -step - 0); ctx.stroke();
    ctx.restore();
  }
  function drawEnemy(e) {
    const wob = Math.sin(e.t * 3) * 3;
    ctx.save();
    ctx.translate(e.x, e.y);
    const c = e.type.color;
    // 身体
    const grd = ctx.createRadialGradient(0, -e.type.r * 0.5, 4, 0, 0, e.type.r);
    grd.addColorStop(0, c); grd.addColorStop(1, '#331033');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0, wob, e.type.r, 0, 7); ctx.fill();
    // 尖角
    ctx.fillStyle = c;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(i * 14 - 8, wob - 4); ctx.lineTo(i * 14, wob - 20); ctx.lineTo(i * 14 + 8, wob - 4); ctx.fill();
    }
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-7, wob - 2, 5, 0, 7); ctx.arc(7, wob - 2, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-7, wob - 2, 2.4, 0, 7); ctx.arc(7, wob - 2, 2.4, 0, 7); ctx.fill();
    // 名字
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(e.type.name, 0, -e.type.r - 12);
    ctx.restore();
  }
  function drawBoss() {
    const b = state.boss;
    const bob = Math.sin(b.t * 2) * 6;
    const flash = b.hitFlash > 0;
    ctx.save();
    ctx.translate(b.x, b.y + bob);
    const c = BOSS_COLORS[b.hp % BOSS_COLORS.length];
    const r = 92;
    const grd = ctx.createRadialGradient(0, -r * 0.4, 10, 0, 0, r);
    grd.addColorStop(0, flash ? '#ffffff' : c);
    grd.addColorStop(1, '#220022');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    // 角
    ctx.fillStyle = flash ? '#fff' : '#ffd93b';
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath(); ctx.moveTo(i * 30 - 12, -40); ctx.lineTo(i * 30, -95); ctx.lineTo(i * 30 + 12, -40); ctx.fill();
    }
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-24, -8, 13, 0, 7); ctx.arc(24, -8, 13, 0, 7); ctx.fill();
    ctx.fillStyle = flash ? '#f33' : '#111';
    ctx.beginPath(); ctx.arc(-24 + (state.player.x > b.x ? 3 : -3), -8, 7, 0, 7); ctx.arc(24 + (state.player.x > b.x ? 3 : -3), -8, 7, 0, 7); ctx.fill();
    // 嘴
    ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 18, 34, 0.2, Math.PI - 0.2); ctx.stroke();
    // 名牌
    ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = '#ffd93b'; ctx.textAlign = 'center';
    ctx.fillText('⚡ 章节霸主', 0, -r - 24);
    ctx.restore();
  }
  function drawBolt(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));
    const grd = ctx.createLinearGradient(-16, 0, 16, 0);
    grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#2fd6ff');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(-16, -5); ctx.lineTo(10, -5); ctx.lineTo(14, 0); ctx.lineTo(10, 5); ctx.lineTo(-16, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawShock() {
    const from = { x: state.player.x, y: state.player.y - 30 };
    ctx.strokeStyle = '#fff';
    ctx.shadowColor = '#2fd6ff'; ctx.shadowBlur = 18;
    const targets = state.isBoss && state.boss ? [{ x: state.boss.x, y: state.boss.y - 40 }] : state.enemies.map(e => ({ x: e.x, y: e.y - 10 }));
    if (!targets.length) targets.push({ x: from.x + 120, y: from.y });
    targets.forEach(tg => {
      let pts = [{ x: from.x, y: from.y }];
      const seg = 5;
      for (let i = 1; i < seg; i++) {
        pts.push({ x: from.x + (tg.x - from.x) * i / seg + rnd(-18, 18), y: from.y + (tg.y - from.y) * i / seg + rnd(-18, 18) });
      }
      pts.push({ x: tg.x, y: tg.y });
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p2 => ctx.lineTo(p2.x, p2.y));
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
  }
  function drawPopup(pu) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, pu.life / pu.max * 1.6);
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = pu.color;
    ctx.fillText(pu.text, pu.x, pu.y - (1 - pu.life / pu.max) * 46);
    ctx.restore();
  }
  function drawBossHp() {
    const b = state.boss;
    const w = 320, x = (VW - w) / 2, y = 74;
    const q = state.cfg.q;
    const ratio = b.hp / q;
    const low = ratio <= 0.5 && Math.floor(performance.now() / 220) % 2 === 0;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.roundRect(x - 4, y - 4, w + 8, 24, 12); ctx.fill();
    const cellW = Math.max(14, (w - (q - 1) * 4) / q);
    for (let i = 0; i < q; i++) {
      const cx = x + i * (cellW + 4);
      ctx.fillStyle = i < b.hp
        ? (low ? '#ff5a5a' : (ratio > 0.5 ? '#ff5a5a' : (ratio > 0.25 ? '#ff9f1a' : '#ffd93b')))
        : '#3a1040';
      ctx.beginPath(); ctx.roundRect(cx, y, cellW, 16, 4); ctx.fill();
    }
    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText('⚡ 霸主生命 ' + b.hp + ' / ' + q, VW / 2, y + 32);
  }
  function drawTimerBar() {
    const w = 180, x = VW - w - 20, y = 92;
    const ratio = clamp(state.time / state.cfg.time, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.roundRect(x - 3, y - 3, w + 6, 14, 7); ctx.fill();
    ctx.fillStyle = ratio > 0.4 ? '#3bff8f' : (ratio > 0.2 ? '#ffd93b' : '#ff5a5a');
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w * ratio), 8, 4); ctx.fill();
  }
  function updateHud() {
    const s = state;
    $('hud-chapter').textContent = '第' + (s.chapter.id === 0 ? '0' : s.chapter.id) + '章 ' + s.chapter.name;
    $('hud-level').textContent = s.isBoss ? 'BOSS战' : '关卡' + s.level.id + ' · ' + s.level.name;
    $('hud-score').textContent = s.score;
    $('hud-hearts').textContent = '❤'.repeat(s.hearts) + '🖤'.repeat(s.maxHearts - s.hearts);
    $('q-combo').textContent = s.combo >= 2 ? '🔥 连击 ×' + s.combo : '';
  }

  /* ---------- 输入 ---------- */
  function setupInput() {
    window.addEventListener('keydown', (e) => {
      KEYS[e.key] = true;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') {
        e.preventDefault();
        if (state && state.player.onGround && state.player.stun <= 0) {
          state.player.vy = -780; state.player.onGround = false;
        }
      }
      if (e.key === '1') pick(0);
      if (e.key === '2') pick(1);
      if (e.key === '3') pick(2);
      if (e.key === '4') pick(3);
      if (e.key === 'Enter' && state && state.graded === false && curQ() && curQ().type === 'multi') confirmMulti();
      if (e.key === 'Escape') abandon();
    });
    window.addEventListener('keyup', (e) => { KEYS[e.key] = false; });
    // 触摸按钮（按住移动）
    bindHold('btn-left', 'ArrowLeft');
    bindHold('btn-right', 'ArrowRight');
    $('btn-jump').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state && state.phase === 'play' && state.player.onGround && state.player.stun <= 0) {
        state.player.vy = -780; state.player.onGround = false;
      }
    });
    // 填空提交
    $('fill-submit').onclick = submitFill;
    $('fill-input').onkeydown = (e) => { if (e.key === 'Enter') submitFill(); };
    // 画布点击答案台
    $('game-canvas').addEventListener('pointerdown', (e) => {
      if (!state) return;
      const rect = e.target.getBoundingClientRect();
      const x = (e.clientX - rect.left) * VW / cw;
      const y = (e.clientY - rect.top) * VH / ch;
      const q = curQ();
      if (!q || q.type === 'fill' || state.graded) return;
      const n = q.options.length;
      const w = Math.min(170, VW / (n + 1) - 20);
      q.options.forEach((o, i) => {
        const cx = (i + 1) * VW / (n + 1);
        if (x > cx - w / 2 && x < cx + w / 2 && y > GROUND - 80 && y < GROUND) pick(i);
      });
    });
  }
  function bindHold(id, key) {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); KEYS[key] = true; });
    el.addEventListener('pointerup', () => { KEYS[key] = false; });
    el.addEventListener('pointerleave', () => { KEYS[key] = false; });
    el.addEventListener('pointercancel', () => { KEYS[key] = false; });
  }
  const TYPE_NAME = { single: '单选', judge: '判断', multi: '多选', fill: '填空', matching: '连线' };
  /* 1.4.0.1：game.js 独立 IIFE 需自带 esc（与 exam.js 同款），否则答题渲染引用未定义报错 */
  const esc = (x) => String(x == null ? '' : x)
    .replace(/<\/?(?:sub|sup)>/gi, '\u0001$&\u0002')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    .replace(/\u0001(<\/?(?:sub|sup)>)\u0002/gi, '$1');

  /* ---------- BOSS 战准备：暂停 + 触控按钮拖拽调整 ---------- */
  function showBossReady() {
    const ov = $('boss-ready');
    if (!ov) { state.phase = 'play'; return; }
    ov.style.display = 'flex';
    $('hud-timer').textContent = Math.ceil(Math.max(0, state.time)) + 's';
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    const tip = ov.querySelector('.br-tip');
    if (tip) tip.innerHTML = isTouch ? '游戏已暂停，请先调整触控按钮的位置，<br>确定好后点击「开始战斗」开始！' : '游戏已暂停，准备好后点击「开始战斗」开始！';
    ['btn-left', 'btn-right', 'btn-jump'].forEach(id => enableDrag(id));
    $('btn-start-boss').onclick = () => {
      ov.style.display = 'none';
      state.phase = 'play';
      ['btn-left', 'btn-right', 'btn-jump'].forEach(id => disableDrag(id));
      const q = curQ();
      if (q) speakQuestion(q);
    };
  }
  function applyTouchLayout() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('dg_touch_layout') || 'null'); } catch (e) {}
    if (!saved) return;
    ['btn-left', 'btn-right', 'btn-jump'].forEach(id => {
      const p = saved[id];
      const el = $(id);
      if (p && el) {
        el.style.position = 'fixed';
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        el.style.margin = '0';
        el.style.zIndex = '30';
      }
    });
  }
  function enableDrag(id) {
    const el = $(id);
    if (!el || el.dataset.dragOn) return;
    el.dataset.dragOn = '1';
    el.style.cursor = 'move';
    el.classList.add('tc-drag');
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    const onDown = (e) => {
      e.preventDefault();
      dragging = true;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      sx = e.clientX; sy = e.clientY;
      el.classList.add('tc-dragging');
    };
    const onMove = (e) => {
      if (!dragging) return;
      const w = el.offsetWidth || 56, h = el.offsetHeight || 56;
      const nx = clamp(ox + (e.clientX - sx), 4, window.innerWidth - w - 4);
      const ny = clamp(oy + (e.clientY - sy), 4, window.innerHeight - h - 4);
      el.style.position = 'fixed';
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      el.style.margin = '0';
      el.style.zIndex = '30';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('tc-dragging');
      saveTouchLayout();
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el._dragCleanup = () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }
  function disableDrag(id) {
    const el = $(id);
    if (!el) return;
    el.dataset.dragOn = '';
    el.style.cursor = '';
    el.classList.remove('tc-drag', 'tc-dragging');
    if (el._dragCleanup) { el._dragCleanup(); el._dragCleanup = null; }
  }
  function saveTouchLayout() {
    const saved = {};
    ['btn-left', 'btn-right', 'btn-jump'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      saved[id] = { x: Math.round(r.left), y: Math.round(r.top) };
    });
    try { localStorage.setItem('dg_touch_layout', JSON.stringify(saved)); } catch (e) {}
  }

  /* 启动 BOSS 配置 */
  function initBoss() {
    state.boss = { x: VW / 2, y: GROUND - 92, hp: state.cfg.q, t: 0, hitFlash: 0 };
  }

  /* 暴露接口 */
  window.Game = {
    start(chapter, level, questions, cfg, pt) {
      // 直接调 start（已在 start 内初始化）
      start(chapter, level, questions, cfg, pt);
      if (level.id === 'boss') initBoss();
    }
  };
  setupInput();
})();
