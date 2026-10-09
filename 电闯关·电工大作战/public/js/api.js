/* ===== 网络层：与服务端通信 ===== */
(function () {
  const TOKEN_KEY = 'dg_token';
  const API = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    base: '',

    async req(method, url, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['X-Token'] = this.token;
      const res = await fetch(this.base + url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
      let data = null;
      try { data = await res.json(); } catch (e) { data = {}; }
      if (!res.ok) {
        const err = new Error((data && data.err) || ('请求失败 ' + res.status));
        err.status = res.status;
        throw err;
      }
      return data;
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
      const res = await fetch(this.base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        let d = {};
        try { d = await res.json(); } catch (e) { /* ignore */ }
        throw new Error(d.err || ('下载失败 ' + res.status));
      }
      return res.blob();
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
