/* ============================================================
 *  语文模块（移植自 kidlearn，适配主平台）
 *  课文全文原地朗读（句子高亮+自动跟随+可打断）+ 每单元优秀作文
 *  数据依赖：data/chinese-data.js (CN_BOOKS)、full-4a/4b.js (CN_FULL_TEXT)、essay-data.js (CN_ESSAYS)
 *  中文朗读双通道：本机 speechSynthesis 优先，哑引擎/缺失自动切百度在线朗读（免 key）
 * ============================================================ */
window.CNMod = (function () {
  'use strict';

  /* ---------- 数据合并：全文覆盖目录里的兜底 text ---------- */
  (function merge() {
    var T = window.CN_FULL_TEXT || {};
    var n = 0;
    (window.CN_BOOKS || []).forEach(function (b) {
      b.units.forEach(function (u) {
        u.lessons.forEach(function (l) {
          var t = T[b.id + '-' + l.no];
          if (t && String(t).trim()) { l.text = String(t).trim(); l.full = true; n++; }
        });
      });
    });
    window.__CN_FULL_COUNT = n;
  })();

  /* ---------- 按账号隔离的本地存储 ---------- */
  function xk(k) { return 'wb_g4en_x_' + (window.currentUser ? currentUser.name : 'guest') + '_' + k; }
  function xget(k, d) { try { var v = localStorage.getItem(xk(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function xset(k, v) { try { localStorage.setItem(xk(k), JSON.stringify(v)); } catch (e) { } }
  function isRead(key) { return xget('read_' + key, false); }
  function markRead(key) { xset('read_' + key, true); }
  function readCount() {
    var n = 0;
    (window.CN_BOOKS || []).forEach(function (b) { b.units.forEach(function (u) { u.lessons.forEach(function (l) { if (isRead(b.id + '-' + l.no)) n++; }); }); });
    return n;
  }

  /* ---------- 中文朗读双通道 ---------- */
  var SILENT_WAV = 'data:audio/wav;base64,UklGRkwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  var _au = null, AUDIO_UNLOCKED = false, FORCE_NET = false, VOICES = [];

  function speechReady() {
    return typeof window.speechSynthesis !== 'undefined' &&
      typeof window.SpeechSynthesisUtterance !== 'undefined' &&
      window.speechSynthesis !== null;
  }
  function refreshVoices() { try { VOICES = speechSynthesis.getVoices() || []; } catch (e) { VOICES = []; } return VOICES; }
  function whenSpeechReady(cb, timeout) {
    if (speechReady()) { cb(true); return; }
    var n = 0, max = Math.ceil((timeout || 3000) / 200);
    var t = setInterval(function () {
      n++;
      if (speechReady()) { clearInterval(t); refreshVoices(); cb(true); }
      else if (n >= max) { clearInterval(t); cb(false); }
    }, 200);
  }
  function initVoices() {
    if (!speechReady()) { whenSpeechReady(function () { initVoices(); }); return; }
    refreshVoices();
    try { speechSynthesis.onvoiceschanged = refreshVoices; } catch (e) { }
    [120, 500, 1200, 2500].forEach(function (ms) { setTimeout(refreshVoices, ms); });
  }
  initVoices();

  function unlockAudio() {
    if (AUDIO_UNLOCKED) return;
    AUDIO_UNLOCKED = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { if (!window.__cnAC) window.__cnAC = new AC(); if (window.__cnAC.state === 'suspended') window.__cnAC.resume(); }
    } catch (e) { }
    try { netAudio().src = SILENT_WAV; netAudio().play().catch(function () { }); } catch (e) { }
    if (speechReady()) {
      try {
        var u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.rate = 10;
        speechSynthesis.speak(u);
      } catch (e) { }
    }
  }
  document.addEventListener('touchstart', unlockAudio, { passive: true });
  document.addEventListener('click', unlockAudio, true);

  function netAudio() {
    if (!_au) { _au = new Audio(); _au.preload = 'auto'; }
    return _au;
  }
  function netURL(text) {
    return 'https://fanyi.baidu.com/gettts?lan=zh&spd=5&source=web&text=' + encodeURIComponent(text);
  }
  function netPreload(text) {
    try { var a = new Audio(); a.preload = 'auto'; a.src = netURL(text); } catch (e) { }
  }
  function netPlay(text, onstart, onend) {
    var a = netAudio();
    a.onplaying = function () { if (onstart) onstart(); };
    a.onended = function () { if (onend) onend(); };
    a.onerror = function () { if (onend) onend(); };
    a.src = netURL(text);
    var pr = a.play();
    if (pr && pr.then) pr.then(function () { if (onstart) onstart(); }).catch(function () { if (onend) onend(); });
  }
  function localPlay(text, onstart, onend, gen) {
    if (!speechReady()) { netPlay(text, onstart, onend); return; }
    try {
      speechSynthesis.cancel();
      setTimeout(function () {
        if (gen !== LIVE.gen) return;
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = 0.95; u.pitch = 1;
        var vs = VOICES.length ? VOICES : refreshVoices();
        for (var i = 0; i < vs.length; i++) {
          if ((vs[i].lang || '').indexOf('zh') === 0) { u.voice = vs[i]; break; }
        }
        var started = { v: false };
        u.onstart = function () { started.v = true; if (onstart) onstart(); };
        u.onend = function () { if (onend) onend(); };
        u.onerror = function () { if (onend) onend(); };
        speechSynthesis.speak(u);
        /* 防哑看门狗：有 API 但引擎不出声（安卓未装 TTS），1.3s 后切在线并记住 */
        setTimeout(function () {
          if (gen !== LIVE.gen || started.v || FORCE_NET) return;
          FORCE_NET = true;
          try { speechSynthesis.cancel(); } catch (e) { }
          netPlay(text, onstart, onend);
        }, 1300);
      }, 60);                       // cancel() 异步，等一个 tick 再 speak
    } catch (e) { netPlay(text, onstart, onend); }
  }
  function sayOne(text, onstart, onend) {
    var gen = LIVE.gen;
    if (FORCE_NET) netPlay(text, onstart, onend);
    else localPlay(text, onstart, onend, gen);
  }

  /* ---------- 分句（逐段切句，句子归属天然正确） ---------- */
  function splitSentences(t) {
    var out = [], buf = '';
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      buf += c;
      if ('。！？；'.indexOf(c) >= 0) {
        if (i + 1 < t.length && '”』」）'.indexOf(t[i + 1]) >= 0) { buf += t[i + 1]; i++; }
        out.push(buf); buf = '';
      } else if (c === '…' && t[i + 1] === '…') { buf += t[i + 1]; i++; out.push(buf); buf = ''; }
    }
    if (buf.trim()) out.push(buf);
    return out.length ? out : [t];
  }

  /* ---------- 朗读器状态 ---------- */
  var LIVE = { on: false, lines: [], idx: 0, paused: false, gen: 0, follow: true, touchY: null, route: null };

  function clearHighlight() {
    var els = document.querySelectorAll('#cnBody .cn-p.now');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('now');
  }
  function highlight(idx) {
    clearHighlight();
    var el = document.querySelector('#cnBody [data-l="' + idx + '"]');
    if (el) {
      el.classList.add('now');
      if (LIVE.follow) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
      }
    }
    var bar = document.getElementById('cnSongPos');
    if (bar) bar.textContent = (LIVE.idx + 1) + '/' + LIVE.lines.length;
  }
  function stopFollow() {
    if (!LIVE.on || !LIVE.follow) return;
    LIVE.follow = false;
    var b = document.getElementById('cnBackHere');
    if (b) b.style.display = 'flex';
    var h = document.getElementById('cnFollowHint');
    if (h) h.textContent = '已暂停跟随，可自由上下翻看';
  }
  function backHere() {
    LIVE.follow = true;
    var b = document.getElementById('cnBackHere');
    if (b) b.style.display = 'none';
    var h = document.getElementById('cnFollowHint');
    if (h) h.textContent = '朗读中，可上下翻看课文';
    highlight(LIVE.idx);
  }
  window.addEventListener('wheel', stopFollow, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (LIVE.touchY != null && Math.abs(e.touches[0].clientY - LIVE.touchY) > 10) stopFollow();
  }, { passive: true });
  window.addEventListener('touchstart', function (e) {
    LIVE.touchY = e.touches[0] ? e.touches[0].clientY : null;
  }, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].indexOf(e.key) >= 0) stopFollow();
  });

  function playFrom(idx) {
    LIVE.idx = Math.max(0, Math.min(LIVE.lines.length - 1, idx));
    LIVE.on = true; LIVE.paused = false; LIVE.gen++; LIVE.follow = true;
    var b = document.getElementById('cnBackHere'); if (b) b.style.display = 'none';
    var h = document.getElementById('cnFollowHint'); if (h) h.textContent = '朗读中，可上下翻看课文';
    setPlayBtn(false);
    step();
  }
  function step() {
    if (!LIVE.on || LIVE.paused) return;
    var i = LIVE.idx;
    if (i >= LIVE.lines.length) { finish(); return; }
    highlight(i);
    var line = LIVE.lines[i];
    var gen = LIVE.gen;
    sayOne(line, null, function () {
      if (gen !== LIVE.gen || LIVE.paused) return;
      /* 预取下一句（百度响应带缓存头，能明显减少卡顿） */
      if (!FORCE_NET && i + 1 < LIVE.lines.length) netPreload(LIVE.lines[i + 1]);
      LIVE.idx = i + 1;
      setTimeout(function () { if (gen === LIVE.gen && !LIVE.paused) step(); }, 160);
    });
  }
  function finish() {
    LIVE.on = false; LIVE.paused = false;
    clearHighlight();
    setPlayBtn(true);
    try { speechSynthesis.cancel(); } catch (e) { }
    try { netAudio().pause(); } catch (e) { }
    if (LIVE.route && LIVE.route.page === 'lesson') markRead(LIVE.route.book + '-' + LIVE.route.no);
    toast('这篇读完啦，给你点个赞！');
  }
  function pauseToggle() {
    if (!LIVE.on) { playFrom(LIVE.idx); return; }
    if (LIVE.paused) { LIVE.paused = false; setPlayBtn(false); step(); }
    else {
      LIVE.paused = true; LIVE.gen++; setPlayBtn(true);
      try { speechSynthesis.cancel(); } catch (e) { }
      try { netAudio().pause(); } catch (e) { }
    }
  }
  function nextLine() { if (!LIVE.on) { playFrom(LIVE.idx); return; } LIVE.idx = Math.min(LIVE.lines.length - 1, LIVE.idx + 1); playFrom(LIVE.idx); }
  function prevLine() { if (!LIVE.on) { playFrom(LIVE.idx); return; } LIVE.idx = Math.max(0, LIVE.idx - 1); playFrom(LIVE.idx); }
  function stopAll() {
    LIVE.gen++; LIVE.on = false; LIVE.paused = false; LIVE.follow = true;
    try { speechSynthesis.cancel(); } catch (e) { }
    try { netAudio().pause(); } catch (e) { }
    clearHighlight();
  }
  function setPlayBtn(idle) {
    var b = document.getElementById('cnPlay');
    if (b) b.textContent = idle ? '▶' : '⏸';
  }

  /* ---------- 视图渲染 ---------- */
  var route = { page: 'home', book: '4a' };

  function el(id) { return document.getElementById(id); }
  function nav(a, b) { /* a,b 同元素 innerHTML 注入后由委托处理 */ }

  function renderHome(box) {
    var h = '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      + '<button class="icon-btn" data-cn-go="backHome" title="返回">‹ 返回</button><h2 style="margin:0">📖 语文</h2></div>';
    h += '<div style="display:flex;gap:8px;margin-bottom:14px">';
    (window.CN_BOOKS || []).forEach(function (b) {
      h += '<button class="btn ' + (route.book === b.id ? 'btn-p' : 'btn-o') + '" data-cn-book="' + b.id + '" style="flex:1">' + esc(b.name) + '</button>';
    });
    h += '</div>';
    h += '<p class="sub" style="margin-bottom:10px">已经朗读完 <b>' + readCount() + '</b> 篇课文 · 点课文直接读，读到哪句哪句变色</p>';
    var bk = null;
    (window.CN_BOOKS || []).forEach(function (b) { if (b.id === route.book) bk = b; });
    if (!bk) { box.innerHTML = '<p class="sub">语文数据没加载出来，刷新一下试试</p>'; return; }
    h += '<div class="card" style="box-shadow:none;border:none;padding:0">';
    bk.units.forEach(function (u) {
      h += '<div style="margin-bottom:14px"><h3 style="margin:0 0 8px">' + esc(u.name) + '</h3>';
      u.lessons.forEach(function (l) {
        var key = bk.id + '-' + l.no, read = isRead(key);
        h += '<button class="big-btn" style="background:#fff;color:inherit;box-shadow:0 2px 8px rgba(0,0,0,.06);text-align:left;width:100%;margin-bottom:8px" '
          + 'data-cn-lesson="' + esc(l.no) + '" data-cn-unit="' + esc(u.id) + '">'
          + '<span class="ico">' + (read ? '✅' : '📖') + '</span><span>' + esc(l.title)
          + (l.author ? '<small>' + esc(l.author) + (l.full ? ' · 全文' : ' · 片段') + '</small>' : '')
          + '</span><span style="margin-left:auto;font-size:20px">🔊</span></button>';
      });
      var ess = (window.CN_ESSAYS || {})[bk.id + '-' + u.id] || [];
      if (ess.length) {
        h += '<button class="big-btn" style="background:#FDF2F8;color:inherit;box-shadow:0 2px 8px rgba(0,0,0,.06);width:100%;margin-bottom:8px" data-cn-essays="' + esc(u.id) + '">'
          + '<span class="ico">✍️</span><span>' + ess.length + ' 篇优秀作文<small>看看同龄人怎么写</small></span></button>';
      }
      h += '</div>';
    });
    h += '</div>';
    box.innerHTML = h;
  }

  function findLesson(bookId, unitId, no) {
    var bk = null, unit = null;
    (window.CN_BOOKS || []).forEach(function (b) { if (b.id === bookId) bk = b; });
    if (!bk) return null;
    bk.units.forEach(function (u) { if (u.id === unitId) unit = u; });
    if (!unit) return null;
    for (var i = 0; i < unit.lessons.length; i++) {
      if (String(unit.lessons[i].no) === String(no)) return { book: bk, unit: unit, lesson: unit.lessons[i] };
    }
    return null;
  }

  function renderLesson(box, bookId, unitId, no) {
    var f = findLesson(bookId, unitId, no);
    if (!f) { box.innerHTML = '<p class="sub">没找到这篇课文</p>'; return; }
    stopAll();
    var l = f.lesson;
    var paras = String(l.text || '').split('\n').filter(function (s) { return s.trim(); });
    var lines = [], owner = [];
    paras.forEach(function (p, pi) {
      splitSentences(p).forEach(function (s2) { lines.push(s2); owner.push(pi); });
    });
    LIVE.lines = lines; LIVE.idx = 0; LIVE.on = false; LIVE.paused = false; LIVE.gen++;
    LIVE.route = { page: 'lesson', book: bookId, no: no };
    LIVE.follow = true;

    var h = '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      + '<button class="icon-btn" data-cn-go="back" title="返回">‹ 返回</button>'
      + '<h2 style="margin:0;font-size:19px">' + esc(l.title) + '</h2></div>'
      + '<p class="sub" style="margin:0 0 12px">' + esc(f.book.name) + ' · ' + esc(f.unit.name)
      + (l.author ? ' · ' + esc(l.author) : '') + ' · 全文 ' + l.text.length + ' 字</p>'
      + '<div id="cnFollowHint" class="sub" style="margin-bottom:8px">点🔊开始朗读；点任意一句，从那句读起</div>';
    paras.forEach(function (p, pi) {
      var spans = '';
      for (var i = 0; i < lines.length; i++) {
        if (owner[i] === pi) spans += '<span class="cn-s" data-cn-line="' + i + '" style="cursor:pointer">' + esc(lines[i]) + '</span>';
      }
      h += '<p class="cn-p" style="text-indent:2em;font-size:17px;line-height:2;margin:0 0 10px;transition:background .2s" data-l="' + pi + '">' + spans + '</p>';
    });
    h += '<button id="cnBackHere" data-cn-go="backHere" style="display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(136px + env(safe-area-inset-bottom,0px));z-index:60;background:#1D4ED8;color:#fff;border:none;border-radius:20px;padding:8px 16px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.25)">⬇ 回到正在读的地方</button>';
    h += '<div id="cnSongBar" style="position:fixed;left:50%;transform:translateX(-50%);bottom:calc(64px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;align-items:center;gap:6px;background:#0F172A;color:#fff;border-radius:24px;padding:8px 14px;box-shadow:0 6px 18px rgba(0,0,0,.3);max-width:92vw">'
      + '<button data-cn-go="prev" style="background:none;border:none;color:#fff;font-size:18px;padding:2px 6px">‹</button>'
      + '<button id="cnPlay" data-cn-go="play" style="background:none;border:none;color:#fff;font-size:18px;padding:2px 6px">▶</button>'
      + '<button data-cn-go="next" style="background:none;border:none;color:#fff;font-size:18px;padding:2px 6px">›</button>'
      + '<span id="cnSongPos" style="font-size:12px;opacity:.8;min-width:44px;text-align:center">0/' + lines.length + '</span>'
      + '<button data-cn-go="close" style="background:none;border:none;color:#fff;font-size:16px;padding:2px 6px">✕</button></div>';
    box.innerHTML = h;
  }

  function renderEssays(box, bookId, unitId) {
    var bk = null;
    (window.CN_BOOKS || []).forEach(function (b) { if (b.id === bookId) bk = b; });
    var unitName = '';
    if (bk) bk.units.forEach(function (u) { if (u.id === unitId) unitName = u.name; });
    var ess = (window.CN_ESSAYS || {})[bookId + '-' + unitId] || [];
    var h = '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      + '<button class="icon-btn" data-cn-go="back" title="返回">‹ 返回</button>'
      + '<h2 style="margin:0">✍️ 优秀作文</h2></div>'
      + '<p class="sub" style="margin-bottom:12px">' + esc(unitName || '') + ' · 共 ' + ess.length + ' 篇</p>';
    ess.forEach(function (e2, i) {
      h += '<button class="big-btn" style="background:#fff;color:inherit;box-shadow:0 2px 8px rgba(0,0,0,.06);width:100%;text-align:left;margin-bottom:8px" data-cn-essay="' + i + '" data-cn-unit2="' + esc(unitId) + '">'
        + '<span class="ico">📄</span><span>' + esc(e2.title) + '<small>' + esc(e2.author || '佚名') + ' · 约 ' + e2.words + ' 字</small></span></button>';
    });
    box.innerHTML = h;
    route.page2 = { book: bookId, unit: unitId };
  }

  function renderEssay(box, bookId, unitId, ei) {
    var ess = (window.CN_ESSAYS || {})[bookId + '-' + unitId] || [];
    var e2 = ess[ei];
    if (!e2) { box.innerHTML = '<p class="sub">作文不见了</p>'; return; }
    var h = '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      + '<button class="icon-btn" data-cn-go="backEssays" data-cn-unit2="' + esc(unitId) + '" title="返回">‹ 返回</button>'
      + '<h2 style="margin:0;font-size:19px">' + esc(e2.title) + '</h2></div>'
      + '<p class="sub" style="margin:0 0 6px">' + esc(e2.author || '佚名') + ' · 约 ' + e2.words + ' 字</p>'
      + '<div style="margin-bottom:10px">' + (e2.tags || []).map(function (t) { return '<span class="chip" style="background:#FCE7F3;color:#9D174D">' + esc(t) + '</span>'; }).join(' ') + '</div>';
    String(e2.text || '').split('\n').forEach(function (p) {
      if (p.trim()) h += '<p style="text-indent:2em;font-size:16px;line-height:2;margin:0 0 10px">' + esc(p) + '</p>';
    });
    if (ess[ei + 1] || ess[ei - 1]) {
      h += '<div style="display:flex;gap:8px;margin-top:14px">';
      if (ess[ei - 1]) h += '<button class="btn btn-o" style="flex:1" data-cn-essay="' + (ei - 1) + '" data-cn-unit2="' + esc(unitId) + '">上一篇</button>';
      if (ess[ei + 1]) h += '<button class="btn btn-o" style="flex:1" data-cn-essay="' + (ei + 1) + '" data-cn-unit2="' + esc(unitId) + '">下一篇</button>';
      h += '</div>';
    }
    box.innerHTML = h;
  }

  var backStack = [];
  function render(box) {
    if (route.page === 'home') { backStack = []; renderHome(box); return; }
    if (route.page === 'lesson') { renderLesson(box, route.book, route.unit, route.no); return; }
    if (route.page === 'essays') { renderEssays(box, route.book, route.unit); return; }
    if (route.page === 'essay') { renderEssay(box, route.book, route.unit, route.ei); return; }
    renderHome(box);
  }

  function handle(box, attr, elm) {
    var v = elm.getAttribute(attr);
    if (attr === 'data-cn-book') { route = { page: 'home', book: v }; render(box); return; }
    if (attr === 'data-cn-lesson') {
      backStack.push(JSON.parse(JSON.stringify(route)));
      route = { page: 'lesson', book: route.book, unit: elm.getAttribute('data-cn-unit'), no: v };
      render(box); return;
    }
    if (attr === 'data-cn-essays') {
      backStack.push(JSON.parse(JSON.stringify(route)));
      route = { page: 'essays', book: route.book, unit: v }; render(box); return;
    }
    if (attr === 'data-cn-essay') {
      backStack.push(JSON.parse(JSON.stringify(route)));
      route = { page: 'essay', book: route.book, unit: elm.getAttribute('data-cn-unit2') || route.unit, ei: parseInt(v, 10) }; render(box); return;
    }
    if (attr === 'data-cn-go') {
      if (v === 'back') { stopAll(); route = backStack.pop() || { page: 'home', book: route.book }; render(box); return; }
      if (v === 'backEssays') { route = { page: 'essays', book: route.book, unit: elm.getAttribute('data-cn-unit2') || route.unit }; render(box); return; }
      if (v === 'backHome') { stopAll(); route = { page: 'home', book: route.book }; render(box); return; }
      if (v === 'play') { pauseToggle(); return; }
      if (v === 'prev') { prevLine(); return; }
      if (v === 'next') { nextLine(); return; }
      if (v === 'close') { stopAll(); return; }
      if (v === 'backHere') { backHere(); return; }
      return;
    }
    if (attr === 'data-cn-line') {
      var i = parseInt(v, 10);
      LIVE.follow = true;
      var b = el('cnBackHere'); if (b) b.style.display = 'none';
      playFrom(i);
      return;
    }
  }

  function bindOnce(box) {
    if (box.__cnBound) return;
    box.__cnBound = true;
    box.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== box) {
        var attrs = t.attributes || {};
        if (t.getAttribute && t.getAttribute('data-cn-line')) { handle(box, 'data-cn-line', t); return; }
        if (t.getAttribute && t.getAttribute('data-cn-go')) { handle(box, 'data-cn-go', t); return; }
        if (t.getAttribute && t.getAttribute('data-cn-essay')) { handle(box, 'data-cn-essay', t); return; }
        if (t.getAttribute && t.getAttribute('data-cn-essays')) { handle(box, 'data-cn-essays', t); return; }
        if (t.getAttribute && t.getAttribute('data-cn-lesson')) { handle(box, 'data-cn-lesson', t); return; }
        if (t.getAttribute && t.getAttribute('data-cn-book')) { handle(box, 'data-cn-book', t); return; }
        t = t.parentNode;
      }
    });
  }

  function open() {
    var box = el('cnBody');
    if (!box) return;
    bindOnce(box);
    render(box);
  }

  return { open: open, render: render, stopAll: stopAll, playFrom: playFrom, pauseToggle: pauseToggle,
    splitSentences: splitSentences, readCount: readCount, __route: function () { return route; } };
})();
