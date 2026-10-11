/* ===== 统一富文本渲染：Markdown + LaTeX + 上下标 + 合法HTML白名单（V1.5.1.0） =====
 * 用于题干/选项/解析/考试说明等所有文本渲染，保证 闯关答题/试卷/成绩分析 三处一致。
 * 安全性：除白名单标签（sup/sub/b/i/em/strong/code/u/span/a/br）外一律转义；a 仅 http(s)。
 */
function latexHtml(l) {
  let t = String(l == null ? '' : l);
  t = t.replace(/\\times/g, '×').replace(/\\cdot/g, '·').replace(/\\div/g, '÷').replace(/\\pm/g, '±')
    .replace(/\\approx/g, '≈').replace(/\\leq/g, '≤').replace(/\\geq/g, '≥').replace(/\\neq/g, '≠')
    .replace(/\\infty/g, '∞').replace(/\\propto/g, '∝').replace(/\\angle/g, '∠').replace(/\\deg/g, '°')
    .replace(/\\mu/g, 'μ').replace(/\\Omega/g, 'Ω').replace(/\\omega/g, 'ω').replace(/\\pi/g, 'π')
    .replace(/\\varphi/g, 'φ').replace(/\\phi/g, 'φ').replace(/\\Phi/g, 'Φ').replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ').replace(/\\Gamma/g, 'Γ').replace(/\\delta/g, 'δ')
    .replace(/\\Delta/g, 'Δ').replace(/\\theta/g, 'θ').replace(/\\Theta/g, 'Θ').replace(/\\lambda/g, 'λ')
    .replace(/\\Lambda/g, 'Λ').replace(/\\rho/g, 'ρ').replace(/\\sigma/g, 'σ').replace(/\\Sigma/g, 'Σ')
    .replace(/\\varepsilon/g, 'ε').replace(/\\eta/g, 'η').replace(/\\kappa/g, 'κ').replace(/\\tau/g, 'τ')
    .replace(/\\xi/g, 'ξ').replace(/\\zeta/g, 'ζ').replace(/\\psi/g, 'ψ').replace(/\\chi/g, 'χ').replace(/\\nu/g, 'ν')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1').replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\operatorname\{([^}]*)\}/g, '$1').replace(/\\rm\{([^}]*)\}/g, '$1')
    .replace(/\\sqrt\[([^\]]+)\]\{([^}]*)\}/g, '$1√($2)').replace(/\\sqrt\{([^}]*)\}/g, '√($1)')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '<sup>$1</sup>⁄<sub>$2</sub>').replace(/\\dfrac\{([^}]*)\}\{([^}]*)\}/g, '<sup>$1</sup>⁄<sub>$2</sub>')
    .replace(/\\sp\{([^}]*)\}/g, '<sup>$1</sup>').replace(/\\sb\{([^}]*)\}/g, '<sub>$1</sub>')
    .replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>').replace(/\^([0-9A-Za-z])/g, '<sup>$1</sup>')
    .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([0-9A-Za-z])/g, '<sub>$1</sub>')
    .replace(/\\([a-zA-Z]+)/g, '').replace(/[{}]/g, '');
  return t;
}
function mdMath(s) {
  if (s == null) return '';
  let t = String(s);
  const prot = [];
  const keep = (m) => { prot.push(m); return '\u0001P' + (prot.length - 1) + '\u0001'; };
  /* 1) 保护合法标签（a 仅允许 http/https，其余按文本转义） */
  t = t.replace(/<(sup|sub|b|strong|i|em|code|u|span)(\s[^>]*)?>[\s\S]*?<\/\1>|<br\s*\/?>/gi, m => {
    if (/^<a/i.test(m)) return m;
    return keep(m);
  });
  t = t.replace(/<a(\s[^>]*)?>[\s\S]*?<\/a>/gi, m => {
    if (/href\s*=\s*["']?https?:\/\//i.test(m)) return keep(m);
    return m;
  });
  /* 2) LaTeX：$$…$$ / $…$ / \(…\) */
  t = t.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g, (m, a, b, c) => keep(latexHtml(a || b || c)));
  /* 2.5) 裸 LaTeX（无 $ 包裹的历史数据）：\times10^{-3} / \frac{}{} / \mu_r 等 */
  t = t.replace(/(?:\\[a-zA-Z]+(?:\{[^{}]*\})?)(?:(?:[0-9.]*)(?:\^\{[^{}]*\}|_\{[^{}]*\}|\^[0-9A-Za-z]|_[0-9A-Za-z]))*/g, m => keep(latexHtml(m)));
  /* 3) Unicode 上下标 → <sup>/<sub> */
  t = t.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ]+)/g, m => keep('<sup>' + m + '</sup>'));
  t = t.replace(/([₀₁₂₃₄₅₆₇₈₉ₐₑₓᵢⱼₙₚᵣᵤᵥ]+)/g, m => keep('<sub>' + m + '</sub>'));
  /* 4) Markdown 行内：**粗体** *斜体* `行内代码` [链接](url) */
  t = t.replace(/\*\*([^*]+)\*\*/g, (m, a) => keep('<b>' + a + '</b>'));
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, (m, a, b) => a + keep('<i>' + b + '</i>'));
  t = t.replace(/~~([^~\n]+)~~/g, (m, a) => keep('<s>' + a + '</s>'));
  t = t.replace(/`([^`\n]+)`/g, (m, a) => keep('<code>' + a + '</code>'));
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, a, u) => keep('<a href="' + u + '" target="_blank" rel="noopener">' + a + '</a>'));
  /* 5) 块级 Markdown：#标题 / -列表 / >引用 / 数字列表（按行） */
  t = t.split('\n').map(line => {
    if (/^#{1,4}\s+/.test(line)) return keep('<b>' + line.replace(/^#{1,4}\s*/, '') + '</b>');
    if (/^[-*]\s+/.test(line)) return keep('• ' + line.replace(/^[-*]\s+/, ''));
    if (/^>\s?/.test(line)) return keep('<i>' + line.replace(/^>\s?/, '') + '</i>');
    if (/^\d+[.、]\s+/.test(line)) return keep('&nbsp;&nbsp;' + line.replace(/^\d+[.、]\s+/, ''));
    return line;
  }).join('\n');
  /* 6) 换行 → <br>（保护），转义剩余标签，还原 */
  t = t.replace(/\n/g, m => keep('<br>'));
  t = t.replace(/&(?!#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/\u0001P(\d+)\u0001/g, (m, i) => prot[parseInt(i, 10)] || '');
  return t;
}
/* 纯文本剥离（读题语音/检索用） */
function mdPlain(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\$+|\\([a-zA-Z]+)/g, '').replace(/\*\*|~~|`/g, '');
}

