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
    register: (name, password) => API.req('POST', '/api/register', { name, password }),
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
    logs: () => API.req('GET', '/api/logs'),
    classAnalysis: () => API.req('GET', '/api/analysis/class'),
    studentAnalysis: (id) => API.req('GET', '/api/analysis/student?id=' + encodeURIComponent(id)),
    chapterAnalysis: (chapter) => API.req('GET', '/api/analysis/chapter?chapter=' + chapter),
    sectionAnalysis: (chapter, section) => API.req('GET', '/api/analysis/section?chapter=' + chapter + '&section=' + section),
    mastery: () => API.req('GET', '/api/analysis/mastery'),
    settings: () => API.req('GET', '/api/settings'),
    setUnit: (unit) => API.req('PUT', '/api/settings', { unit }),
    setSettings: (obj) => API.req('PUT', '/api/settings', obj),
    setTeacher: (obj) => API.req('PUT', '/api/teacher', obj)
  };
  window.API = API;
})();
