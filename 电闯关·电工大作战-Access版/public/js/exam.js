/* ============================================================
 * 网上阅卷考试系统（西红柿阅卷模式） v1.3.0.0
 * 标准机读答题卡生成 / 拍照上传 OMR 识别 / 客观题自动判分 /
 * 主观题教师在线批改 / 成绩发布与统计分析
 * ============================================================ */
(function () {
  const $id = (id) => document.getElementById(id);
  const esc = (x) => String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const TYPE_NAME = { single: '单选', judge: '判断', multi: '多选', fill: '填空', matching: '连线', calc: '计算' };
  const STATUS_MAP = { draft: '草稿', open: '进行中', grading: '阅卷中', published: '已发布' };
  const STATUS_CLS = { draft: '', open: 'primary', grading: 'warn', published: 'ok' };
  function toast(msg) {
    const t = $id('toast');
    if (!t) { alert(msg); return; }
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }
  function fmtTime(t) {
    if (!t) return '';
    const d = new Date(Number(t));
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function typeOrder() { return ['single', 'judge', 'multi', 'fill', 'matching', 'calc']; }

  /* ================= 试卷 / 答题卡 HTML 生成 ================= */
  function paperTitle(exam) {
    const u = (window.S && S.unit) ? S.unit : '';
    const g = (window.S && S.gameName) ? S.gameName : '电闯关·电工大作战';
    return u ? (u + ' · ' + g) : g;
  }
  /* 标准考试试卷（预览/打印版） */
  function examPaperHTML(exam, includeAnswer) {
    const tip = { single: '（每题只有一个正确答案）', judge: '（正确打“√”，错误打“×”）',
      multi: '（每题有两个或两个以上正确答案）', fill: '（将正确答案填写在横线上）',
      matching: '（将左列与右列对应的选项用线连接）', calc: '（按“已知、求、解、答”四步作答）' };
    const no2 = { single: '一', judge: '二', multi: '三', fill: '四', matching: '五', calc: '六' };
    let no = 0, html = '';
    html += '<div class="print-doc" style="width:210mm;margin:0 auto;font-family:宋体,SimSun,serif;font-size:12pt;line-height:1.9;color:#000;padding:0 6mm">';
    html += '<table style="width:100%;border-collapse:collapse"><tr><td style="width:12mm;vertical-align:top">';
    html += '<div style="border-left:1px dashed #000;border-right:1px dashed #000;height:200mm;font-size:8.5pt;text-align:center;padding:2mm 1mm">' +
      '<div style="margin:8mm 0;letter-spacing:2px">┄ 装 ┄ 订 ┄ 线 ┄</div><div>班 级：__________</div><div style="margin-top:4mm">姓 名：__________</div><div style="margin-top:4mm">考 号：__________</div><div style="margin-top:6mm">┄ 装 ┄ 订 ┄ 线 ┄</div></div>';
    html += '</td><td style="vertical-align:top;padding-left:3mm">';
    html += '<div style="text-align:center;font-size:16pt;font-weight:bold;letter-spacing:2px;margin:2mm 0 1mm">' + esc(exam.title) + '</div>';
    html += '<div style="text-align:center;font-size:10pt;color:#333;margin:0 0 2mm">' + esc(paperTitle(exam)) + '　·　' + esc(exam.subject || '电工技术基础与技能') + '　·　考试时间 60 分钟　·　满分 ' + exam.totalScore + ' 分</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin:1mm 0 2mm;font-size:11pt"><tr>' +
      '<td style="border:1px solid #000;padding:1.5mm;width:16%">班　级：</td><td style="border:1px solid #000;width:34%">&nbsp;</td>' +
      '<td style="border:1px solid #000;padding:1.5mm;width:16%">姓　名：</td><td style="border:1px solid #000;width:34%">&nbsp;</td></tr>' +
      '<tr><td style="border:1px solid #000;padding:1.5mm">考　号：</td><td style="border:1px solid #000">&nbsp;</td>' +
      '<td style="border:1px solid #000;padding:1.5mm">得　分：</td><td style="border:1px solid #000">&nbsp;</td></tr></table>';
    html += '<div style="font-size:10pt;color:#333;margin:1mm 0 2mm"><b style="color:#000">注意事项：</b>1. 答题前请将班级、姓名、考号填写清楚；2. 客观题（单选/多选/判断）请在机读答题卡上用 2B 铅笔填涂，主观题在本卷作答；' +
      '3. 本试卷共 ' + exam.qcount + ' 题，满分 ' + exam.totalScore + ' 分，考试时间 60 分钟；4. 请认真审题，字迹工整，答完仔细检查。</div>';
    typeOrder().forEach(t => {
      const arr = exam.questions.filter(q => q.type === t);
      if (!arr.length) return;
      const sc = arr.reduce((s, x) => s + (x.score || 1), 0);
      html += '<div style="font-size:12.5pt;font-weight:bold;margin:3mm 0 1.5mm">' + no2[t] + '、' + TYPE_NAME[t] + '（共 ' + arr.length + ' 题，每题 ' + (arr[0].score || 1) + ' 分，共 ' + sc + ' 分）' + tip[t] + '</div>';
      arr.forEach(q => {
        no++;
        html += '<div style="margin:2mm 0;page-break-inside:avoid"><b>' + no + '.</b> ' + esc(q.question);
        if (q.type === 'single' || q.type === 'multi') {
          html += '<div style="margin:1mm 0 1mm 6mm">' + (q.options || []).map((o, i) => String.fromCharCode(65 + i) + '. ' + String(o).replace(/^[A-Za-z][.、．]\s*/, '')).join('　　') + '</div>';
        } else if (q.type === 'judge') {
          html += '<span style="margin-left:8mm">（　　　　）</span>';
        } else if (q.type === 'fill') {
          html += '<span style="display:inline-block;margin-left:4mm;border-bottom:1.5px solid #000;width:30mm;height:5mm;vertical-align:bottom"></span>';
        } else if (q.type === 'matching') {
          const o = q.options || {};
          html += '<div style="margin:1mm 0 1mm 6mm">' + (Array.isArray(o.left) ? o.left.map((l, i) => (i + 1) + '. ' + l).join('　　') : '') + '</div>';
          html += '<div style="margin:1mm 0 1mm 6mm">' + (Array.isArray(o.right) ? o.right.map((r, i) => String.fromCharCode(65 + i) + '. ' + r).join('　　') : '') + '</div>';
          html += '<div style="margin:1mm 0 1mm 6mm">连　线：＿＿＿＿＿＿＿＿＿＿＿＿</div>';
        } else if (q.type === 'calc') {
          html += '<div style="margin:1mm 0 1mm 6mm;font-size:11.5pt"><b>已知：</b><div style="border-bottom:1px solid #000;height:6mm;margin-left:12mm"></div><b>求：</b><div style="border-bottom:1px solid #000;height:6mm;margin-left:12mm"></div>' +
            '<b>解：</b><div style="border-bottom:1px solid #000;height:6mm;margin-left:12mm"></div><div style="border-bottom:1px solid #000;height:6mm;margin-left:12mm"></div><div style="border-bottom:1px solid #000;height:6mm;margin-left:12mm"></div>' +
            '<b>答：</b><div style="border-bottom:1px solid #000;height:6mm;margin-left:12mm"></div></div>';
        }
        if (includeAnswer) {
          if (q.type === 'matching') {
            let pairs = []; try { pairs = JSON.parse(q.answer || '[]'); } catch (e) {}
            html += '<div style="margin-top:1mm;color:#a00;font-size:10.5pt">参考答案：<b>' + pairs.map((pr, i) => (i + 1) + '→' + String.fromCharCode(65 + (pr[1] == null ? 0 : pr[1]))).join('　') + '</b>' + (q.explain ? '<br/>解析：' + esc(q.explain) : '') + '</div>';
          } else {
            html += '<div style="margin-top:1mm;color:#a00;font-size:10.5pt">参考答案：<b>' + esc(q.answer) + '</b>' + (q.explain ? '<br/>解析：' + esc(q.explain) : '') + '</div>';
          }
        }
        html += '</div>';
      });
    });
    html += '<table style="width:100%;border-collapse:collapse;margin-top:4mm;font-size:11pt;text-align:center"><tr><td style="border:1px solid #000;width:24%">题类</td>' +
      '<td style="border:1px solid #000">客观题（单选/多选/判断/填空）</td><td style="border:1px solid #000">主观题（连线/计算）</td><td style="border:1px solid #000;width:14%">总分</td></tr>' +
      '<tr><td style="border:1px solid #000">得分</td><td style="border:1px solid #000">&nbsp;</td><td style="border:1px solid #000">&nbsp;</td><td style="border:1px solid #000">&nbsp;</td></tr></table>';
    html += '<div style="margin-top:4mm;text-align:center;font-size:10pt;color:#555">—— ' + esc(paperTitle(exam)) + ' ——</div>';
    html += '</td></tr></table></div>';
    return html;
  }

  /* 机读答题卡布局（逻辑坐标 宽1000；与 OMR 识别共用） */
  function cardLayout(exam) {
    const W = 1000, ML = 40;
    const singles = exam.questions.filter(q => q.type === 'single' || q.type === 'multi');
    const judges = exam.questions.filter(q => q.type === 'judge');
    const subs = exam.questions.filter(q => ['fill', 'matching', 'calc'].includes(q.type));
    const cells = [];   // 涂卡格
    const regions = []; // 区域（供 OMR 统计/校验）
    let y = 0;
    // 定位块（逻辑坐标）
    const marks = { tl: [22, 22, 26, 26], tr: [W - 48, 22, 26, 26] };
    // 考号区：10 位 × 0-9
    y = 120;
    regions.push({ type: 'stuNo', x: ML, y, w: W - ML * 2, h: 44 });
    y += 50;
    const noCol = 76, noRow = 34, noX = ML, noY = y, noCols = 10;
    for (let d = 0; d < 10; d++) {
      for (let c = 0; c < noCols; c++) {
        cells.push({ type: 'stuno', row: d, col: c, x: noX + 24 + c * (noCols > 6 ? (W - ML * 2 - 24) / 10 : 92), y: noY + d * noRow, w: 30, h: noRow - 6 });
      }
    }
    // 题号行宽适配
    const noW = 54, colW = (W - ML * 2 - noW) / 4;
    // 客观题（单选/多选）
    if (singles.length) {
      y = noY + 10 * noRow + 14;
      regions.push({ type: 'obj', x: ML, y, w: W - ML * 2, h: 26 });
      y += 32;
      const perRow = 4;
      for (let i = 0; i < singles.length; i++) {
        const r = Math.floor(i / perRow), c = i % perRow;
        const cy = y + r * 40, cx = ML + noW + c * colW;
        ['A', 'B', 'C', 'D'].forEach((L, k) => {
          cells.push({ type: 'obj', qid: singles[i].id, letter: L, x: cx + 26 + k * (colW / 4), y: cy, w: 26, h: 34 });
        });
        cells.push({ type: 'objNo', qid: singles[i].id, x: ML + 6, y: cy, w: 40, h: 34 });
      }
      y += Math.ceil(singles.length / perRow) * 40 + 8;
    }
    // 判断题
    if (judges.length) {
      y += 4;
      regions.push({ type: 'judge', x: ML, y, w: W - ML * 2, h: 26 });
      y += 32;
      const perRow = 5;
      const jcW = (W - ML * 2 - noW) / 2;
      for (let i = 0; i < judges.length; i++) {
        const r = Math.floor(i / perRow), c = i % perRow;
        const cy = y + r * 40, cx = ML + noW + (c % 2) * jcW;
        ['A', 'B'].forEach((L, k) => {
          cells.push({ type: 'judge', qid: judges[i].id, letter: L, x: cx + 30 + k * (jcW / 3), y: cy, w: 26, h: 34 });
        });
        cells.push({ type: 'judgeNo', qid: judges[i].id, x: ML + 6, y: cy, w: 40, h: 34 });
      }
      y += Math.ceil(judges.length / perRow) * 40 + 8;
    }
    // 主观题区（手写，不识别）
    const subNo = singles.length + judges.length;
    if (subs.length) {
      y += 4;
      regions.push({ type: 'sub', x: ML, y, w: W - ML * 2, h: 26 });
      y += 34;
      subs.forEach((q, i) => {
        const cy = y + i * 34;
        regions.push({ type: 'subItem', qid: q.id, x: ML, y: cy, w: W - ML * 2, h: 30 });
      });
      y += subs.length * 34 + 4;
    }
    const H = y + 60;
    marks.bl = [22, H - 48, 26, 26]; marks.br = [W - 48, H - 48, 26, 26];
    return { W, H, marks, cells, regions, singles: singles.length, judges: judges.length, subs: subs.length };
  }
  /* 机读答题卡 HTML（与 cardLayout 坐标一致；按比例放大为打印尺寸） */
  function examCardHTML(exam) {
    const L = cardLayout(exam);
    const px = 1.0; // 逻辑 1 = 打印 1px（A4 打印时 210mm ≈ 794px；1000px 略宽，用 scale）
    const scale = 0.76; // 1000 * 0.76 = 760px ≈ A4 可用宽度
    const css = (c) => 'left:' + (c.x * scale) + 'px;top:' + (c.y * scale) + 'px;width:' + (c.w * scale) + 'px;height:' + (c.h * scale) + 'px';
    const marks = L.marks;
    let html = '';
    html += '<div style="position:relative;width:' + (L.W * scale) + 'px;height:' + (L.H * scale) + 'px;margin:0 auto;font-family:宋体,SimSun,serif;background:#fff;overflow:hidden">';
    // 定位块
    [marks.tl, marks.tr, marks.bl, marks.br].forEach(m => {
      html += '<div style="position:absolute;background:#000;left:' + (m[0] * scale) + 'px;top:' + (m[1] * scale) + 'px;width:' + (m[2] * scale) + 'px;height:' + (m[3] * scale) + 'px"></div>';
    });
    // 标题
    html += '<div style="position:absolute;left:0;top:8px;width:100%;text-align:center;font-size:15px;font-weight:bold;letter-spacing:2px">' + esc(exam.title) + '　机读答题卡</div>';
    html += '<div style="position:absolute;left:0;top:30px;width:100%;text-align:center;font-size:9px;color:#333">' + esc(paperTitle(exam)) + '　·　共 ' + exam.qcount + ' 题 / ' + exam.totalScore + ' 分　·　用 2B 铅笔填涂</div>';
    // 姓名/班级/考号
    html += '<div style="position:absolute;left:60px;top:52px;font-size:10px">姓 名：____________　班 级：____________　学 号：____________</div>';
    // 考号填涂
    html += '<div style="position:absolute;left:60px;top:78px;font-size:10px;font-weight:bold">准 考 证 号：</div>';
    const noX = 150, noY = 76, noCols = 10, ncW = (L.W * scale - noX - 20) / noCols, noRow = 13;
    html += '<div style="position:absolute;left:' + noX + 'px;top:' + (noY + 10) + 'px;font-size:8px">' + [1,2,3,4,5,6,7,8,9,10].map(i => '<span style="display:inline-block;width:' + ncW + 'px;text-align:center">' + i + '</span>').join('') + '</div>';
    for (let d = 0; d < 10; d++) {
      html += '<div style="position:absolute;left:' + noX + 'px;top:' + (noY + 24 + d * noRow) + 'px;font-size:8px;width:20px;text-align:center;font-weight:bold">' + d + '</div>';
      html += '<div style="position:absolute;left:' + (noX + 22) + 'px;top:' + (noY + 24 + d * noRow) + 'px;font-size:8px">' +
        [0,1,2,3,4,5,6,7,8,9].map(() => '<span style="display:inline-block;width:' + (ncW - 2) + 'px;text-align:center">○</span>').join('') + '</div>';
    }
    // 客观题表头与格子
    let baseY = noY + 24 + 10 * noRow + 16;
    const singleCnt = L.singles, judgeCnt = L.judges;
    if (singleCnt) {
      html += '<div style="position:absolute;left:60px;top:' + baseY + 'px;font-size:10px;font-weight:bold">一、客观题（单选题 / 多选题）　题号 →</div>';
      const rows = Math.ceil(singleCnt / 4);
      const rowH = 34 * scale;
      const colW = (L.W * scale - 60 - 40) / 4;
      for (let r = 0; r < rows; r++) {
        const y = baseY + 24 + r * rowH;
        html += '<div style="position:absolute;left:60px;top:' + y + 'px;font-size:9px;width:34px">' + (r * 4 + 1) + '</div>';
        for (let c = 0; c < 4; c++) {
          const n = r * 4 + c;
          const x = 100 + c * colW;
          if (n < singleCnt) {
            html += '<div style="position:absolute;left:' + x + 'px;top:' + y + 'px;font-size:9px;width:24px;text-align:center">' + (n + 1) + '</div>';
            ['A','B','C','D'].forEach((L2, k) => {
              html += '<div style="position:absolute;left:' + (x + 28 + k * (colW / 4 - 6)) + 'px;top:' + (y - 2) + 'px;font-size:8px;width:20px;text-align:center"><span style="display:inline-block;width:12px;height:12px;border:1.5px solid #000;border-radius:50%;vertical-align:middle;margin-right:1px"></span>' + L2 + '</div>';
            });
          }
        }
      }
      baseY += rows * rowH + 18;
    }
    if (judgeCnt) {
      html += '<div style="position:absolute;left:60px;top:' + baseY + 'px;font-size:10px;font-weight:bold">二、判断题（正确涂 A，错误涂 B）</div>';
      const rows = Math.ceil(judgeCnt / 5);
      const rowH = 34 * scale;
      const jcW = (L.W * scale - 60 - 40) / 2;
      for (let r = 0; r < rows; r++) {
        const y = baseY + 24 + r * rowH;
        for (let c = 0; c < 5; c++) {
          const n = r * 5 + c;
          const x = 100 + (c % 2) * jcW;
          if (n < judgeCnt) {
            html += '<div style="position:absolute;left:' + x + 'px;top:' + y + 'px;font-size:9px;width:24px;text-align:center">' + (n + 1) + '</div>';
            ['A（√）','B（×）'].forEach((L2, k) => {
              html += '<div style="position:absolute;left:' + (x + 30 + k * (jcW / 3)) + 'px;top:' + (y - 2) + 'px;font-size:8px;width:20px;text-align:center"><span style="display:inline-block;width:12px;height:12px;border:1.5px solid #000;border-radius:50%;vertical-align:middle;margin-right:1px"></span>' + L2 + '</div>';
            });
          }
        }
      }
      baseY += rows * rowH + 18;
    }
    // 主观题手写区
    if (L.subs) {
      html += '<div style="position:absolute;left:60px;top:' + baseY + 'px;font-size:10px;font-weight:bold">三、主观题（填空 / 连线 / 计算）请在试卷对应区域作答</div>';
    }
    // 得分区
    html += '<div style="position:absolute;left:60px;bottom:14px;font-size:9px">客观题得分：________　主观题得分：________　总分：________　阅卷人：________</div>';
    html += '</div>';
    return html;
  }

  /* ================= OMR 拍照识别引擎 ================= */
  const OMR = {
    /* 载入图片 → 缩放 + 灰度 */
    load(imgData) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            let w = img.width, h = img.height;
            const maxW = 1600;
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const id = ctx.getImageData(0, 0, w, h);
            const gray = new Float32Array(w * h);
            for (let i = 0; i < w * h; i++) {
              const r = id.data[i * 4], g = id.data[i * 4 + 1], b = id.data[i * 4 + 2];
              gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            }
            resolve({ img, cv, ctx, gray, w, h });
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = imgData;
      });
    },
    /* 四角定位：在四角小区域内找黑色像素极值中点（定位块实心方块中心） */
    findCorners(gray, w, h) {
      const dark = (i) => gray[i] < 120;
      const cx0 = Math.round(w * 0.18), cx1 = Math.round(w * 0.82);
      const cy0 = Math.round(h * 0.12), cy1 = Math.round(h * 0.88);
      const stat = (y0, y1, x0, x1) => {
        let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          for (let x = x0; x < x1; x++) {
            if (dark(row + x)) {
              n++; if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        return n >= 40 ? [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2), n] : null;
      };
      let tl = stat(0, cy0, 0, cx0);
      let tr = stat(0, cy0, cx1, w);
      let bl = stat(cy1, h, 0, cx0);
      let br = stat(cy1, h, cx1, w);
      // 容错：若某角缺失，扩大搜索带（全角 35%）
      if (!tl) tl = stat(0, Math.round(h * 0.35), 0, Math.round(w * 0.35));
      if (!tr) tr = stat(0, Math.round(h * 0.35), Math.round(w * 0.65), w);
      if (!bl) bl = stat(Math.round(h * 0.65), h, 0, Math.round(w * 0.35));
      if (!br) br = stat(Math.round(h * 0.65), h, Math.round(w * 0.65), w);
      if (!tl || !tr || !bl || !br) return null;
      return { tl, tr, bl, br };
    },
    /* 单应矩阵（DLT，4 点） */
    homography(src, dst) {
      const A = [];
      for (let i = 0; i < 4; i++) {
        const [x, y] = src[i], [u, v] = dst[i];
        A.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
        A.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
      }
      // 高斯消元解 Ah = 0（取最小特征向量 → 简化用 last row 消元）
      const n = 9;
      for (let col = 0; col < n; col++) {
        let piv = -1;
        for (let r = col; r < A.length; r++) { if (Math.abs(A[r][col]) > 1e-10) { piv = r; break; } }
        if (piv < 0) continue;
        [A[col], A[piv]] = [A[piv], A[col]];
        const v0 = A[col][col];
        for (let c = col; c <= n; c++) A[col][c] /= v0;
        for (let r = 0; r < A.length; r++) {
          if (r === col) continue;
          const f = A[r][col];
          if (Math.abs(f) < 1e-12) continue;
          for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
        }
      }
      const h = A.map(r => r[n] || 0);
      return (x, y) => {
        const d = h[6] * x + h[7] * y + h[8] || 1;
        return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
      };
    },
    /* 逻辑坐标 → 原图像素 映射（四点双线性插值；以定位块中心逻辑坐标为准） */
    buildMap(L, corners, w, h) {
      const tl = corners.tl, tr = corners.tr, bl = corners.bl, br = corners.br;
      const m = 35; // 定位块中心逻辑坐标（22 + 13）
      const iw = L.W - m * 2, ih = L.H - m * 2;
      return (lx, ly) => {
        const u = Math.max(0, Math.min(1, (lx - m) / iw));
        const v = Math.max(0, Math.min(1, (ly - m) / ih));
        const tx = tl[0] + (tr[0] - tl[0]) * u;
        const ty = tl[1] + (tr[1] - tl[1]) * u;
        const bx = bl[0] + (br[0] - bl[0]) * u;
        const by = bl[1] + (br[1] - bl[1]) * u;
        return [tx + (bx - tx) * v, ty + (by - ty) * v];
      };
    },
    /* 对逻辑坐标格采样黑度 */
    sampleBlack(gray, w, h, H, x, y, gw, gh) {
      const N = 4;
      let darkN = 0, tot = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const lx = x + gw * (i + 0.5) / N;
          const ly = y + gh * (j + 0.5) / N;
          const p = H(lx, ly);
          const px = Math.round(p[0]), py = Math.round(p[1]);
          if (px < 0 || py < 0 || px >= w || py >= h) { tot++; continue; }
          tot++;
          if (gray[py * w + px] < 130) darkN++;
        }
      }
      return tot ? darkN / tot : 0;
    },
    /* 主识别：图片 → [{id, given}] */
    recognize(dataUrl, exam) {
      const L = cardLayout(exam);
      return this.load(dataUrl).then(({ gray, w, h }) => {
        const corners = this.findCorners(gray, w, h);
        if (!corners) throw new Error('未能定位答题卡四角，请将答题卡放正后重拍');
        const H = this.buildMap(L, corners, w, h);
        const result = [];
        const byQ = {};
        L.cells.forEach(c => {
          if (c.type !== 'obj' && c.type !== 'judge') return;
          const black = this.sampleBlack(gray, w, h, H, c.x, c.y, c.w, c.h);
          if (!byQ[c.qid]) byQ[c.qid] = { letters: {}, best: 0, bestL: '' };
          const rec = byQ[c.qid];
          rec.letters[c.letter] = black;
          if (black > rec.best) { rec.best = black; rec.bestL = c.letter; }
        });
        // 判定：黑度 > 0.45 的选项视为涂黑；多选取全部涂黑项
        exam.questions.forEach(q => {
          if (q.type !== 'single' && q.type !== 'judge' && q.type !== 'multi') return;
          const rec = byQ[q.id];
          if (!rec) { result.push({ id: q.id, given: '' }); return; }
          if (q.type === 'multi') {
            const sel = Object.keys(rec.letters).filter(L2 => rec.letters[L2] > 0.42).sort();
            result.push({ id: q.id, given: sel.join(',') });
          } else {
            const sel = Object.keys(rec.letters).filter(L2 => rec.letters[L2] > 0.42);
            result.push({ id: q.id, given: sel.length === 1 ? sel[0] : (rec.best > 0.5 ? rec.bestL : '') });
          }
        });
        return result;
      });
    }
  };

  /* ================= 教师端 ================= */
  const EXM = {
    _exams: [],
    _editing: null,
    _picker: null,

    async render() {
      const box = $id('exam-box');
      if (!box) return;
      try {
        const r = await API.examList();
        this._exams = r.list || [];
      } catch (e) {
        this._exams = [];
      }
      const st = (s) => '<span class="chip ' + (STATUS_CLS[s] || '') + '">' + (STATUS_MAP[s] || s) + '</span>';
      let html = '<div class="filter-row">';
      html += '<b style="line-height:32px">📝 阅卷考试管理</b>';
      html += '<button class="btn primary small" id="exam-new-btn" style="margin-left:auto">+ 新建考试</button></div>';
      if (!this._exams.length) {
        html += '<div class="msg">暂无考试。点击「新建考试」创建考试并组卷，即可生成标准试卷与机读答题卡，学生拍照上传后可自动阅卷。</div>';
      } else {
        html += '<table class="data-table"><tr><th>考试名称</th><th>班级/科目</th><th>题数</th><th>分值</th><th>状态</th><th>创建时间</th><th style="min-width:430px">操作</th></tr>';
        this._exams.forEach(e => {
          html += '<tr><td><b>' + esc(e.title) + '</b><br/><span style="font-size:11px;color:var(--dim)">' + (e.note ? esc(e.note) : '') + '</span></td>' +
            '<td>' + esc(e.className || '-') + '<br/><span style="font-size:11px;color:var(--dim)">' + esc(e.subject || '') + '</span></td>' +
            '<td>' + e.qcount + '</td><td>' + e.totalScore + '</td><td>' + st(e.status) + '</td><td>' + fmtTime(e.createdAt) + '</td><td>';
          html += '<button class="btn small" onclick="EXM.openModal(\'' + e.id + '\')">✏️ 编辑</button> ';
          html += '<button class="btn small" onclick="EXM.previewPaper(\'' + e.id + '\')">📄 试卷</button> ';
          html += '<button class="btn small" onclick="EXM.previewCard(\'' + e.id + '\')">⬛ 答题卡</button> ';
          if (e.status === 'draft') html += '<button class="btn small primary" onclick="EXM.setStatus(\'' + e.id + '\',\'open\')">▶ 开考</button> ';
          if (e.status === 'open') html += '<button class="btn small warn" onclick="EXM.setStatus(\'' + e.id + '\',\'grading\')">📥 收卷阅卷</button> ';
          if (e.status === 'grading' || e.status === 'open') html += '<button class="btn small primary" onclick="EXM.grade(\'' + e.id + '\')">✍️ 阅卷</button> ';
          if (e.status === 'grading') html += '<button class="btn small primary" onclick="EXM.setStatus(\'' + e.id + '\',\'published\')">📢 发布成绩</button> ';
          if (e.status === 'published') html += '<button class="btn small" onclick="EXM.stats(\'' + e.id + '\')">📊 考试分析</button> ';
          html += '<button class="btn small danger" onclick="EXM.del(\'' + e.id + '\')">🗑</button>';
          html += '</td></tr>';
        });
        html += '</table>';
      }
      box.innerHTML = html;
      const nb = $id('exam-new-btn');
      if (nb) nb.onclick = () => EXM.openModal(null);
    },

    /* 组卷弹窗（新建/编辑） */
    async openModal(examId) {
      const mb = $id('modal-body'), ov = $id('modal');
      mb.classList.add('exam-wide');
      this._editing = null;
      this._picker = [];
      let exam = null;
      if (examId) {
        try {
          const r = await API.examGet(examId);
          exam = r.exam;
          this._editing = exam;
          this._picker = (exam.questions || []).map(q => ({ id: q.id, score: q.score }));
        } catch (e) { toast('加载考试失败：' + e.message); return; }
      }
      const pick = this._picker;
      const qids = new Set(pick.map(p => p.id));
      let html = '<div class="ex-modal" style="max-width:960px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:15px;font-weight:bold">' + (examId ? '✏️ 编辑考试' : '📝 新建考试（组卷）') + '</div>' +
        '<button class="btn small" onclick="document.getElementById(\'modal\').style.display=\'none\'">✕ 取消</button></div>';
      html += '<div class="filter-row" style="flex-wrap:wrap">' +
        '<input id="ex-title" type="text" placeholder="考试名称（必填）" value="' + esc(exam ? exam.title : '') + '" style="min-width:220px">' +
        '<input id="ex-class" type="text" placeholder="班级（如：电一(1)班）" value="' + esc(exam ? exam.className : '') + '" style="min-width:150px">' +
        '<input id="ex-note" type="text" placeholder="备注（可选）" value="' + esc(exam ? exam.note : '') + '" style="min-width:180px">' +
        '</div>';
      html += '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0">';
      html += '<div style="font-weight:bold;margin-bottom:6px">⚙️ 自动组卷（按章节 / 难度 / 题型 / 题量）</div>';
      html += '<div class="filter-row" style="flex-wrap:wrap">' +
        '<select id="ex-auto-ch" style="min-width:130px"></select>' +
        '<select id="ex-auto-diff" style="min-width:90px"><option value="">不限难度</option><option value="1">★ 易</option><option value="2">★★</option><option value="3">★★★</option><option value="4">★★★★</option><option value="5">★★★★★</option></select>';
      html += ['single', 'judge', 'multi', 'fill', 'matching', 'calc'].map(t =>
        '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px">' + TYPE_NAME[t] +
        '<input type="number" id="ex-auto-' + t + '" min="0" max="20" value="0" style="width:52px"></span>').join('');
      html += '<button class="btn small primary" id="ex-auto-btn">🎲 自动组卷</button></div>';
      html += '<div style="font-size:11px;color:var(--dim);margin-top:4px">选择章节/难度/题型与数量后点击自动组卷（依据学生掌握情况优先抽取薄弱题）。</div></div>';
      html += '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0">';
      html += '<div style="font-weight:bold;margin-bottom:6px">🔎 手动选题（题库筛选）</div>';
      html += '<div class="filter-row" style="flex-wrap:wrap">' +
        '<select id="ex-pick-ch" style="min-width:120px"></select>' +
        '<select id="ex-pick-type" style="min-width:90px"><option value="">全部题型</option>' + typeOrder().map(t => '<option value="' + t + '">' + TYPE_NAME[t] + '</option>').join('') + '</select>' +
        '<input id="ex-pick-kw" type="text" placeholder="关键词" style="min-width:140px">' +
        '<button class="btn small" id="ex-pick-btn">🔍 搜索</button></div>';
      html += '<div id="ex-pick-list" style="max-height:240px;overflow:auto;margin-top:6px"></div></div>';
      html += '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0">';
      html += '<div style="font-weight:bold;margin-bottom:6px">📋 已选题目（' + pick.length + ' 题）<span style="font-weight:normal;color:var(--dim)">— 可修改每题分值、移除；保存后自动计算总分</span></div>';
      html += '<div id="ex-picked"></div></div>';
      html += '<div class="filter-row"><span id="ex-total" style="font-weight:bold"></span>' +
        '<button class="btn" onclick="document.getElementById(\'modal\').style.display=\'none\'" style="margin-left:auto">取消</button>' +
        '<button class="btn primary" id="ex-save-btn">💾 保存考试</button></div>';
      html += '</div>';
      mb.innerHTML = html;
      ov.style.display = 'flex';
      // 章节下拉（双份）
      const chs = (S && S.chapters) || [];
      const chName = (c) => typeof c === 'string' ? c : (c && (c.name || c.title || c.text)) ? (c.name || c.title || c.text) : JSON.stringify(c);
      const chOpts = '<option value="">全部章节</option>' + chs.map((c, i) => '<option value="' + i + '">第' + i + '章 ' + chName(c) + '</option>').join('');
      const a1 = $id('ex-auto-ch'); if (a1) a1.innerHTML = chOpts;
      const a2 = $id('ex-pick-ch'); if (a2) a2.innerHTML = chOpts;
      const ab = $id('ex-auto-btn');
      if (ab) ab.onclick = () => EXM.autoPaper();
      const pb = $id('ex-pick-btn');
      if (pb) pb.onclick = () => EXM.pickQuestions();
      if ($id('ex-pick-kw')) $id('ex-pick-kw').onkeydown = (e) => { if (e.key === 'Enter') EXM.pickQuestions(); };
      const sb = $id('ex-save-btn');
      if (sb) sb.onclick = () => EXM.saveExam();
      EXM.pickQuestions();
      EXM.renderPicked();
    },

    async pickQuestions() {
      const params = {
        chapter: $id('ex-pick-ch').value,
        type: $id('ex-pick-type').value,
        kw: $id('ex-pick-kw').value
      };
      let list = [];
      try {
        const r = await API.qList(params);
        list = r.list || [];
      } catch (e) { list = []; }
      const pick = this._picker;
      const qids = new Set(pick.map(p => p.id));
      const box = $id('ex-pick-list');
      if (!box) return;
      let html = '<table class="data-table" style="font-size:12px"><tr><th style="width:34px">选</th><th>章</th><th>节</th><th>题型</th><th>题干</th><th>难度</th></tr>';
      if (!list.length) html += '<tr><td colspan="6" class="msg">无匹配题目</td></tr>';
      list.forEach(q => {
        const checked = qids.has(q.id) ? 'checked' : '';
        html += '<tr><td><input type="checkbox" data-qid="' + q.id + '" ' + checked + '></td><td>' + q.chapter + '</td><td>' + (q.section || 1) + '</td><td>' + (TYPE_NAME[q.type] || q.type) + '</td>' +
          '<td>' + esc(q.question) + '</td><td>' + '★'.repeat(Math.max(1, Math.min(5, q.difficulty || 3))) + '</td></tr>';
      });
      html += '</table>';
      box.innerHTML = html;
      box.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.onchange = () => {
          const qid = Number(cb.dataset.qid);
          const i = pick.findIndex(p => p.id === qid);
          if (cb.checked && i < 0) pick.push({ id: qid, score: 1 });
          if (!cb.checked && i >= 0) pick.splice(i, 1);
          EXM.renderPicked();
        };
      });
    },

    renderPicked() {
      const pick = this._picker;
      const box = $id('ex-picked');
      if (!box) return;
      let html = '<table class="data-table" style="font-size:12px"><tr><th>#</th><th>章</th><th>节</th><th>题型</th><th>题干</th><th style="width:90px">分值</th><th style="width:50px"></th></tr>';
      if (!pick.length) html += '<tr><td colspan="7" class="msg">尚未选题</td></tr>';
      pick.forEach((p, i) => {
        const q = this._qCache ? this._qCache[p.id] : null;
        html += '<tr><td>' + (i + 1) + '</td><td>' + (q ? q.chapter : '') + '</td><td>' + (q ? (q.section || 1) : '') + '</td><td>' + (q ? (TYPE_NAME[q.type] || q.type) : '') + '</td>' +
          '<td>' + esc(q ? q.question : ('题目 #' + p.id)) + '</td>' +
          '<td><input type="number" data-pidx="' + i + '" value="' + p.score + '" min="1" max="20" style="width:52px" onchange="EXM.setScore(this)"></td>' +
          '<td><button class="btn small danger" onclick="EXM.removePicked(' + i + ')">✕</button></td></tr>';
      });
      html += '</table>';
      box.innerHTML = html;
      const total = pick.reduce((s, p) => s + (p.score || 1), 0);
      const t = $id('ex-total');
      if (t) t.textContent = '共 ' + pick.length + ' 题 / ' + total + ' 分';
    },
    setScore(inp) {
      const i = Number(inp.dataset.pidx);
      if (this._picker[i]) this._picker[i].score = Math.max(1, Number(inp.value) || 1);
      const total = this._picker.reduce((s, p) => s + (p.score || 1), 0);
      const t = $id('ex-total'); if (t) t.textContent = '共 ' + this._picker.length + ' 题 / ' + total + ' 分';
    },
    removePicked(i) {
      this._picker.splice(i, 1);
      EXM.pickQuestions();
      EXM.renderPicked();
    },
    /* 自动组卷 */
    async autoPaper() {
      const ch = $id('ex-auto-ch').value;
      const diff = $id('ex-auto-diff').value;
      const counts = {};
      typeOrder().forEach(t => { const v = Number($id('ex-auto-' + t).value) || 0; if (v > 0) counts[t] = v; });
      const total = Object.values(counts).reduce((s, x) => s + x, 0);
      if (!total) { toast('请至少填写一种题型的题目数量'); return; }
      let all = [];
      try {
        const r = await API.qList({ chapter: ch });
        all = r.list || [];
      } catch (e) { all = []; }
      // 掌握情况权重（薄弱优先）由服务端完成，这里按题型/难度抽取
      this._qCache = {};
      all.forEach(q => { this._qCache[q.id] = q; });
      const pick = [];
      typeOrder().forEach(t => {
        if (!counts[t]) return;
        let pool = all.filter(q => q.type === t);
        if (diff) pool = pool.filter(q => String(q.difficulty) === diff);
        // 洗牌
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        pool.slice(0, counts[t]).forEach(q => pick.push({ id: q.id, score: 1 }));
      });
      if (!pick.length) { toast('没有符合条件的题目，请调整筛选条件'); return; }
      this._picker = pick;
      EXM.pickQuestions();
      EXM.renderPicked();
    },

    async saveExam() {
      const title = $id('ex-title').value.trim();
      if (!title) { toast('请填写考试名称'); return; }
      if (!this._picker.length) { toast('请至少选择一道题目'); return; }
      const data = {
        id: this._editing ? this._editing.id : undefined,
        title,
        className: $id('ex-class').value.trim(),
        note: $id('ex-note').value.trim(),
        questions: this._picker.map(p => ({ id: p.id, score: p.score }))
      };
      try {
        const r = await API.examSave(data);
        toast('考试已保存');
        $id('modal').style.display = 'none';
        EXM.render();
      } catch (e) { toast('保存失败：' + e.message); }
    },

    async setStatus(id, st) {
      try {
        await API.examStatus(id, st);
        toast('状态已更新为「' + (STATUS_MAP[st] || st) + '」');
        EXM.render();
      } catch (e) { toast(e.message); }
    },
    async del(id) {
      if (!confirm('确定删除该考试？其所有答卷与成绩将被一并删除！')) return;
      try {
        await API.examDelete(id);
        toast('已删除');
        EXM.render();
      } catch (e) { toast(e.message); }
    },

    /* 标准试卷预览 + 打印 + 下载 Word */
    async previewPaper(id) {
      try {
        const r = await API.examGet(id);
        const e = r.exam;
        this._printExam = e;
        const w = window.open('', '_blank', 'width=960,height=720');
        if (!w) { toast('请允许弹窗以预览试卷'); return; }
        w.document.write('<html><head><meta charset="utf-8"><title>' + esc(e.title) + ' 标准试卷</title>' +
          '<style>@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>' +
          examPaperHTML(e, false) +
          '<div style="text-align:center;margin:10px 0;position:fixed;bottom:0;left:0;right:0;background:#fff;padding:8px;border-top:1px solid #ccc">' +
          '<button onclick="window.print()">🖨️ 打印试卷</button> ' +
          '<button onclick="window.close()">关闭</button></div></body></html>');
        w.document.close();
        EXM._win = w;
      } catch (e) { toast('加载失败：' + e.message); }
    },
    /* 机读答题卡预览 + 打印 + 下载 Word */
    async previewCard(id) {
      try {
        const r = await API.examGet(id);
        const e = r.exam;
        this._printExam = e;
        const w = window.open('', '_blank', 'width=960,height=720');
        if (!w) { toast('请允许弹窗以预览答题卡'); return; }
        w.document.write('<html><head><meta charset="utf-8"><title>' + esc(e.title) + ' 机读答题卡</title>' +
          '<style>@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>' +
          examCardHTML(e) +
          '<div style="text-align:center;margin:10px 0;position:fixed;bottom:0;left:0;right:0;background:#fff;padding:8px;border-top:1px solid #ccc">' +
          '<span style="font-size:11px;color:#888">打印后请用 2B 铅笔填涂，考号填涂与机读识别对应</span> ' +
          '<button onclick="window.print()">🖨️ 打印答题卡</button> ' +
          '<button onclick="window.close()">关闭</button></div></body></html>');
        w.document.close();
      } catch (e) { toast('加载失败：' + e.message); }
    },
    downloadDoc(url, payload) {
      API.download(url, 'POST', payload).then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'document.doc';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      }).catch(e => toast(e.message));
    },

    /* 阅卷界面 */
    async grade(examId) {
      const mb = $id('modal-body'), ov = $id('modal');
      let data = null;
      try {
        const r = await API.examAnswers(examId);
        data = r;
      } catch (e) { toast('加载答卷失败：' + e.message); return; }
      const exam = data.exam, list = data.list || [];
      let html = '<div style="max-width:980px">';
      html += '<div style="font-size:15px;font-weight:bold;margin-bottom:4px">✍️ 阅卷批改 — ' + esc(exam.title) + '</div>';
      html += '<div style="font-size:12px;color:var(--dim);margin-bottom:10px">共收卷 ' + list.length + ' 份；客观题已由系统自动判分，主观题（连线/计算）请对照原卷批改打分后保存。</div>';
      if (!list.length) {
        html += '<div class="msg">暂无学生提交答卷。请将考试状态置为「进行中」并告知学生拍照上传。</div>';
        html += '<div class="filter-row"><button class="btn" onclick="document.getElementById(\'modal\').style.display=\'none\'">关闭</button></div></div>';
        mb.innerHTML = html; ov.style.display = 'flex';
        return;
      }
      list.forEach(a => {
        const subNeed = (a.subjective || []).filter(s => !s.graded);
        html += '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0">';
        html += '<div class="filter-row" style="flex-wrap:wrap">' +
          '<b>' + esc(a.name) + '</b>' +
          '<span class="chip">' + (a.img ? '已上传照片' : '无照片') + '</span>' +
          '<span class="chip">客观题 ' + (a.objective || []).reduce((s, o) => s + (o.ok ? 1 : 0), 0) + '/' + (a.objective || []).length + '</span>' +
          '<span class="chip">当前总分 <b>' + a.total + '</b> / ' + a.examTotal + '</span>' +
          (subNeed.length ? '<span class="chip warn">待批改 ' + subNeed.length + ' 题</span>' : '<span class="chip ok">已批完</span>') +
          '</div>';
        if (a.img) html += '<div style="margin:6px 0"><img src="' + esc(a.img) + '" style="max-width:100%;max-height:260px;border:1px solid var(--line);border-radius:6px" onclick="window.open(this.src)"/></div>';
        // 客观题明细
        const objList = (a.objective || []).map(o => {
          const q = exam.questions.find(qq => String(qq.id) === String(o.id));
          const ansTxt = q ? (q.type === 'judge' ? (o.given === 'A' ? '√' : o.given === 'B' ? '×' : (o.given || '未涂')) : (o.given || '未涂')) : (o.given || '');
          const ok = o.ok ? '<span style="color:#1a7f37">✓</span>' : '<span style="color:#c00">✗</span>';
          return '<span class="chip ' + (o.ok ? 'ok' : 'err') + '" style="font-size:11px">#' + (q ? q.chapter : '') + ' ' + esc(ansTxt) + ' ' + ok + '</span>';
        }).join(' ');
        if (objList) html += '<div style="margin:4px 0;display:flex;flex-wrap:wrap;gap:4px">' + objList + '</div>';
        // 主观题批改
        if ((a.subjective || []).length) {
          html += '<table class="data-table" style="font-size:12px;margin-top:6px"><tr><th>主观题</th><th>满分</th><th>得分</th><th>状态</th></tr>';
          (a.subjective || []).forEach(s => {
            const q = exam.questions.find(qq => String(qq.id) === String(s.id));
            html += '<tr><td>#' + (q ? q.chapter : '') + ' ' + esc(q ? q.question : '') + '</td>' +
              '<td>' + s.maxScore + '</td>' +
              '<td><input type="number" data-exam="' + exam.id + '" data-user="' + a.userId + '" data-q="' + s.id + '" value="' + s.score + '" min="0" max="' + s.maxScore + '" style="width:60px" ' + (s.graded ? '' : '') + '></td>' +
              '<td>' + (s.graded ? '<span style="color:#1a7f37">已批</span>' : '<span class="chip warn">待批</span>') + '</td></tr>';
          });
          html += '</table>';
          html += '<div class="filter-row" style="margin-top:6px"><button class="btn primary small" onclick="EXM.saveGrade(\'' + exam.id + '\',\'' + a.userId + '\')">💾 保存该生批改</button></div>';
        }
        html += '</div>';
      });
      html += '<div class="filter-row"><button class="btn" onclick="document.getElementById(\'modal\').style.display=\'none\'">关闭</button></div></div>';
      mb.innerHTML = html; ov.style.display = 'flex';
    },
    async saveGrade(examId, userId) {
      const subs = [];
      document.querySelectorAll('[data-exam="' + examId + '"][data-user="' + userId + '"]').forEach(inp => {
        subs.push({ id: inp.dataset.q, score: Number(inp.value) || 0 });
      });
      try {
        const r = await API.examGrade({ examId, userId, subjective: subs });
        toast('已保存，该生总分 ' + r.total);
        EXM.grade(examId);
      } catch (e) { toast(e.message); }
    },

    /* 考试统计 */
    async stats(examId) {
      const mb = $id('modal-body'), ov = $id('modal');
      let d = null;
      try {
        const r = await API.examStats(examId);
        d = r;
      } catch (e) { toast(e.message); return; }
      const exam = d.exam;
      let html = '<div style="max-width:980px">';
      html += '<div style="font-size:15px;font-weight:bold;margin-bottom:4px">📊 考试分析 — ' + esc(exam.title) + '</div>';
      html += '<div style="font-size:12px;color:var(--dim);margin-bottom:10px">参考 ' + d.count + ' 人 · 平均 ' + d.avg + ' / ' + d.totalScore + ' 分 · 优秀(≥90%) ' + d.dist[0] + ' · 良好(≥75%) ' + d.dist[1] + ' · 及格(≥60%) ' + d.dist[2] + ' · 不及格 ' + d.dist[3] + '</div>';
      // 每题正确率
      html += '<div style="font-weight:bold;margin:8px 0 4px">📈 每题答题情况</div>';
      html += '<table class="data-table" style="font-size:12px"><tr><th>题号</th><th>题型</th><th>题目</th><th>作答</th><th>答对</th><th>正确率</th></tr>';
      (d.perQ || []).forEach((pq, i) => {
        const pct = pq.acc == null ? '—' : pq.acc + '%';
        html += '<tr><td>' + (i + 1) + '</td><td>' + (TYPE_NAME[pq.type] || pq.type) + '</td><td>' + esc(pq.question) + '</td><td>' + pq.tried + '</td><td>' + pq.ok + '</td><td>' + pct + '</td></tr>';
      });
      html += '</table>';
      // 个人成绩
      html += '<div style="font-weight:bold;margin:10px 0 4px">👥 个人成绩单（发布后学生可查看）</div>';
      html += '<table class="data-table" style="font-size:12px"><tr><th>姓名</th><th>得分</th><th>占比</th><th>状态</th></tr>';
      (d.personal || []).forEach(p => {
        const pct = p.total == null ? '—' : Math.round(p.total / d.totalScore * 100) + '%';
        const st = p.total == null ? '<span class="chip">缺考</span>' : (p.status === 'graded' ? '<span class="chip ok">已阅</span>' : '<span class="chip warn">批改中</span>');
        html += '<tr><td>' + esc(p.name) + '</td><td>' + (p.total == null ? '—' : p.total) + '</td><td>' + pct + '</td><td>' + st + '</td></tr>';
      });
      html += '</table>';
      html += '<div class="filter-row" style="margin-top:10px"><button class="btn" onclick="document.getElementById(\'modal\').style.display=\'none\'">关闭</button></div></div>';
      mb.innerHTML = html; ov.style.display = 'flex';
    },

    /* ================= 学生端 ================= */
    async studentRender() {
      const box = $id('exam-student-box');
      if (!box) return;
      let list = [];
      try {
        const r = await API.examMine();
        list = r.list || [];
      } catch (e) { list = []; }
      let html = '';
      if (!list.length) {
        html = '<div class="msg">暂无进行中的考试。</div>';
        html += '<div style="text-align:center;margin-top:10px;font-size:12px;color:var(--dim)">教师发布考试后，可在此查看试卷、下载答题卡并拍照上传。</div>';
      } else {
        list.forEach(e => {
          html += '<div style="border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0">';
          html += '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px"><b style="font-size:14px">' + esc(e.title) + '</b>' +
            '<span class="chip">' + e.qcount + ' 题 / ' + e.totalScore + ' 分</span>' +
            (e.status === 'open' ? '<span class="chip primary">进行中</span>' : '<span class="chip ok">已发布</span>') + '</div>';
          if (e.className) html += '<div style="font-size:12px;color:var(--dim);margin:4px 0">班级：' + esc(e.className) + '</div>';
          if (e.status === 'open') {
            if (!e.answered) {
              html += '<div class="filter-row" style="margin-top:8px"><button class="btn primary small" onclick="EXM.studentAnswer(\'' + e.id + '\')">📤 上传答题卡</button> ' +
                '<button class="btn small" onclick="EXM.studentPaper(\'' + e.id + '\')">📄 预览试卷</button> ' +
                '<button class="btn small" onclick="EXM.studentCard(\'' + e.id + '\')">⬛ 答题卡</button></div>';
            } else {
              html += '<div class="msg" style="margin-top:6px">✅ 已提交。' + (e.myStatus === 'graded' ? '主观题已批改，总分 <b>' + e.myTotal + '</b> / ' + e.totalScore + '。' : '客观题已自动判分，主观题待教师批改。') + '</div>';
              html += '<button class="btn small" style="margin-top:4px" onclick="EXM.studentResult(\'' + e.id + '\')">查看成绩</button>';
            }
          } else if (e.status === 'published') {
            html += '<div style="margin-top:8px"><button class="btn small primary" onclick="EXM.studentResult(\'' + e.id + '\')">查看成绩（' + (e.myTotal == null ? '未参考' : e.myTotal + ' 分') + '）</button></div>';
          }
          html += '</div>';
        });
      }
      box.innerHTML = html;
    },
    /* 学生预览试卷/答题卡 */
    async studentPaper(id) {
      try {
        const r = await API.examPreview(id);
        const e = r.exam;
        const w = window.open('', '_blank', 'width=960,height=720');
        if (!w) { toast('请允许弹窗'); return; }
        w.document.write('<html><head><meta charset="utf-8"><title>' + esc(e.title) + '</title></head><body>' +
          examPaperHTML(e, false) + '<div style="text-align:center;padding:8px"><button onclick="window.print()">🖨️ 打印</button> <button onclick="window.close()">关闭</button></div></body></html>');
        w.document.close();
      } catch (e) { toast(e.message); }
    },
    async studentCard(id) {
      try {
        const r = await API.examPreview(id);
        const e = r.exam;
        const w = window.open('', '_blank', 'width=960,height=720');
        if (!w) { toast('请允许弹窗'); return; }
        w.document.write('<html><head><meta charset="utf-8"><title>' + esc(e.title) + ' 机读答题卡</title></head><body>' +
          examCardHTML(e) + '<div style="text-align:center;padding:8px"><button onclick="window.print()">🖨️ 打印</button> <button onclick="window.close()">关闭</button></div></body></html>');
        w.document.close();
      } catch (e) { toast(e.message); }
    },
    /* 学生上传答题卡：拍照/选图 → OMR 识别 → 核对 → 提交 */
    studentAnswer(examId) {
      const box = $id('exam-student-box');
      if (!box) return;
      let html = '<div style="border:1px solid var(--line);border-radius:10px;padding:14px;margin:10px 0">';
      html += '<div style="font-weight:bold;font-size:14px;margin-bottom:6px">📤 上传答题卡照片</div>';
      html += '<div style="font-size:12px;color:var(--dim);margin-bottom:10px">请将填涂完成的机读答题卡拍照（手机对正、光线充足），系统将自动识别客观题涂卡结果；主观题（连线/计算）由教师在阅卷端对照照片批改。识别后可手动修正。</div>';
      html += '<input type="file" id="exam-img-file" accept="image/*" capture="environment" style="margin:6px 0">';
      html += '<div id="exam-img-preview" style="margin:8px 0"></div>';
      html += '<div id="exam-omr-result"></div>';
      html += '<div class="filter-row" style="margin-top:10px"><button class="btn ghost" onclick="EXM.studentRender()">← 返回</button>' +
        '<button class="btn primary" id="exam-submit-btn" style="margin-left:auto;display:none">✅ 确认提交</button></div>';
      html += '</div>';
      box.innerHTML = html;
      const file = $id('exam-img-file');
      if (!file) return;
      file.onchange = () => {
        const f = file.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result;
          $id('exam-img-preview').innerHTML = '<img src="' + dataUrl + '" style="max-width:100%;max-height:320px;border:1px solid var(--line);border-radius:8px"/>';
          $id('exam-omr-result').innerHTML = '<div class="msg">⏳ 正在识别答题卡…</div>';
          try {
            const exam = await EXM._getExam(examId);
            const rec = await OMR.recognize(dataUrl, exam);
            // 服务端判分（提交时），这里先展示识别结果
            EXM._rec = rec;
            EXM._img = dataUrl;
            EXM._exam = exam;
            EXM._examId = examId;
            EXM.renderRecognized(exam, rec);
          } catch (e) {
            $id('exam-omr-result').innerHTML = '<div class="msg err">识别失败：' + esc(e.message) + '<br/>请将答题卡四角定位块完整拍入、避免反光，重试。</div>';
          }
        };
        reader.readAsDataURL(f);
      };
    },
    async _getExam(id) {
      const r = await API.examGet(id);
      return r.exam;
    },
    renderRecognized(exam, rec) {
      const box = $id('exam-omr-result');
      let html = '<div style="margin-top:6px;border:1px solid var(--line);border-radius:8px;padding:8px;background:#fff">';
      html += '<div style="font-weight:bold;margin-bottom:6px">🔍 识别结果核对（点击下拉可修正）</div>';
      exam.questions.forEach((q, i) => {
        const r0 = rec.find(x => String(x.id) === String(q.id));
        const given = r0 ? r0.given : '';
        let selHtml;
        if (q.type === 'single' || q.type === 'multi' || q.type === 'judge') {
          const opts = q.type === 'judge' ? ['A', 'B'] : (q.options || []).map((o, k) => String.fromCharCode(65 + k));
          const sel = given ? String(given).toUpperCase().split(/[,，]/) : [];
          selHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">' + opts.map(L => {
            const on = sel.includes(L);
            return '<label style="font-size:12px;display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border:1px solid var(--line);border-radius:20px;cursor:pointer;background:' + (on ? '#d6f5d6' : '#fff') + '">' +
              '<input type="checkbox" data-q="' + q.id + '" value="' + L + '" ' + (on ? 'checked' : '') + ' style="accent-color:#1a7f37">' + L + '</label>';
          }).join('') + '</div>';
        } else if (q.type === 'fill') {
          selHtml = '<input type="text" data-q="' + q.id + '" value="' + esc(given) + '" placeholder="填写答案" style="margin-top:4px;min-width:220px">';
        } else {
          selHtml = '<div style="font-size:11px;color:var(--dim);margin-top:4px">主观题（' + TYPE_NAME[q.type] + '）由教师在阅卷端批改，无需填写。</div>';
        }
        html += '<div style="border-top:1px dashed var(--line);padding:5px 0;font-size:12px">' +
          '<b>' + (i + 1) + '.</b> ' + esc(q.question) + ' <span class="chip" style="font-size:10px">' + (TYPE_NAME[q.type] || q.type) + '</span>' + selHtml + '</div>';
      });
      html += '</div>';
      box.innerHTML = html;
      const btn = $id('exam-submit-btn');
      if (btn) btn.style.display = 'inline-block';
      btn.onclick = () => EXM.submitAnswer();
      // 勾选/输入变更时更新 _rec
      box.querySelectorAll('input[type=checkbox][data-q]').forEach(cb => {
        cb.onchange = () => {
          const qid = Number(cb.dataset.q);
          const rec = EXM._rec.find(x => String(x.id) === String(qid));
          const q = EXM._exam.questions.find(qq => String(qq.id) === String(qid));
          if (!rec || !q) return;
          const sel = [...box.querySelectorAll('input[type=checkbox][data-q="' + qid + '"]:checked')].map(x => x.value);
          rec.given = q.type === 'multi' ? sel.join(',') : (sel.length ? sel[0] : '');
        };
      });
      box.querySelectorAll('input[type=text][data-q]').forEach(inp => {
        inp.onchange = () => {
          const qid = Number(inp.dataset.q);
          const rec = EXM._rec.find(x => String(x.id) === String(qid));
          if (rec) rec.given = inp.value;
        };
      });
    },
    async submitAnswer() {
      if (!confirm('确认提交答题卡？提交后不可修改。')) return;
      const btn = $id('exam-submit-btn');
      if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
      try {
        const r = await API.examSubmit({ examId: EXM._examId, objective: EXM._rec.map(x => ({ id: x.id, given: x.given })), img: '' });
        toast('提交成功！客观题得分 ' + r.total + ' 分' + (r.needManual ? '，主观题待教师批改。' : '。'));
        EXM.studentRender();
      } catch (e) {
        toast(e.message);
        if (btn) { btn.disabled = false; btn.textContent = '✅ 确认提交'; }
      }
    },
    async studentResult(examId) {
      const box = $id('exam-student-box');
      try {
        const r = await API.examAnswers(examId);
        // 学生只能看自己
        const me = S.me;
        const ans = (r.list || []).find(x => x.userId === me.id);
        const exam = r.exam;
        let html = '<div style="border:1px solid var(--line);border-radius:10px;padding:14px;margin:10px 0">';
        html += '<div style="font-weight:bold;font-size:14px">📊 我的成绩 — ' + esc(exam.title) + '</div>';
        if (!ans) {
          html += '<div class="msg">尚未参加本场考试。</div>';
        } else {
          html += '<div style="display:flex;gap:12px;margin:10px 0;flex-wrap:wrap">' +
            '<span class="chip primary">总分 <b>' + ans.total + '</b> / ' + exam.totalScore + '</span>' +
            '<span class="chip">客观题 ' + (ans.objective || []).reduce((s, o) => s + (o.ok ? 1 : 0), 0) + '/' + (ans.objective || []).length + '</span>' +
            '<span class="chip">主观题 ' + (ans.subjective || []).reduce((s, o) => s + (o.graded ? o.score : 0), 0) + '/' + (ans.subjective || []).reduce((s, o) => s + o.maxScore, 0) + '</span>' +
            '<span class="chip">' + (ans.status === 'graded' ? '✅ 已批改完成' : '⏳ 批改中') + '</span></div>';
          html += '<table class="data-table" style="font-size:12px"><tr><th>#</th><th>题型</th><th>题目</th><th>我的答案</th><th>结果</th><th>得分</th></tr>';
          let no = 0;
          exam.questions.forEach(q => {
            no++;
            const o = (ans.objective || []).find(x => String(x.id) === String(q.id));
            const s2 = (ans.subjective || []).find(x => String(x.id) === String(q.id));
            if (o) {
              const ansTxt = o.given || '未涂';
              html += '<tr><td>' + no + '</td><td>' + (TYPE_NAME[q.type] || q.type) + '</td><td>' + esc(q.question) + '</td><td>' + esc(ansTxt) + '</td>' +
                '<td>' + (o.ok ? '<span style="color:#1a7f37">✓ 正确</span>' : '<span style="color:#c00">✗ 错误</span>') + '</td><td>' + (o.ok ? '+' + q.score : '0') + '</td></tr>';
            } else if (s2) {
              html += '<tr><td>' + no + '</td><td>' + (TYPE_NAME[q.type] || q.type) + '</td><td>' + esc(q.question) + '</td>' +
                '<td colspan="2">' + (s2.graded ? '已批改：' + s2.score + ' / ' + s2.maxScore + ' 分' : '待教师批改') + '</td><td>' + (s2.graded ? s2.score : '—') + '</td></tr>';
            } else {
              html += '<tr><td>' + no + '</td><td>' + (TYPE_NAME[q.type] || q.type) + '</td><td>' + esc(q.question) + '</td><td colspan="3" style="color:var(--dim)">未作答</td></tr>';
            }
          });
          html += '</table>';
        }
        html += '<div class="filter-row" style="margin-top:10px"><button class="btn ghost" onclick="EXM.studentRender()">← 返回</button></div>';
        html += '</div>';
        box.innerHTML = html;
      } catch (e) { toast(e.message); }
    }
  };
  window.EXM = EXM;
  window.OMR = OMR;
  window.ExamCardHTML = examCardHTML;
  window.ExamPaperHTML = examPaperHTML;
  window.CardLayout = cardLayout;
})();