/* ===== 网络层：与服务端通信 ===== */
(function () {
  window.mdMath = mdMath;
  window.latexHtml = latexHtml;
  window.mdPlain = mdPlain;
  const TOKEN_KEY = 'dg_token';
  /* V1.5.1.0：Access 版写操作遮罩（"正在写入请勿关闭"）+ 120 秒超时提示 */
  function showWriteMask() {
    let m = document.getElementById('write-mask');
    if (!m) {
      m = document.createElement('div');
      m.id = 'write-mask';
      m.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
      m.innerHTML = '<div style="background:#0b1530;border:1px solid #2a3f6e;border-radius:12px;padding:22px 30px;text-align:center;color:#fff;max-width:86%">' +
        '<div style="font-size:28px">⏳</div>' +
        '<div style="margin-top:8px;font-size:15px;font-weight:700">正在写入数据，请勿关闭窗口…</div>' +
        '<div style="margin-top:4px;font-size:12px;color:#8fa5cf">Access 数据库写入较慢，请耐心等待；超时将提示重试</div></div>';
      document.body.appendChild(m);
    }
    m.style.display = 'flex';
  }
  function hideWriteMask() {
    const m = document.getElementById('write-mask');
    if (m) m.style.display = 'none';
  }
  window.__showWriteMask = showWriteMask;
  window.__hideWriteMask = hideWriteMask;
  const TEACHER_WRITE_RE = /^\/(api\/(questions\/(admin|import|admin\/batch-delete)|users(\/reset|\/edit)?|score|settings|teacher|levels\/auto-time|paper\/(generate|export)|exam\/(save|delete|status|grade)|upload-qimg|delete-qimg|logs))/;
  const REQ_TIMEOUT = 120000;
  const API = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    base: '',

    async req(method, url, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['X-Token'] = this.token;
      const showMask = window.__DB_ACCESS && method !== 'GET' && TEACHER_WRITE_RE.test(url);
      if (showMask) showWriteMask();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
      try {
        const res = await fetch(this.base + url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal
        });
        let data = null;
        try { data = await res.json(); } catch (e) { data = {}; }
        if (!res.ok) {
          const err = new Error((data && data.err) || ('请求失败 ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('写入超时（' + (REQ_TIMEOUT / 1000) + ' 秒），请确认服务端是否正常，稍后重试');
        throw e;
      } finally {
        clearTimeout(timer);
        if (showMask) hideWriteMask();
      }
    },
    saveToken(t) { this.token = t; localStorage.setItem(TOKEN_KEY, t); },
    clearToken() { this.token = ''; localStorage.removeItem(TOKEN_KEY); },

    /* 学生/通用 */
    register: (name, password, school, grade, cls) => API.req('POST', '/api/register', { name, password, school, grade, class: cls }),
    login: (name, password) => API.req('POST', '/api/login', { name, password }),
    me: () => API.req('GET', '/api/me'),
    meta: () => API.req('GET', '/api/meta'),
    questions: (chapter, level) => API.req('GET', '/api/questions?chapter=' + chapter + '&level=' + level),
    answer: (payload) => API.req('POST', '/api/answer', payload),
    progress: (chapter, level, stars) => API.req('POST', '/api/progress', { chapter, level, stars }),
    leaderboard: () => API.req('GET', '/api/leaderboard'),
    wrong: () => API.req('GET', '/api/wrong'),
    wrongPractice: () => API.req('GET', '/api/wrong/practice'),
    memory: () => API.req('GET', '/api/memory'),
    memoryScore: (score, gain) => API.req('POST', '/api/memory/score', { score, gain }),

    /* 教师 */
    users: () => API.req('GET', '/api/users'),
    resetPassword: (id, password) => API.req('POST', '/api/users/reset', { id, password }),
    deleteUser: (id) => API.req('DELETE', '/api/users', { id }),
    /* V1.5.0.0：教师修改学生学校/年级/班级 */
    editUser: (id, data) => API.req('POST', '/api/users/edit', Object.assign({ id }, data)),
    addScore: (id, delta, reason) => API.req('POST', '/api/score', { id, delta, reason }),
    qList: (params) => {
      const q = new URLSearchParams();
      if (params.chapter !== undefined && params.chapter !== '') q.set('chapter', params.chapter);
      if (params.type) q.set('type', params.type);
      if (params.kw) q.set('kw', params.kw);
      return API.req('GET', '/api/questions/admin?' + q.toString());
    },
    qAdd: (data) => API.req('POST', '/api/questions/admin', data),
    qUpdate: (id, data) => API.req('PUT', '/api/questions/admin/' + id, data),
    qDelete: (id) => API.req('DELETE', '/api/questions/admin/' + id),
    /* 1.4.0.0：题目图片上传/删除（base64 → public/qimg/） */
    uploadQimg: (data) => API.req('POST', '/api/upload-qimg', { data }),
    deleteQimg: (url) => API.req('POST', '/api/delete-qimg', { url }),
    /* 1.0.0.5：题库模板导出/试题导入/批量删除 */
    qImport: (format, content) => API.req('POST', '/api/questions/import', { format, content }),
    qBatchDelete: (ids) => API.req('POST', '/api/questions/admin/batch-delete', { ids }),
    /* 1.4.3.0：图片OCR识别 / 网页抓题 */
    ocr: (image) => API.req('POST', '/api/ocr', { image }),
    fetchQuestions: (url) => API.req('POST', '/api/fetch-questions', { url }),
    /* 1.0.0.5：二进制文件下载（模板 CSV / 组卷 doc） */
    async download(url, method, body) {
      const headers = {};
      if (this.token) headers['X-Token'] = this.token;
      if (body) headers['Content-Type'] = 'application/json';
      const showMask = window.__DB_ACCESS && method !== 'GET' && TEACHER_WRITE_RE.test(url);
      if (showMask) showWriteMask();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
      try {
        const res = await fetch(this.base + url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
        if (!res.ok) {
          let d = {};
          try { d = await res.json(); } catch (e) { /* ignore */ }
          throw new Error(d.err || ('下载失败 ' + res.status));
        }
        return res.blob();
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('写入超时（' + (REQ_TIMEOUT / 1000) + ' 秒），请确认服务端是否正常，稍后重试');
        throw e;
      } finally {
        clearTimeout(timer);
        if (showMask) hideWriteMask();
      }
    },
    /* 1.0.0.5：关卡题目数量自动计时 */
    levelAutoTime: (q) => API.req('POST', '/api/levels/auto-time', q),
    /* 1.0.0.5：组卷生成 */
    paperGenerate: (opts) => API.req('POST', '/api/paper/generate', opts),
    logs: () => API.req('GET', '/api/logs'),
    /* V1.5.0.0：成绩分析可按 学校/年级/班级 筛选 */
    anaFilter: (school, grade, cls) => {
      const q = new URLSearchParams();
      if (school) q.set('school', school);
      if (grade) q.set('grade', grade);
      if (cls) q.set('class', cls);
      return q.toString();
    },
    classAnalysis: (school, grade, cls) => API.req('GET', '/api/analysis/class?' + API.anaFilter(school, grade, cls)),
    studentAnalysis: (id) => API.req('GET', '/api/analysis/student?id=' + encodeURIComponent(id)),
    chapterAnalysis: (chapter, school, grade, cls) => API.req('GET', '/api/analysis/chapter?chapter=' + chapter + '&' + API.anaFilter(school, grade, cls)),
    sectionAnalysis: (chapter, section, school, grade, cls) => API.req('GET', '/api/analysis/section?chapter=' + chapter + '&section=' + section + '&' + API.anaFilter(school, grade, cls)),
    mastery: (school, grade, cls) => API.req('GET', '/api/analysis/mastery?' + API.anaFilter(school, grade, cls)),
    settings: () => API.req('GET', '/api/settings'),
    setUnit: (unit) => API.req('PUT', '/api/settings', { unit }),
    setSettings: (obj) => API.req('PUT', '/api/settings', obj),
    setTeacher: (obj) => API.req('PUT', '/api/teacher', obj),
    /* 1.3.0.0 考试/阅卷（西红柿阅卷） */
    examSave: (data) => API.req('POST', '/api/exam/save', data),
    examList: () => API.req('GET', '/api/exam/list'),
    examGet: (id) => API.req('GET', '/api/exam/get?id=' + encodeURIComponent(id)),
    examDelete: (id) => API.req('POST', '/api/exam/delete', { id }),
    examStatus: (id, status) => API.req('POST', '/api/exam/status', { id, status }),
    examMine: () => API.req('GET', '/api/exam/mine'),
    examPreview: (id) => API.req('GET', '/api/exam/preview?id=' + encodeURIComponent(id)),
    examSubmit: (data) => API.req('POST', '/api/exam/submit', data),
    examAnswers: (examId) => API.req('GET', '/api/exam/answers?examId=' + encodeURIComponent(examId)),
    examGrade: (data) => API.req('POST', '/api/exam/grade', data),
    examStats: (examId) => API.req('GET', '/api/exam/stats?examId=' + encodeURIComponent(examId)),
    examUpload: (data) => API.req('POST', '/api/exam/upload', data)
  };
  window.API = API;
})();
