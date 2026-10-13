/* ============================================================
 * circuit.js — 电路图编辑器 / 本地规则引擎 / 自动解答求解器（V1.5.2.0）
 * 依赖：无（纯 DOM）
 * 提供：
 *   Circuit.DEFS         元件定义库（完整元件库）
 *   Circuit.Editor       拖放式电路图编辑器（弹窗内）
 *   Circuit.autoFromText 题干→自动生成电路图（本地规则引擎）
 *   Circuit.solve        电路图+题干→自动解答（已知/求/解/答）
 *   Circuit.cleanSvg     SVG 白名单清洗（防 XSS，供闯关/试卷/答题卡渲染）
 * ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  /* ---------- 元件定义库（完整） ---------- */
  const DEFS = {
    battery: { cn: '电池', w: 70, h: 36, params: { V: '3V' }, svg: (p) => '<line x1="0" y1="18" x2="20" y2="18" stroke="#0af" stroke-width="2"/><line x1="28" y1="10" x2="28" y2="26" stroke="#0af" stroke-width="2"/><line x1="30" y1="18" x2="48" y2="18" stroke="#0af" stroke-width="2"/><line x1="48" y1="10" x2="48" y2="26" stroke="#0af" stroke-width="2"/><line x1="50" y1="18" x2="70" y2="18" stroke="#0af" stroke-width="2"/><text x="60" y="34" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.V)) + '</text>' },
    dc: { cn: '直流电源', w: 70, h: 36, params: { V: '12V' }, svg: (p) => '<line x1="0" y1="18" x2="14" y2="18" stroke="#0af" stroke-width="2"/><circle cx="26" cy="18" r="12" fill="none" stroke="#0af" stroke-width="2"/><line x1="20" y1="18" x2="24" y2="18" stroke="#0af" stroke-width="2"/><line x1="28" y1="18" x2="32" y2="18" stroke="#0af" stroke-width="2"/><text x="17" y="12" font-size="9" fill="#8cf" text-anchor="middle">+</text><text x="34" y="12" font-size="9" fill="#8cf" text-anchor="middle">−</text><line x1="38" y1="18" x2="52" y2="18" stroke="#0af" stroke-width="2"/><text x="61" y="34" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.V)) + '</text>' },
    ac: { cn: '交流电源', w: 70, h: 36, params: { V: '220V' }, svg: (p) => '<line x1="0" y1="18" x2="12" y2="18" stroke="#0af" stroke-width="2"/><path d="M14 18 q5 -8 10 0 q5 8 10 0 q5 -8 10 0" fill="none" stroke="#0af" stroke-width="2"/><line x1="46" y1="18" x2="58" y2="18" stroke="#0af" stroke-width="2"/><text x="64" y="34" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.V)) + '</text>' },
    res: { cn: '电阻', w: 70, h: 30, params: { R: '10Ω' }, svg: (p) => '<line x1="0" y1="15" x2="10" y2="15" stroke="#0af" stroke-width="2"/><rect x="10" y="6" width="52" height="18" fill="none" stroke="#0af" stroke-width="2"/><line x1="62" y1="15" x2="70" y2="15" stroke="#0af" stroke-width="2"/><text x="35" y="28" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.R)) + '</text>' },
    rvar: { cn: '可变电阻', w: 70, h: 30, params: { R: '50Ω' }, svg: (p) => '<line x1="0" y1="15" x2="10" y2="15" stroke="#0af" stroke-width="2"/><rect x="10" y="6" width="52" height="18" fill="none" stroke="#0af" stroke-width="2"/><line x1="62" y1="15" x2="70" y2="15" stroke="#0af" stroke-width="2"/><line x1="36" y1="6" x2="52" y2="24" stroke="#0af" stroke-width="1.5"/><text x="35" y="28" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.R)) + '</text>' },
    pot: { cn: '电位器', w: 70, h: 36, params: { R: '10kΩ' }, svg: (p) => '<line x1="0" y1="18" x2="10" y2="18" stroke="#0af" stroke-width="2"/><rect x="10" y="9" width="52" height="18" fill="none" stroke="#0af" stroke-width="2"/><line x1="62" y1="18" x2="70" y2="18" stroke="#0af" stroke-width="2"/><line x1="36" y1="27" x2="44" y2="33" stroke="#0af" stroke-width="1.5"/><path d="M40 33 l-6 -1 M40 33 l3 -5" stroke="#0af" stroke-width="1.5" fill="none"/><text x="35" y="35" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.R)) + '</text>' },
    lamp: { cn: '灯泡', w: 70, h: 36, params: {}, svg: () => '<line x1="0" y1="18" x2="14" y2="18" stroke="#0af" stroke-width="2"/><circle cx="30" cy="18" r="14" fill="none" stroke="#0af" stroke-width="2"/><line x1="24" y1="12" x2="36" y2="24" stroke="#0af" stroke-width="1.5"/><line x1="24" y1="24" x2="36" y2="12" stroke="#0af" stroke-width="1.5"/><line x1="44" y1="18" x2="58" y2="18" stroke="#0af" stroke-width="2"/><text x="30" y="36" font-size="9" fill="#8cf" text-anchor="middle">L</text>' },
    sw: { cn: '开关', w: 70, h: 34, params: { closed: false }, svg: (p) => '<line x1="0" y1="17" x2="26" y2="17" stroke="#0af" stroke-width="2"/><circle cx="26" cy="17" r="2.5" fill="#0af"/><line x1="50" y1="17" x2="70" y2="17" stroke="#0af" stroke-width="2"/><circle cx="50" cy="17" r="2.5" fill="#0af"/><line x1="26" y1="17" x2="47" y2="9" stroke="#0af" stroke-width="2"/><text x="41" y="32" font-size="9" fill="#8cf" text-anchor="middle">S</text>' },
    sw2: { cn: '单刀双掷', w: 84, h: 40, params: {}, svg: () => '<line x1="0" y1="20" x2="26" y2="20" stroke="#0af" stroke-width="2"/><circle cx="26" cy="20" r="2.5" fill="#0af"/><line x1="26" y1="20" x2="52" y2="6" stroke="#0af" stroke-width="2"/><line x1="52" y1="6" x2="84" y2="6" stroke="#0af" stroke-width="2"/><circle cx="52" cy="6" r="2.5" fill="#0af"/><line x1="52" y1="20" x2="52" y2="34" stroke="#0af" stroke-width="2"/><circle cx="52" cy="34" r="2.5" fill="#0af"/><line x1="52" y1="34" x2="84" y2="34" stroke="#0af" stroke-width="2"/><text x="42" y="38" font-size="9" fill="#8cf" text-anchor="middle">S</text>' },
    btn: { cn: '按钮', w: 70, h: 34, params: {}, svg: () => '<line x1="0" y1="17" x2="26" y2="17" stroke="#0af" stroke-width="2"/><circle cx="26" cy="17" r="2.5" fill="#0af"/><line x1="50" y1="17" x2="70" y2="17" stroke="#0af" stroke-width="2"/><circle cx="50" cy="17" r="2.5" fill="#0af"/><line x1="26" y1="17" x2="47" y2="9" stroke="#0af" stroke-width="2"/><line x1="47" y1="9" x2="47" y2="0" stroke="#0af" stroke-width="2"/><circle cx="47" cy="0" r="2.2" fill="none" stroke="#0af" stroke-width="2"/><text x="37" y="33" font-size="9" fill="#8cf" text-anchor="middle">SB</text>' },
    cap: { cn: '电容', w: 60, h: 30, params: { C: '100μF' }, svg: (p) => '<line x1="0" y1="15" x2="24" y2="15" stroke="#0af" stroke-width="2"/><line x1="24" y1="4" x2="24" y2="26" stroke="#0af" stroke-width="2"/><line x1="30" y1="4" x2="30" y2="26" stroke="#0af" stroke-width="2"/><line x1="36" y1="15" x2="60" y2="15" stroke="#0af" stroke-width="2"/><text x="45" y="28" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.C)) + '</text>' },
    capP: { cn: '电解电容', w: 60, h: 30, params: { C: '10μF' }, svg: (p) => '<line x1="0" y1="15" x2="24" y2="15" stroke="#0af" stroke-width="2"/><line x1="24" y1="4" x2="24" y2="26" stroke="#0af" stroke-width="2"/><line x1="30" y1="4" x2="30" y2="26" stroke="#0af" stroke-width="2"/><line x1="36" y1="15" x2="60" y2="15" stroke="#0af" stroke-width="2"/><text x="17" y="11" font-size="8" fill="#f66">+</text><text x="45" y="28" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.C)) + '</text>' },
    ind: { cn: '电感', w: 64, h: 30, params: { L: '0.5H' }, svg: (p) => '<line x1="0" y1="15" x2="10" y2="15" stroke="#0af" stroke-width="2"/><path d="M10 15 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0" fill="none" stroke="#0af" stroke-width="2"/><line x1="58" y1="15" x2="64" y2="15" stroke="#0af" stroke-width="2"/><text x="35" y="28" font-size="9" fill="#8cf" text-anchor="middle">' + escT(fmtL(p.L)) + '</text>' },
    trafo: { cn: '变压器', w: 80, h: 44, params: {}, svg: () => '<line x1="0" y1="10" x2="20" y2="10" stroke="#0af" stroke-width="2"/><path d="M20 10 a7 7 0 0 1 14 0 a7 7 0 0 1 14 0 a7 7 0 0 1 14 0" fill="none" stroke="#0af" stroke-width="2"/><line x1="62" y1="10" x2="80" y2="10" stroke="#0af" stroke-width="2"/><line x1="0" y1="36" x2="20" y2="36" stroke="#0af" stroke-width="2"/><path d="M20 36 a7 7 0 0 1 14 0 a7 7 0 0 1 14 0 a7 7 0 0 1 14 0" fill="none" stroke="#0af" stroke-width="2"/><line x1="62" y1="36" x2="80" y2="36" stroke="#0af" stroke-width="2"/><line x1="40" y1="19" x2="40" y2="27" stroke="#0af" stroke-width="2"/><text x="40" y="24" font-size="9" fill="#8cf" text-anchor="middle">T</text>' },
    di: { cn: '二极管', w: 64, h: 30, params: {}, svg: () => '<line x1="0" y1="15" x2="20" y2="15" stroke="#0af" stroke-width="2"/><polygon points="20,4 36,15 20,26" fill="#0af"/><line x1="36" y1="4" x2="36" y2="26" stroke="#0af" stroke-width="2"/><line x1="36" y1="15" x2="64" y2="15" stroke="#0af" stroke-width="2"/><text x="22" y="11" font-size="8" fill="#8cf">D</text>' },
    led: { cn: 'LED', w: 70, h: 34, params: {}, svg: () => '<line x1="0" y1="17" x2="20" y2="17" stroke="#0af" stroke-width="2"/><polygon points="20,6 36,17 20,28" fill="#0af"/><line x1="36" y1="6" x2="36" y2="28" stroke="#0af" stroke-width="2"/><line x1="36" y1="17" x2="44" y2="17" stroke="#0af" stroke-width="2"/><path d="M48 8 l5 5 M53 8 l-5 5 M56 20 l6 6 M62 20 l-6 6" stroke="#ffd54a" stroke-width="1.5" fill="none"/><text x="20" y="13" font-size="8" fill="#8cf">D</text>' },
    zd: { cn: '稳压管', w: 64, h: 32, params: {}, svg: () => '<line x1="0" y1="16" x2="20" y2="16" stroke="#0af" stroke-width="2"/><polygon points="20,5 36,16 20,27" fill="#0af"/><line x1="36" y1="5" x2="36" y2="27" stroke="#0af" stroke-width="2"/><line x1="36" y1="16" x2="64" y2="16" stroke="#0af" stroke-width="2"/><line x1="36" y1="27" x2="28" y2="27" stroke="#0af" stroke-width="2"/><text x="22" y="12" font-size="8" fill="#8cf">D</text>' },
    npn: { cn: 'NPN三极管', w: 74, h: 52, params: {}, svg: () => '<line x1="0" y1="8" x2="22" y2="8" stroke="#0af" stroke-width="2"/><circle cx="26" cy="8" r="4" fill="none" stroke="#0af" stroke-width="2"/><line x1="22" y1="8" x2="40" y2="26" stroke="#0af" stroke-width="2"/><line x1="26" y1="12" x2="44" y2="26" stroke="#0af" stroke-width="2"/><line x1="18" y1="42" x2="40" y2="26" stroke="#0af" stroke-width="2"/><line x1="18" y1="42" x2="74" y2="42" stroke="#0af" stroke-width="2"/><path d="M40 26 l8 8 M48 26 l-8 8" stroke="#0af" stroke-width="1.5" fill="none"/><text x="46" y="20" font-size="9" fill="#8cf">B</text><text x="60" y="42" font-size="9" fill="#8cf">E</text><text x="6" y="50" font-size="9" fill="#8cf">C</text>' },
    pnp: { cn: 'PNP三极管', w: 74, h: 52, params: {}, svg: () => '<line x1="0" y1="8" x2="22" y2="8" stroke="#0af" stroke-width="2"/><circle cx="26" cy="8" r="4" fill="none" stroke="#0af" stroke-width="2"/><line x1="22" y1="8" x2="40" y2="26" stroke="#0af" stroke-width="2"/><line x1="26" y1="12" x2="44" y2="26" stroke="#0af" stroke-width="2"/><line x1="18" y1="42" x2="40" y2="26" stroke="#0af" stroke-width="2"/><line x1="18" y1="42" x2="74" y2="42" stroke="#0af" stroke-width="2"/><path d="M40 22 l8 8 M48 22 l-8 8" stroke="#0af" stroke-width="1.5" fill="none"/><text x="46" y="18" font-size="9" fill="#8cf">B</text><text x="60" y="42" font-size="9" fill="#8cf">E</text><text x="6" y="50" font-size="9" fill="#8cf">C</text>' },
    motor: { cn: '电动机', w: 64, h: 40, params: {}, svg: () => '<line x1="0" y1="20" x2="14" y2="20" stroke="#0af" stroke-width="2"/><circle cx="30" cy="20" r="16" fill="none" stroke="#0af" stroke-width="2"/><text x="30" y="24" font-size="12" fill="#8cf" text-anchor="middle">M</text><line x1="46" y1="20" x2="64" y2="20" stroke="#0af" stroke-width="2"/>' },
    vm: { cn: '电压表', w: 64, h: 40, params: {}, svg: () => '<line x1="0" y1="20" x2="14" y2="20" stroke="#0af" stroke-width="2"/><circle cx="30" cy="20" r="16" fill="none" stroke="#0af" stroke-width="2"/><text x="30" y="25" font-size="13" fill="#8cf" text-anchor="middle">V</text><line x1="46" y1="20" x2="64" y2="20" stroke="#0af" stroke-width="2"/>' },
    am: { cn: '电流表', w: 64, h: 40, params: {}, svg: () => '<line x1="0" y1="20" x2="14" y2="20" stroke="#0af" stroke-width="2"/><circle cx="30" cy="20" r="16" fill="none" stroke="#0af" stroke-width="2"/><text x="30" y="25" font-size="13" fill="#8cf" text-anchor="middle">A</text><line x1="46" y1="20" x2="64" y2="20" stroke="#0af" stroke-width="2"/>' },
    fuse: { cn: '熔断器', w: 64, h: 28, params: {}, svg: () => '<line x1="0" y1="14" x2="22" y2="14" stroke="#0af" stroke-width="2"/><rect x="22" y="8" width="20" height="12" fill="none" stroke="#0af" stroke-width="2"/><line x1="42" y1="14" x2="64" y2="14" stroke="#0af" stroke-width="2"/><text x="32" y="26" font-size="9" fill="#8cf" text-anchor="middle">FU</text>' },
    gnd: { cn: '接地', w: 60, h: 36, params: {}, svg: () => '<line x1="30" y1="0" x2="30" y2="10" stroke="#0af" stroke-width="2"/><line x1="10" y1="14" x2="50" y2="14" stroke="#0af" stroke-width="2"/><line x1="18" y1="22" x2="42" y2="22" stroke="#0af" stroke-width="2"/><line x1="26" y1="30" x2="34" y2="30" stroke="#0af" stroke-width="2"/>' },
    spk: { cn: '扬声器', w: 64, h: 40, params: {}, svg: () => '<line x1="0" y1="20" x2="14" y2="20" stroke="#0af" stroke-width="2"/><path d="M14 20 l10 -8 v16 z" fill="#0af" opacity=".85"/><path d="M30 12 a12 12 0 0 1 0 16 M36 7 a20 20 0 0 1 0 26" fill="none" stroke="#0af" stroke-width="2"/><text x="50" y="38" font-size="9" fill="#8cf">BL</text>' },
    buzz: { cn: '蜂鸣器', w: 64, h: 40, params: {}, svg: () => '<line x1="0" y1="20" x2="14" y2="20" stroke="#0af" stroke-width="2"/><path d="M14 20 l10 -8 v16 z" fill="#0af" opacity=".85"/><text x="28" y="25" font-size="10" fill="#8cf">♪</text><line x1="46" y1="20" x2="64" y2="20" stroke="#0af" stroke-width="2"/>' },
    ant: { cn: '天线', w: 60, h: 44, params: {}, svg: () => '<line x1="30" y1="0" x2="30" y2="30" stroke="#0af" stroke-width="2"/><line x1="30" y1="0" x2="44" y2="10" stroke="#0af" stroke-width="2"/><line x1="30" y1="30" x2="30" y2="44" stroke="#0af" stroke-width="2"/>' }
  };
  const GROUPS = [
    { g: '电源', list: ['battery', 'dc', 'ac'] },
    { g: '电阻类', list: ['res', 'rvar', 'pot'] },
    { g: '开关/保护', list: ['sw', 'sw2', 'btn', 'fuse'] },
    { g: '储能元件', list: ['cap', 'capP', 'ind', 'trafo'] },
    { g: '半导体', list: ['di', 'led', 'zd', 'npn', 'pnp'] },
    { g: '电机/电器', list: ['motor', 'spk', 'buzz', 'lamp', 'ant'] },
    { g: '仪表/其他', list: ['vm', 'am', 'gnd'] }
  ];

  function escT(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /* V1.5.5.0：数字转 Unicode 下标（R1 → R₁，支持 R12 → R₁₂） */
  const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
  function subNum(s) { return String(s).replace(/[0-9]/g, (c) => SUB[+c]); }
  /* 元件标注：把 "R1=6Ω" 渲染为 "R₁=6Ω"（字母后数字下标化） */
  function fmtL(s) { return String(s == null ? '' : s).replace(/([A-Za-z])(\d+)/g, (m, a, b) => a + subNum(b)); }

  /* ---------- SVG 白名单清洗（防 XSS，前端版本） ---------- */
  const SVG_TAGS = ['svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'tspan', 'ellipse', 'defs', 'marker', 'use', 'title', 'desc'];
  const SVG_ATTRS = ['viewBox', 'width', 'height', 'xmlns', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'transform', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'class', 'id', 'data-i', 'data-t', 'data-p', 'opacity', 'style', 'preserveAspectRatio'];
  function cleanSvg(svg) {
    if (!svg || typeof svg !== 'string') return '';
    try {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      if (doc.getElementsByTagName('parsererror').length) return '';
      const root = doc.documentElement;
      if (!root || root.tagName.toLowerCase() !== 'svg') return '';
      const walk = (el) => {
        const kids = Array.from(el.childNodes);
        for (const k of kids) {
          if (k.nodeType === 1) {
            const tag = k.tagName.toLowerCase();
            if (!SVG_TAGS.includes(tag) || /^on/i.test(tag)) { el.removeChild(k); continue; }
            for (const a of Array.from(k.attributes)) {
              const n = a.name.toLowerCase();
              if (!SVG_ATTRS.includes(n) && !/^aria-/.test(n) && !/^data-/.test(n)) { k.removeAttribute(a.name); }
              else if (/^on/i.test(n)) { k.removeAttribute(a.name); }
              else if (n === 'href' || n === 'xlink:href') { k.removeAttribute(a.name); }
            }
            if (tag === 'text' || tag === 'tspan') {
              for (const c of Array.from(k.childNodes)) if (c.nodeType === 8) k.removeChild(c);
            }
            walk(k);
          }
        }
      };
      walk(root);
      for (const a of Array.from(root.attributes)) {
        const n = a.name.toLowerCase();
        if (!SVG_ATTRS.includes(n) || /^on/i.test(n)) root.removeAttribute(a.name);
      }
      return new XMLSerializer().serializeToString(root);
    } catch (e) { return ''; }
  }

  /* ---------- 编辑器 ---------- */
  let editor = null;
  class Editor {
    constructor(container, initSvg) {
      this.root = container;
      this.W = 860; this.H = 500;
      this.items = []; this.wires = []; this.notes = []; this.volts = []; this.sel = null; this.mode = 'select';
      this.wireFrom = null; this.undoStack = []; this.redoStack = [];
      this._id = 0; this.pinR = 5;
      this._drag = null; this._dragV = null; this._dragWp = null; this._voltA = null; this._touching = null;
      this._render(); this._bind();
      if (initSvg) this.import(initSvg);
      else this._demo();
    }
    _demo() {
      // 默认空画布；放一个电源+电阻示例便于上手
    }
    _newId() { return 'it' + (++this._id); }
    _render() {
      this.root.innerHTML = '';
      const bar = document.createElement('div');
      bar.className = 'circ-bar';
      bar.innerHTML =
        '<span class="circ-mode" style="font-weight:600">电路图编辑器</span>' +
        '<button type="button" class="btn small" data-tool="select">🖱 选择</button>' +
        '<button type="button" class="btn small" data-tool="wire">🔗 连线</button>' +
        '<button type="button" class="btn small" data-tool="note">💡 电位标注</button>' +
        '<button type="button" class="btn small" data-tool="volt">⚡ 电压标注</button>' +
        '<button type="button" class="btn small" data-act="rot">↻ 旋转(R)</button>' +
        '<button type="button" class="btn small" data-act="del">🗑 删除(Del)</button>' +
        '<button type="button" class="btn small" data-act="undo">↩ 撤销</button>' +
        '<button type="button" class="btn small" data-act="redo">↪ 重做</button>' +
        '<button type="button" class="btn small" data-act="clear">清空</button>' +
        '<span style="flex:1"></span>' +
        '<span class="circ-hint" style="font-size:11px;color:var(--dim)">' +
          '<button type="button" class="btn small" data-act="scale-dn" title="选中元件缩小 25%">🔍−</button>' +
          '<button type="button" class="btn small" data-act="scale-up" title="选中元件放大 25%">🔍+</button>' +
          '<button type="button" class="btn small" data-act="csize-dn" title="画布缩小">📐−</button>' +
          '<span id="circ-size" style="font-size:11px;color:var(--dim)">' + this.W + '×' + this.H + '</span>' +
          '<button type="button" class="btn small" data-act="csize-up" title="画布放大">📐+</button>' +
        '</span>' +
        '<span class="circ-hint" style="font-size:11px;color:var(--dim)">拖拽移动 · 双击改参数 · 连线模式点击两引脚画导线 · 💡模式点击画布空白处添加电位标注</span>';
      this.root.appendChild(bar);
      const wrap = document.createElement('div');
      wrap.className = 'circ-wrap';
      wrap.innerHTML = '<div class="circ-palette"></div><div class="circ-canvas-box"><svg class="circ-canvas" width="' + this.W + '" height="' + this.H + '" viewBox="0 0 ' + this.W + ' ' + this.H + '" style="width:' + this.W + 'px;height:' + this.H + 'px;max-width:none"></svg></div><div class="circ-tip">' + (this.mode === 'wire' ? '连线模式：点击起始引脚 → 点击目标引脚' : (this.mode === 'note' ? '电位标注模式：点击画布空白处添加电位标注（如 VA、+6V、0V），双击标注可修改文字' : (this.mode === 'volt' ? '电压标注模式：点击第一个端点 → 点击第二个端点，生成 +/− 电压标注；双击中间文字改电压值' : '点击左侧元件添加到画布；选中后 R 旋转 / Del 删除 / 双击改参数 / 🔍+/− 缩放 / 按住 Shift 拖动锁定水平竖直'))) + '</div>';
      this.root.appendChild(wrap);
      this.svg = wrap.querySelector('.circ-canvas');
      this.palette = wrap.querySelector('.circ-palette');
      this.tip = wrap.querySelector('.circ-tip');
      this._renderPalette();
      this._svgNS = 'http://www.w3.org/2000/svg';
    }
    _renderPalette() {
      let h = '';
      GROUPS.forEach(gp => {
        h += '<div class="circ-gp">' + gp.g + '</div>';
        gp.list.forEach(t => { const d = DEFS[t]; h += '<div class="circ-pal-item" data-type="' + t + '" title="' + d.cn + '"><svg width="64" height="30" viewBox="0 0 70 30">' + d.svg({}) + '</svg><span>' + d.cn + '</span></div>'; });
      });
      this.palette.innerHTML = h;
    }
    _bind() {
      const root = this.root;
      root.addEventListener('click', (e) => {
        const pal = e.target.closest('.circ-pal-item');
        if (pal) { this._add(pal.dataset.type); return; }
        const tool = e.target.closest('[data-tool]');
        if (tool) { this.mode = tool.dataset.tool; this._syncMode(); return; }
        const act = e.target.closest('[data-act]');
        if (act) { const a = act.dataset.act; if (a === 'rot') this.rotate(); else if (a === 'del') this.delSel(); else if (a === 'undo') this.undo(); else if (a === 'redo') this.redo(); else if (a === 'clear') this.clearAll(); else if (a === 'scale-up') this._scaleSel(1.25); else if (a === 'scale-dn') this._scaleSel(0.8); else if (a === 'csize-up') this._resizeCanvas(40, 40); else if (a === 'csize-dn') this._resizeCanvas(-40, -40); return; }
      });
      root.addEventListener('dblclick', (e) => {
        const g = e.target.closest('[data-i]');
        if (g) { const it = this.items.find(x => x.id === g.dataset.i); if (it) this._editParams(it); return; }
        const n = e.target.closest('[data-n]');
        if (n) { this._editNote(n.dataset.n); return; }
        /* V1.5.7.0：电压标注（双击符号切换 +/−，双击文字改电压值） */
        const vg = e.target.closest('[data-v]');
        if (vg) {
          const vo = this.volts.find(x => x.id === vg.dataset.v);
          if (!vo) return;
          const vs = e.target.closest('[data-vs]');
          if (vs) {
            this._push();
            if (vs.dataset.vs === 'a') vo.signA = vo.signA === '+' ? '−' : '+';
            else vo.signB = vo.signB === '−' ? '+' : '−';
            this._draw(); return;
          }
          const v = prompt('两点间电压文字（如 VAB、U=220V、V₁₂=6V）：', vo.text);
          if (v === null) return;
          this._push();
          vo.text = v.trim() || 'VAB';
          this._draw();
        }
      });
      // 画布鼠标交互（mousedown 在 svg 上捕获 target 元素）
      this.svg.addEventListener('mousedown', (e) => this._onDown(e));
      window.addEventListener('mousemove', (e) => this._onMove(e));
      window.addEventListener('mouseup', () => this._onUp());
      root.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; this._touching = { x: t.clientX, y: t.clientY }; const el = document.elementFromPoint(t.clientX, t.clientY); if (el) { const g = el.closest('[data-i]'); if (g) this._onDown({ clientX: t.clientX, clientY: t.clientY, target: g, isTouch: true }); } }, { passive: true });
      root.addEventListener('touchmove', (e) => { if (this._touching) { const t = e.changedTouches[0]; this._onMove({ clientX: t.clientX, clientY: t.clientY }); e.preventDefault(); } }, { passive: false });
      root.addEventListener('touchend', () => { this._touching = null; this._onUp(); });
      document.addEventListener('keydown', (e) => {
        if (!editor || !this.root.isConnected) return;
        if (e.key === 'r' || e.key === 'R') { if (document.activeElement && /input|textarea|select/i.test(document.activeElement.tagName)) return; this.rotate(); }
        if (e.key === 'Delete' || e.key === 'Backspace') { if (document.activeElement && /input|textarea|select/i.test(document.activeElement.tagName)) return; this.delSel(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
      });
    }
    _syncMode() {
      this.tip.textContent = this.mode === 'wire' ? '连线模式：点击起始引脚 → 点击目标引脚' : (this.mode === 'note' ? '电位标注模式：点击画布空白处添加电位标注（如 VA、+6V、0V），双击标注可修改文字' : (this.mode === 'volt' ? '电压标注模式：点击第一个端点 → 点击第二个端点，生成 +/− 电压标注；双击中间文字改电压值' : '点击左侧元件添加到画布；选中后 R 旋转 / Del 删除 / 双击改参数 / 🔍+/− 缩放 / 按住 Shift 拖动锁定水平竖直'));
      const btns = this.root.querySelectorAll('[data-tool]');
      btns.forEach(b => b.classList.toggle('active', b.dataset.tool === this.mode));
      this.svg.classList.toggle('wire-mode', this.mode === 'wire');
    }
    /* V1.5.6.0：画布尺寸调整（+ 滚动条控制显示区域） */
    _resizeCanvas(dw, dh) {
      this.W = Math.max(400, Math.min(2000, this.W + dw));
      this.H = Math.max(300, Math.min(1500, this.H + dh));
      this.svg.setAttribute('width', this.W);
      this.svg.setAttribute('height', this.H);
      this.svg.setAttribute('viewBox', '0 0 ' + this.W + ' ' + this.H);
      this.svg.style.width = this.W + 'px';
      this.svg.style.height = this.H + 'px';
      const sz = this.root.querySelector('#circ-size');
      if (sz) sz.textContent = this.W + '×' + this.H;
      this._draw();
    }
    /* V1.5.6.0：选中元件缩放（🔍+/−） */
    _scaleSel(k) {
      if (!this.sel || !this.sel.type || !DEFS[this.sel.type]) return;
      this._push();
      this.sel.s = Math.max(0.4, Math.min(3, Math.round(((this.sel.s || 1) * k) * 100) / 100));
      this._draw();
    }
    /* V1.5.6.0：电位标注（两端点电位/节点电位文字） */
    _addNoteAt(x, y) {
      this._push();
      this.notes.push({ id: 'n' + (++this._id), x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, text: 'VA' });
      this._draw();
    }
    _editNote(id) {
      const n = this.notes.find(x => x.id === id);
      if (!n) return;
      const v = prompt('电位标注文字（如 VA、VB、+6V、0V、VAB）：', n.text);
      if (v === null) return;
      this._push();
      n.text = v.trim() || 'VA';
      this._draw();
    }
    /* V1.5.7.0：电压标注图形（两端点 +/−、两条带箭头引线、中间电压文字） */
    _voltMarkup(v, editable) {
      const cx = (v.ax + v.bx) / 2, cy = (v.ay + v.by) / 2;
      const ang = Math.atan2(v.by - v.ay, v.bx - v.ax);
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const px = -uy, py = ux; // 垂直方向
      const L = 46; // 箭头引线长度
      const xa1 = v.ax - ux * L, ya1 = v.ay - uy * L;
      const xb1 = v.bx + ux * L, yb1 = v.by + uy * L;
      const tri = (x1, y1, x2, y2) => {
        const a2 = Math.atan2(y2 - y1, x2 - x1), l = 9;
        return (x2 - l * Math.cos(a2 - 0.35)).toFixed(1) + ',' + (y2 - l * Math.sin(a2 - 0.35)).toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' ' + (x2 - l * Math.cos(a2 + 0.35)).toFixed(1) + ',' + (y2 - l * Math.sin(a2 + 0.35)).toFixed(1);
      };
      const dv = ' data-v="' + v.id + '"';
      const va = editable ? ' data-vp="a"' : '';
      const vb = editable ? ' data-vp="b"' : '';
      const vsa = editable ? ' data-vs="a"' : '';
      const vsb = editable ? ' data-vs="b"' : '';
      const vt = editable ? ' data-vt="1"' : '';
      let s = '';
      s += '<line' + dv + va + ' x1="' + xa1.toFixed(1) + '" y1="' + ya1.toFixed(1) + '" x2="' + v.ax + '" y2="' + v.ay + '" stroke="#f80" stroke-width="2" style="cursor:move"/>';
      s += '<polygon' + dv + va + ' points="' + tri(xa1, ya1, v.ax, v.ay) + '" fill="#f80"/>';
      s += '<line' + dv + vb + ' x1="' + xb1.toFixed(1) + '" y1="' + yb1.toFixed(1) + '" x2="' + v.bx + '" y2="' + v.by + '" stroke="#f80" stroke-width="2" style="cursor:move"/>';
      s += '<polygon' + dv + vb + ' points="' + tri(xb1, yb1, v.bx, v.by) + '" fill="#f80"/>';
      s += '<text' + dv + vsa + ' x="' + (v.ax + 14) + '" y="' + (v.ay - 12) + '" font-size="16" fill="#f80" font-weight="800" style="cursor:pointer;paint-order:stroke;stroke:#fff;stroke-width:3px">' + escT(v.signA) + '</text>';
      s += '<text' + dv + vsb + ' x="' + (v.bx - 22) + '" y="' + (v.by + 26) + '" font-size="16" fill="#f80" font-weight="800" style="cursor:pointer;paint-order:stroke;stroke:#fff;stroke-width:3px">' + escT(v.signB) + '</text>';
      s += '<text' + dv + vt + ' x="' + (cx + px * 26).toFixed(1) + '" y="' + (cy + py * 26 + 5).toFixed(1) + '" font-size="16" fill="#f80" font-weight="700" text-anchor="middle" style="cursor:pointer;paint-order:stroke;stroke:#fff;stroke-width:3px">' + escT(v.text) + '</text>';
      s += '<circle' + dv + va + ' cx="' + v.ax + '" cy="' + v.ay + '" r="4.5" fill="#fff" stroke="#f80" stroke-width="2" style="cursor:move"/>';
      s += '<circle' + dv + vb + ' cx="' + v.bx + '" cy="' + v.by + '" r="4.5" fill="#fff" stroke="#f80" stroke-width="2" style="cursor:move"/>';
      return s;
    }
    _svgPos(e) {
      const r = this.svg.getBoundingClientRect();
      const sx = this.W / r.width, sy = this.H / r.height;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }
    _add(type) {
      const d = DEFS[type];
      const it = { id: this._newId(), type, x: 380, y: 220, rot: 0, s: 1, params: Object.assign({}, d.params) };
      this.items.push(it); this.sel = it; this._snap(); this._draw();
    }
    _snap() { if (this.sel) { this.sel.x = Math.round(this.sel.x / 10) * 10; this.sel.y = Math.round(this.sel.y / 10) * 10; } }
    _pinPos(it, pin) {
      const d = DEFS[it.type];
      const s = it.s || 1;
      let px, py;
      if (pin === 'l') { px = 0; py = (d.h / 2) * s; }
      else if (pin === 'r') { px = d.w * s; py = (d.h / 2) * s; }
      else if (pin === 't') { px = (d.w / 2) * s; py = 0; }
      else { px = (d.w / 2) * s; py = d.h * s; }
      const rad = (it.rot * Math.PI) / 180;
      const cx = (d.w / 2) * s, cy = (d.h / 2) * s;
      const dx = px - cx, dy = py - cy;
      const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
      return { x: it.x + cx + rx, y: it.y + cy + ry };
    }
    _pins(it) {
      const d = DEFS[it.type];
      const names = ['l', 'r'];
      if (it.type === 'npn' || it.type === 'pnp') return ['b', 'c', 'e'].map(n => ({ n, pos: this._pinPos(it, n) }));
      return names.map(n => ({ n, pos: this._pinPos(it, n) }));
    }
    _onDown(e) {
      const t = e.target;
      /* V1.5.7.0：电压标注模式 —— 依次点击两个端点，生成 +/− 电压标注 */
      if (this.mode === 'volt') {
        const vp = t.closest('[data-vp]');
        if (vp) {
          const vo = this.volts.find(x => x.id === vp.dataset.v);
          if (vo) { this._push(); this.sel = { id: vo.id, type: 'volt' }; this._dragV = { id: vo.id, end: vp.dataset.vp }; this._draw(); }
          return;
        }
        const vg = t.closest('[data-v]');
        if (vg) { this.sel = { id: vg.dataset.v, type: 'volt' }; this._dragV = null; this._draw(); return; }
        const p = this._svgPos(e);
        if (!this._voltA) { this._voltA = { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 }; this._draw(); return; }
        this._push();
        this.volts.push({ id: 'v' + (++this._id), ax: this._voltA.x, ay: this._voltA.y, bx: Math.round(p.x / 10) * 10, by: Math.round(p.y / 10) * 10, signA: '+', signB: '−', text: 'VAB' });
        this._voltA = null; this._draw(); return;
      }
      if (this.mode === 'wire') {
        const pin = t.closest('.circ-pin');
        if (pin) {
          const it = this.items.find(x => x.id === pin.dataset.i);
          if (it) {
            if (!this.wireFrom) { this.wireFrom = { item: it.id, pin: pin.dataset.pin }; this._draw(); }
            else {
              const f = this.items.find(x => x.id === this.wireFrom.item);
              if (f && f !== it && this.wireFrom.pin !== pin.dataset.pin) {
                this._push(); this.wires.push({ id: 'w' + (++this._id), a: { item: this.wireFrom.item, pin: this.wireFrom.pin }, b: { item: it.id, pin: pin.dataset.pin }, path: null });
              }
              this.wireFrom = null; this._draw();
            }
          }
          return;
        }
        this.wireFrom = null; this._draw(); return;
      }
      /* V1.5.6.0：电位标注模式 —— 点击画布空白处添加电位标注 */
      if (this.mode === 'note') {
        const hp = t.closest('[data-wp]');
        const wl = t.closest('[data-w]');
        const g = t.closest('[data-i]');
        const np = t.closest('[data-n]');
        if (np) { this.sel = { id: np.dataset.n, type: 'note' }; this._draw(); return; }
        const vg = t.closest('[data-v]');
        if (vg) { this.sel = { id: vg.dataset.v, type: 'volt' }; this._draw(); return; }
        if (hp || wl || g) { this.sel = null; this._draw(); return; }
        const p = this._svgPos(e);
        this._addNoteAt(p.x, p.y);
        return;
      }
      /* V1.5.5.0：导线拐点拖动（手动调节连线） */
      const hp = t.closest('[data-wp]');
      if (hp) {
        const w = this.wires.find(x => x.id === hp.dataset.w);
        if (w) {
          this._push();
          this.sel = w; this._drag = null;
          if (!w.path) { const a = this._pinPos(this.items.find(x => x.id === w.a.item), w.a.pin); const b = this._pinPos(this.items.find(x => x.id === w.b.item), w.b.pin); if (a && b) w.path = this._autoPts(a, b); }
          this._dragWp = { wid: w.id, idx: +hp.dataset.wp, sp: w.path ? [w.path[+hp.dataset.wp][0], w.path[+hp.dataset.wp][1]] : null };
          this._draw();
        }
        return;
      }
      const wl = t.closest('[data-w]');
      if (wl) {
        const w = this.wires.find(x => x.id === wl.dataset.w);
        if (w) { this.sel = w; this._drag = null; this._draw(); }
        return;
      }
      const g = t.closest('[data-i]');
      if (g) {
        const it = this.items.find(x => x.id === g.dataset.i);
        if (it) {
          this.sel = it;
          this._drag = { id: it.id, dx: e.clientX - it.x, dy: e.clientY - it.y, sx: it.x, sy: it.y };
          this._draw();
        }
      } else {
        this.sel = null; this.wireFrom = null; this._draw();
      }
    }
    _autoPts(a, b) {
      return [[a.x, a.y], [Math.round((a.x + b.x) / 20) * 10, b.y], [b.x, b.y]];
    }
    _onMove(e) {
      /* V1.5.7.0：电压标注端点拖动 */
      if (this._dragV) {
        const vo = this.volts.find(x => x.id === this._dragV.id);
        if (vo) {
          const p = this._svgPos(e);
          const nx = Math.round(p.x / 10) * 10, ny = Math.round(p.y / 10) * 10;
          if (this._dragV.end === 'a') { vo.ax = nx; vo.ay = ny; }
          else { vo.bx = nx; vo.by = ny; }
          this._draw();
        }
        return;
      }
      if (this._dragWp) {
        const w = this.wires.find(x => x.id === this._dragWp.wid);
        if (w && w.path) {
          const p = this._svgPos(e);
          let nx = Math.round(p.x / 10) * 10, ny = Math.round(p.y / 10) * 10;
          /* V1.5.7.0：Shift 锁定拐点沿水平或竖直延伸 */
          if (e.shiftKey && this._dragWp.sp) {
            const dxm = nx - this._dragWp.sp[0], dym = ny - this._dragWp.sp[1];
            if (Math.abs(dxm) >= Math.abs(dym)) ny = this._dragWp.sp[1];
            else nx = this._dragWp.sp[0];
          }
          w.path[this._dragWp.idx] = [nx, ny];
          this._draw();
        }
        return;
      }
      if (!this._drag) return;
      const it = this.items.find(x => x.id === this._drag.id);
      if (!it) return;
      const p = this._svgPos(e);
      let nx = p.x - this._drag.dx, ny = p.y - this._drag.dy;
      /* V1.5.7.0：Shift 锁定元件沿水平或竖直移动 */
      if (e.shiftKey) {
        const dxm = nx - this._drag.sx, dym = ny - this._drag.sy;
        if (Math.abs(dxm) >= Math.abs(dym)) ny = this._drag.sy;
        else nx = this._drag.sx;
        nx = Math.round(nx / 10) * 10; ny = Math.round(ny / 10) * 10;
      }
      it.x = nx; it.y = ny;
      this._draw();
    }
    _onUp() { this._drag = null; this._dragV = null; this._dragWp = null; this._voltA = null; }
    _push() {
      this.undoStack.push(JSON.stringify({ items: this.items, wires: this.wires, notes: this.notes, volts: this.volts }));
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
    }
    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(JSON.stringify({ items: this.items, wires: this.wires, notes: this.notes, volts: this.volts }));
      const s = JSON.parse(this.undoStack.pop());
      this.items = s.items; this.wires = s.wires; this.notes = s.notes || []; this.volts = s.volts || []; this.sel = null; this._draw();
    }
    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(JSON.stringify({ items: this.items, wires: this.wires, notes: this.notes, volts: this.volts }));
      const s = JSON.parse(this.redoStack.pop());
      this.items = s.items; this.wires = s.wires; this.notes = s.notes || []; this.volts = s.volts || []; this.sel = null; this._draw();
    }
    rotate() { if (!this.sel) return; this._push(); this.sel.rot = (this.sel.rot + 90) % 360; this._draw(); }
    delSel() {
      if (!this.sel) return;
      this._push();
      const sid = String(this.sel.id || '');
      if (sid.indexOf('w') === 0) {
        /* V1.5.5.0：删除选中导线 */
        this.wires = this.wires.filter(w => w.id !== this.sel.id);
      } else if (sid.indexOf('n') === 0) {
        /* V1.5.6.0：删除电位标注 */
        this.notes = this.notes.filter(x => x.id !== this.sel.id);
      } else if (sid.indexOf('v') === 0) {
        /* V1.5.7.0：删除电压标注 */
        this.volts = this.volts.filter(x => x.id !== this.sel.id);
      } else {
        const id = this.sel.id;
        this.items = this.items.filter(x => x.id !== id);
        this.wires = this.wires.filter(w => w.a.item !== id && w.b.item !== id);
      }
      this.sel = null; this._draw();
    }
    clearAll() { if (!this.items.length && !this.notes.length && !this.volts.length) return; this._push(); this.items = []; this.wires = []; this.notes = []; this.volts = []; this.sel = null; this.wireFrom = null; this._draw(); }
    _editParams(it) {
      const d = DEFS[it.type];
      const keys = Object.keys(d.params || {});
      if (!keys.length) return;
      let body = '';
      keys.forEach(k => {
        const label = { V: '电压', R: '阻值', C: '容量', L: '电感', closed: '闭合' }[k] || k;
        body += '<div style="margin:6px 0"><label style="font-size:12px;color:var(--dim)">' + label + '</label><input id="cp-' + k + '" value="' + escT(it.params[k]) + '" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--line);background:rgba(4,10,30,.7);color:var(--text)"></div>';
      });
      const modal = document.createElement('div');
      modal.className = 'modal-mask';
      modal.innerHTML = '<div class="modal" style="max-width:360px"><h3 style="margin-bottom:10px">' + d.cn + ' 参数</h3>' + body + '<div class="result-btns"><button class="btn ghost" data-c="cancel">取消</button><button class="btn primary" data-c="ok">确定</button></div></div>';
      document.body.appendChild(modal);
      const ok = () => {
        keys.forEach(k => { const el = $('cp-' + k); if (el) it.params[k] = el.value; });
        document.body.removeChild(modal); this._draw();
      };
      modal.querySelector('[data-c="cancel"]').onclick = () => document.body.removeChild(modal);
      modal.querySelector('[data-c="ok"]').onclick = ok;
      const f = modal.querySelector('input'); if (f) f.focus();
    }
    _draw() {
      if (!this.svg) return;
      let s = '';
      // 网格
      s += '<defs><pattern id="circgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(120,160,255,.08)" stroke-width="1"/></pattern></defs>';
      s += '<rect width="' + this.W + '" height="' + this.H + '" fill="url(#circgrid)"/>';
      // 导线（V1.5.5.0：支持手动调节折线拐点）
      this.wires.forEach(w => {
        const a = this._pinPos(this.items.find(x => x.id === w.a.item), w.a.pin);
        const b = this._pinPos(this.items.find(x => x.id === w.b.item), w.b.pin);
        if (!a || !b) return;
        if (w.path) { w.path[0] = [a.x, a.y]; w.path[w.path.length - 1] = [b.x, b.y]; }
        const sel = this.sel && this.sel.id === w.id;
        let d;
        if (w.path) {
          d = 'M' + w.path[0][0] + ' ' + w.path[0][1];
          for (let i = 1; i < w.path.length; i++) d += ' L' + w.path[i][0] + ' ' + w.path[i][1];
        } else {
          const mx = (a.x + b.x) / 2;
          d = 'M' + a.x + ' ' + a.y + ' H' + mx + ' V' + b.y + ' H' + b.x;
        }
        s += '<path d="' + d + '" fill="none" stroke="#0af" stroke-width="' + (sel ? 3.2 : 2) + '" data-w="' + w.id + '" style="cursor:pointer"/>';
        if (sel) {
          const pts = w.path || this._autoPts(a, b);
          for (let i = 1; i < pts.length - 1; i++) {
            s += '<circle class="circ-wp" data-w="' + w.id + '" data-wp="' + i + '" cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="5" fill="#ffb43c" stroke="#fff" stroke-width="1.5" style="cursor:move"/>';
          }
        }
      });
      // 连线起点高亮
      if (this.wireFrom) {
        const it = this.items.find(x => x.id === this.wireFrom.item);
        if (it) { const p = this._pinPos(it, this.wireFrom.pin); s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="7" fill="rgba(255,180,60,.5)"/>'; }
      }
      // 元件（V1.5.6.0：支持元件缩放 scale(s)，引脚置于缩放外层）
      this.items.forEach(it => {
        const d = DEFS[it.type];
        const sel = this.sel && this.sel.id === it.id;
        const sc = it.s || 1;
        s += '<g data-i="' + it.id + '" data-t="' + it.type + '" data-s="' + sc + '" transform="translate(' + it.x + ',' + it.y + ') scale(' + sc + ')" class="' + (sel ? 'circ-sel' : '') + '" style="cursor:move"><g transform="rotate(' + it.rot + ' ' + d.w / 2 + ' ' + d.h / 2 + ')">' + d.svg(it.params) + '</g></g>';
        // 引脚（可连线目标，坐标已含缩放）
        const pins = this._pins(it);
        s += pins.map(p => '<circle class="circ-pin" data-i="' + it.id + '" data-pin="' + p.n + '" cx="' + p.pos.x + '" cy="' + p.pos.y + '" r="' + this.pinR + '" fill="' + (this.mode === 'wire' ? '#ffb43c' : '#1a3a66') + '" stroke="#0af" stroke-width="1"/>').join('');
      });
      // 电位标注（V1.5.6.0：两端点电位 / 节点电位文字）
      this.notes.forEach(n => {
        s += '<g data-n="' + n.id + '" transform="translate(' + n.x + ',' + n.y + ')" style="cursor:pointer"><circle cx="0" cy="0" r="3.5" fill="#f80"/><text x="8" y="4" font-size="15" fill="#f80" font-weight="700" style="paint-order:stroke;stroke:#fff;stroke-width:3px">' + escT(n.text) + '</text></g>';
      });
      // 电压标注（V1.5.7.0：两端点 +/−、两条带箭头引线、中间电压）
      this.volts.forEach(v => {
        s += '<g data-v="' + v.id + '">' + this._voltMarkup(v, true) + '</g>';
      });
      // 选中框（元件；导线用拐点手柄表示）
      if (this.sel && this.sel.type && DEFS[this.sel.type]) {
        const d = DEFS[this.sel.type];
        const sc = this.sel.s || 1;
        s += '<rect x="' + (this.sel.x - 8) + '" y="' + (this.sel.y - 8) + '" width="' + (d.w * sc + 16) + '" height="' + (d.h * sc + 16) + '" fill="none" stroke="#ffb43c" stroke-width="1.5" stroke-dasharray="4 3" pointer-events="none"/>';
      }
      this.svg.innerHTML = s;
    }
    export() {
      // 导出完整 SVG（供渲染与存储）
      let body = '';
      // 导线（含手动调节的折线拐点）
      this.wires.forEach(w => {
        const a = this._pinPos(this.items.find(x => x.id === w.a.item), w.a.pin);
        const b = this._pinPos(this.items.find(x => x.id === w.b.item), w.b.pin);
        if (!a || !b) return;
        let d;
        if (w.path) {
          const pts = w.path.map(p => p.slice());
          pts[0] = [a.x, a.y]; pts[pts.length - 1] = [b.x, b.y];
          d = 'M' + pts.map(p => p.join(' ')).join(' L');
        } else {
          const mx = (a.x + b.x) / 2;
          d = 'M' + a.x + ' ' + a.y + ' H' + mx + ' V' + b.y + ' H' + b.x;
        }
        body += '<path d="' + d + '" fill="none" stroke="#0af" stroke-width="2" data-w="' + w.id + '"/>';
      });
      this.items.forEach(it => {
        const d = DEFS[it.type];
        const sc = it.s || 1;
        body += '<g data-i="' + it.id + '" data-t="' + it.type + '" data-s="' + sc + '" data-p="' + escT(JSON.stringify(it.params)) + '" transform="translate(' + it.x + ',' + it.y + ') scale(' + sc + ')"><g transform="rotate(' + it.rot + ' ' + d.w / 2 + ' ' + d.h / 2 + ')">' + d.svg(it.params) + '</g></g>';
      });
      // 电位标注（V1.5.6.0）
      this.notes.forEach(n => {
        body += '<g data-n="' + n.id + '" transform="translate(' + n.x + ',' + n.y + ')"><circle cx="0" cy="0" r="3.5" fill="#f80"/><text x="8" y="4" font-size="15" fill="#f80" font-weight="700">' + escT(n.text) + '</text></g>';
      });
      // 电压标注（V1.5.7.0：数据属性 + 静态图形，渲染端/试卷直接可见）
      this.volts.forEach(v => {
        body += '<g data-v="' + v.id + '" data-va="' + v.ax + ',' + v.ay + '" data-vb="' + v.bx + ',' + v.by + '" data-vs="' + escT(v.signA + ',' + v.signB) + '" data-vt="' + escT(v.text) + '">' + this._voltMarkup(v, false) + '</g>';
      });
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + this.W + ' ' + this.H + '" width="' + this.W + '" height="' + this.H + '" class="circ-svg">' + body + '</svg>';
    }
    import(svg) {
      try {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        this.items = []; this.wires = [];
        /* V1.5.6.0：从 SVG viewBox 恢复画布尺寸 */
        const vb = (doc.documentElement.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
        if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { this.W = vb[2]; this.H = vb[3]; }
        this.svg.setAttribute('width', this.W);
        this.svg.setAttribute('height', this.H);
        this.svg.setAttribute('viewBox', '0 0 ' + this.W + ' ' + this.H);
        this.svg.style.width = this.W + 'px';
        this.svg.style.height = this.H + 'px';
        const szEl = this.root.querySelector('#circ-size');
        if (szEl) szEl.textContent = this.W + '×' + this.H;
        const groups = doc.getElementsByTagName('g');
        for (const g of Array.from(groups)) {
          const t = g.getAttribute('data-t');
          if (!t || !DEFS[t]) continue;
          const tr = g.getAttribute('transform') || '';
          let tx = 0, ty = 0, rot = 0, sc = 1;
          const m = tr.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/);
          if (m) { tx = parseFloat(m[1]); ty = parseFloat(m[2]); }
          const ms = tr.match(/scale\(([-\d.]+)/);
          if (ms) sc = parseFloat(ms[1]);
          // V1.5.6.0：旋转在缩放内层 g（兼容旧版无内层 g 时从外层解析）
          const innerG = g.querySelector('g');
          if (innerG) {
            const mr2 = (innerG.getAttribute('transform') || '').match(/rotate\(([-\d.]+)/);
            if (mr2) rot = parseFloat(mr2[1]);
          } else {
            const mr = tr.match(/rotate\(([-\d.]+)/);
            if (mr) rot = parseFloat(mr[1]);
          }
          let params = {};
          try { params = JSON.parse(g.getAttribute('data-p') || '{}'); } catch (e) {}
          this.items.push({ id: g.getAttribute('data-i') || this._newId(), type: t, x: tx, y: ty, rot: rot || 0, s: sc || 1, params });
        }
        // 电位标注（V1.5.6.0）
        this.notes = [];
        for (const g of Array.from(groups)) {
          const nid = g.getAttribute('data-n');
          if (!nid) continue;
          const tr = g.getAttribute('transform') || '';
          const m = tr.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/);
          if (!m) continue;
          const txt = g.querySelector('text');
          this.notes.push({ id: nid, x: parseFloat(m[1]), y: parseFloat(m[2]), text: txt ? txt.textContent : 'VA' });
        }
        // 电压标注（V1.5.7.0）
        this.volts = [];
        for (const g of Array.from(groups)) {
          const vid = g.getAttribute('data-v');
          if (!vid) continue;
          const va = (g.getAttribute('data-va') || '0,0').split(',').map(Number);
          const vb = (g.getAttribute('data-vb') || '0,0').split(',').map(Number);
          const vs = (g.getAttribute('data-vs') || '+,−').split(',');
          this.volts.push({ id: vid, ax: va[0], ay: va[1], bx: vb[0], by: vb[1], signA: vs[0] || '+', signB: vs[1] || '−', text: g.getAttribute('data-vt') || 'VAB' });
        }
        const paths = doc.getElementsByTagName('path');
        // 导线：恢复手动调节的折线（data-w 带 path）或旧 H-V-H 格式
        for (const p of Array.from(paths)) {
          if (p.parentElement && p.parentElement.tagName === 'g') continue;
          const d = p.getAttribute('d') || '';
          let pts = [];
          const mm = d.match(/M([-\d.]+) ([-\d.]+)/);
          if (mm) pts.push([parseFloat(mm[1]), parseFloat(mm[2])]);
          const ls = d.matchAll(/L([-\d.]+) ([-\d.]+)/g);
          for (const l of Array.from(ls)) pts.push([parseFloat(l[1]), parseFloat(l[2])]);
          if (pts.length >= 2) {
            const a = this._findPinAt(pts[0][0], pts[0][1]);
            const b = this._findPinAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
            if (a && b) {
              const wid = p.getAttribute('data-w') || ('w' + (++this._id));
              this.wires.push({ id: wid, a: { item: a.item, pin: a.pin }, b: { item: b.item, pin: b.pin }, path: pts });
            }
          } else {
            const mm2 = d.match(/^M([-\d.]+) ([-\d.]+) H([-\d.]+) V([-\d.]+) H([-\d.]+)/);
            if (mm2) {
              const a = this._findPinAt(parseFloat(mm2[1]), parseFloat(mm2[2]));
              const b = this._findPinAt(parseFloat(mm2[5]), parseFloat(mm2[4]));
              if (a && b) this.wires.push({ id: 'w' + (++this._id), a: { item: a.item, pin: a.pin }, b: { item: b.item, pin: b.pin }, path: null });
            }
          }
        }
        this._draw();
      } catch (e) { this.items = []; this.wires = []; this._draw(); }
    }
    _findItemAt(x, y) {
      for (const it of this.items) {
        const d = DEFS[it.type];
        const cxp = it.x + d.w / 2, cyp = it.y + d.h / 2;
        const dx = x - cxp, dy = y - cyp;
        if (dx * dx + dy * dy < 900) return it;
      }
      return null;
    }
    /* V1.5.5.0：按引脚精确匹配导线端点（恢复导入用） */
    _findPinAt(x, y) {
      let best = null, bd = 1e9;
      for (const it of this.items) {
        for (const p of this._pins(it)) {
          const dx = x - p.pos.x, dy = y - p.pos.y, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = { item: it.id, pin: p.n }; }
        }
      }
      return bd < 625 ? best : null; // 半径 25px 内
    }
    svgEl() { return this.svg; }
  }

  /* ---------- 本地规则引擎：题干 → 自动生成电路图 ---------- */
  function autoFromText(text) {
    const t = String(text || '');
    const E = [];
    // 提取元件与参数：R1=10Ω / R2=20Ω / E=12V / U=220V / L / C / S / 灯泡 / 电压表 / 电流表
    const re = /([REULCSI])(\d*)\s*=\s*([\d.]+)\s*(Ω|kΩ|MΩ|V|A|μF|F|mH|H)/gi;
    let mm;
    while ((mm = re.exec(t)) !== null) E.push({ k: mm[1].toUpperCase(), n: mm[2] || '', v: parseFloat(mm[3]), u: mm[4] });
    const res = [];
    const lit = [];
    for (const e of E) {
      if (e.k === 'R') res.push(e);
      else if (e.k === 'E' || e.k === 'U') lit.push(e);
      else if (e.k === 'L' || e.k === 'C') { /* 电容/电感 */ }
    }
    const hasSeries = /串联/.test(t);
    const hasParallel = /并联/.test(t);
    const hasMixed = /混联/.test(t) || (hasSeries && hasParallel);
    const volt = /电压表/.test(t);
    const amm = /电流表/.test(t);
    const lamp = /灯泡/.test(t) || /白炽灯/.test(t);
    const sw = /开关/.test(t);
    // 构建拓扑
    let items = [], wires = [];
    let idn = 0;
    const addIt = (type, x, y, params) => { const it = { id: 'it' + (++idn), type, x, y, rot: 0, params: params || {} }; items.push(it); return it; };
    const wire = (a, ap, b, bp) => wires.push({ id: 'w' + (++idn), a: { item: a.id, pin: ap }, b: { item: b.id, pin: bp } });
    let E1, R1, R2, R3, L1;
    if (hasMixed && res.length >= 3) {
      R1 = addIt('res', 180, 150, { R: 'R' + (res[0].n || '1') + '=' + fmtV(res[0].v) + res[0].u });
      R2 = addIt('res', 480, 80, { R: 'R' + (res[1].n || '2') + '=' + fmtV(res[1].v) + res[1].u });
      R3 = addIt('res', 480, 220, { R: 'R' + (res[2].n || '3') + '=' + fmtV(res[2].v) + res[2].u });
      const vSrc = lit[0] || { v: 12, u: 'V' };
      E1 = addIt('dc', 600, 350, { V: fmtV(vSrc.v) + (vSrc.u || 'V') });
      addIt('gnd', 660, 420, {});
      // 并联支路
      wire(R2, 'l', R1, 'r');
      const j1 = addIt('pot', 560, 80, { R: '●' }); items.pop();
      wire(R2, 'r', E1, 'l');
      wire(R3, 'l', R1, 'r');
      wire(R3, 'r', E1, 'l');
      wire(R1, 'l', E1, 'r');
      const g2 = addIt('gnd', 640, 430, {}); items.pop();
    } else if (hasParallel && res.length >= 2) {
      R1 = addIt('res', 200, 140, { R: 'R' + (res[0].n || '1') + '=' + fmtV(res[0].v) + res[0].u });
      R2 = addIt('res', 200, 280, { R: 'R' + (res[1].n || '2') + '=' + fmtV(res[1].v) + res[1].u });
      const vSrc = lit[0] || { v: 12, u: 'V' };
      E1 = addIt('dc', 600, 210, { V: fmtV(vSrc.v) + (vSrc.u || 'V') });
      addIt('gnd', 660, 290, {});
      wire(R1, 'l', E1, 'l');
      wire(R2, 'l', E1, 'l');
      wire(R1, 'r', E1, 'r');
      wire(R2, 'r', E1, 'r');
    } else if (hasSeries && res.length >= 2) {
      R1 = addIt('res', 180, 200, { R: 'R' + (res[0].n || '1') + '=' + fmtV(res[0].v) + res[0].u });
      R2 = addIt('res', 420, 200, { R: 'R' + (res[1].n || '2') + '=' + fmtV(res[1].v) + res[1].u });
      const vSrc = lit[0] || { v: 12, u: 'V' };
      E1 = addIt('dc', 660, 200, { V: fmtV(vSrc.v) + (vSrc.u || 'V') });
      addIt('gnd', 720, 280, {});
      wire(R1, 'r', R2, 'l');
      wire(R2, 'r', E1, 'l');
      wire(E1, 'r', R1, 'l');
    } else if (res.length === 1) {
      R1 = addIt('res', 260, 200, { R: 'R' + (res[0].n || '1') + '=' + fmtV(res[0].v) + res[0].u });
      const vSrc = lit[0] || { v: 12, u: 'V' };
      E1 = addIt('dc', 560, 200, { V: fmtV(vSrc.v) + (vSrc.u || 'V') });
      addIt('gnd', 620, 280, {});
      wire(R1, 'r', E1, 'l');
      wire(E1, 'r', R1, 'l');
    } else {
      // 基础回路：电源+开关+灯泡
      E1 = addIt('dc', 600, 320, { V: (lit[0] ? fmtV(lit[0].v) + (lit[0].u || 'V') : '12V') });
      const sw1 = addIt('sw', 300, 320, {});
      const lp = addIt('lamp', 120, 320, {});
      addIt('gnd', 660, 400, {});
      wire(E1, 'r', sw1, 'l');
      wire(sw1, 'r', lp, 'l');
      wire(lp, 'r', E1, 'l');
    }
    if (volt) { const v = addIt('vm', 420, 60, {}); wire(v, 'l', R1 || items[0], 'r'); wire(v, 'r', R1 || items[0], 'r'); }
    if (amm) { const a = addIt('am', 60, 120, {}); if (E1) wire(a, 'r', E1, 'r'); if (R1) wire(a, 'l', R1, 'l'); }
    // 渲染为 SVG
    const ed = new Editor(document.createElement('div'));
    ed.items = items; ed.wires = wires; ed.sel = null;
    const svg = ed.export();
    return svg;
  }

  function fmtV(v) {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return String(v);
    return String(Math.round(n * 1000) / 1000);
  }

  /* ---------- 自动解答求解器（欧姆定律/串并联/混联/功率） ---------- */
  function solve(question, circuitSvg) {
    const t = String(question || '');
    const out = { ok: false, text: '', answer: '' };
    // 提取元件参数
    const res = [];
    const re = /R\s*(\d?)\s*=\s*([\d.]+)\s*(Ω|kΩ|MΩ)/gi;
    let mm;
    while ((mm = re.exec(t)) !== null) res.push({ n: mm[1] || (res.length + 1), v: parseFloat(mm[2]), u: mm[3] });
    let U = null;
    const ue = /(?:E|U)\s*=\s*([\d.]+)\s*V/i.exec(t);
    if (ue) U = parseFloat(ue[1]);
    if (!U) { const e2 = /(\d+(?:\.\d+)?)\s*V/.exec(t); if (e2) U = parseFloat(e2[1]); }
    const hasSeries = /串联/.test(t);
    const hasParallel = /并联/.test(t);
    const hasMixed = /混联/.test(t) || (hasSeries && hasParallel);
    const ask = (t.match(/求[^。；，]*/) || [''])[0].replace(/^求/, '').trim();
    if (!res.length || U === null) return out;
    const ohm = (u) => { const k = u.toLowerCase(); if (k.includes('k')) return parseFloat(u) * 1000; if (k.includes('m')) return parseFloat(u) * 1e6; return parseFloat(u); };
    const R = res.map(r => ({ n: r.n, v: r.v, ohm: ohm(r.v + r.u) }));
    const steps = [];
    let Req, I, U1, U2, P;
    const fmt = (x) => { const n = Math.round(x * 10000) / 10000; return String(n); };
    if (hasMixed && R.length >= 3) {
      const r1 = R[0].ohm, r2 = R[1].ohm, r3 = R[2].ohm;
      const r23 = (r2 * r3) / (r2 + r3);
      Req = r1 + r23;
      I = U / Req;
      U1 = I * r1;
      U2 = I * r23;
      P = U * I;
      steps.push('【已知】U=' + U + 'V，R₁=' + fmt(r1) + 'Ω，R₂=' + fmt(r2) + 'Ω，R₃=' + fmt(r3) + 'Ω（R₂与R₃并联后与R₁串联）');
      steps.push('【求】' + (ask || '电路中的电流 I、R₁两端电压 U₁、电路总功率 P'));
      steps.push('【解】R₂、R₃并联：R₂₃=(R₂×R₃)/(R₂+R₃)=' + fmt(r2) + '×' + fmt(r3) + '/' + '(' + fmt(r2) + '+' + fmt(r3) + ')=' + fmt(r23) + 'Ω');
      steps.push('等效总电阻：R=R₁+R₂₃=' + fmt(r1) + '+' + fmt(r23) + '=' + fmt(Req) + 'Ω');
      steps.push('总电流：I=U/R=' + U + '/' + fmt(Req) + '=' + fmt(I) + 'A');
      steps.push('R₁两端电压：U₁=I×R₁=' + fmt(I) + '×' + fmt(r1) + '=' + fmt(U1) + 'V');
      steps.push('总功率：P=U×I=' + U + '×' + fmt(I) + '=' + fmt(P) + 'W');
      steps.push('【答】电路中的电流为 ' + fmt(I) + 'A，R₁两端电压为 ' + fmt(U1) + 'V，总功率为 ' + fmt(P) + 'W。');
      out.answer = fmt(I);
    } else if (hasParallel && R.length >= 2) {
      const r1 = R[0].ohm, r2 = R[1].ohm;
      Req = (r1 * r2) / (r1 + r2);
      I = U / Req;
      const I1 = U / r1, I2 = U / r2;
      P = U * I;
      steps.push('【已知】U=' + U + 'V，R₁=' + fmt(r1) + 'Ω，R₂=' + fmt(r2) + 'Ω（并联）');
      steps.push('【求】' + (ask || '等效电阻 R、各支路电流 I₁/I₂、总电流 I、总功率 P'));
      steps.push('【解】并联等效电阻：R=R₁×R₂/(R₁+R₂)=' + fmt(r1) + '×' + fmt(r2) + '/' + '(' + fmt(r1) + '+' + fmt(r2) + ')=' + fmt(Req) + 'Ω');
      steps.push('R₁支路电流：I₁=U/R₁=' + U + '/' + fmt(r1) + '=' + fmt(I1) + 'A');
      steps.push('R₂支路电流：I₂=U/R₂=' + U + '/' + fmt(r2) + '=' + fmt(I2) + 'A');
      steps.push('总电流：I=I₁+I₂=' + fmt(I1) + '+' + fmt(I2) + '=' + fmt(I) + 'A（或 I=U/R=' + fmt(I) + 'A）');
      steps.push('总功率：P=U×I=' + U + '×' + fmt(I) + '=' + fmt(P) + 'W');
      steps.push('【答】等效电阻 ' + fmt(Req) + 'Ω，I₁=' + fmt(I1) + 'A，I₂=' + fmt(I2) + 'A，总电流 ' + fmt(I) + 'A，总功率 ' + fmt(P) + 'W。');
      out.answer = fmt(I);
    } else if (R.length >= 2) {
      const r1 = R[0].ohm, r2 = R[1].ohm;
      Req = r1 + r2;
      I = U / Req;
      U1 = I * r1; U2 = I * r2;
      P = U * I;
      steps.push('【已知】U=' + U + 'V，R₁=' + fmt(r1) + 'Ω，R₂=' + fmt(r2) + 'Ω（串联）');
      steps.push('【求】' + (ask || '电路中的电流 I、R₁两端电压 U₁、R₂两端电压 U₂、总功率 P'));
      steps.push('【解】串联等效电阻：R=R₁+R₂=' + fmt(r1) + '+' + fmt(r2) + '=' + fmt(Req) + 'Ω');
      steps.push('电路中的电流：I=U/R=' + U + '/' + fmt(Req) + '=' + fmt(I) + 'A');
      steps.push('R₁两端电压：U₁=I×R₁=' + fmt(I) + '×' + fmt(r1) + '=' + fmt(U1) + 'V');
      steps.push('R₂两端电压：U₂=I×R₂=' + fmt(I) + '×' + fmt(r2) + '=' + fmt(U2) + 'V');
      steps.push('总功率：P=U×I=' + U + '×' + fmt(I) + '=' + fmt(P) + 'W');
      steps.push('【答】电路中的电流为 ' + fmt(I) + 'A，U₁=' + fmt(U1) + 'V，U₂=' + fmt(U2) + 'V，总功率 ' + fmt(P) + 'W。');
      out.answer = fmt(I);
    } else if (R.length === 1) {
      const r1 = R[0].ohm;
      I = U / r1;
      P = U * I;
      steps.push('【已知】U=' + U + 'V，R=' + fmt(r1) + 'Ω');
      steps.push('【求】' + (ask || '电路中的电流 I、功率 P'));
      steps.push('【解】I=U/R=' + U + '/' + fmt(r1) + '=' + fmt(I) + 'A');
      steps.push('P=U×I=' + U + '×' + fmt(I) + '=' + fmt(P) + 'W');
      steps.push('【答】电路中的电流为 ' + fmt(I) + 'A，功率为 ' + fmt(P) + 'W。');
      out.answer = fmt(I);
    } else { return out; }
    out.ok = true;
    out.text = steps.join('\n');
    return out;
  }

  /* ---------- 导出 ---------- */
  window.Circuit = {
    DEFS, GROUPS, cleanSvg, Editor, autoFromText, solve,
    openEditor(svg, onSave) {
      const olds = document.querySelectorAll('.modal-mask');
      olds.forEach(o => { if (o.parentNode) o.parentNode.removeChild(o); });
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.style.zIndex = '9999';
      mask.innerHTML = '<div class="modal" style="max-width:1000px;width:96%;max-height:92vh;overflow:auto"><div id="circ-host"></div><div class="result-btns" style="margin-top:10px"><button class="btn ghost" data-c="cancel">取消</button><button class="btn" data-c="clear">清空</button><button class="btn primary" data-c="ok">保存电路图</button></div></div>';
      document.body.appendChild(mask);
      const host = mask.querySelector('#circ-host');
      const ed = new Editor(host, svg);
      editor = ed;
      mask.querySelector('[data-c="cancel"]').onclick = () => { document.body.removeChild(mask); editor = null; };
      mask.querySelector('[data-c="clear"]').onclick = () => { ed.clearAll(); };
      mask.querySelector('[data-c="ok"]').onclick = () => {
        const out = ed.export();
        document.body.removeChild(mask); editor = null;
        if (onSave) onSave(out);
      };
    }
  };
})();
