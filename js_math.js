/* ============================================================
 *  数学模块（移植自 kidlearn，适配主平台）
 *  ① 每日口算打卡：10 题 · 数字键盘输答案 · 计时 · 自动评级
 *  ② 拍错题：拍照/相册 → 拖框选一题 → Tesseract 本地 OCR → 知识点匹配
 *     → 从真题库(MATH_BANK)抽 3 道同类题：答案为数字 → 键盘输入；文字答案 → 点选
 *     （布局：题目和输入框在上方，照片缩小置底，不被键盘压住）
 *  ③ 错题本：按键查看所有拍过的错题，可重练、可删除
 *  数据依赖：data/math_bank.js (MATH_KPS / MATH_BANK)；vendor/tesseract/* 按需加载
 * ============================================================ */
window.MathMod = (function () {
  'use strict';

  /* ---------- 按账号隔离的本地存储 ---------- */
  function xk(k) { return 'wb_g4en_x_' + (window.currentUser ? currentUser.name : 'guest') + '_' + k; }
  function xget(k, d) { try { var v = localStorage.getItem(xk(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function xset(k, v) { try { localStorage.setItem(xk(k), JSON.stringify(v)); } catch (e) { } }
  function sessList() { return xget('ma_sessions', []); }
  function saveSess(s) {
    var list = sessList().filter(function (x) { return x !== s.id; });
    list.unshift(s.id);
    xset('ma_sessions', list.slice(0, 20));            // 最多留 20 条，防止撑爆本地存储
    xset('ma_s_' + s.id, s);
  }
  function getSess(id) { return xget('ma_s_' + id, null); }
  function delSess(id) {
    xset('ma_sessions', sessList().filter(function (x) { return x !== id; }));
    try { localStorage.removeItem(xk('ma_s_' + id)); } catch (e) { }
  }

  /* ---------- 小工具 ---------- */
  function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = rnd(0, i), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function nowStr() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dayKey() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function esc(s) { return window.esc ? window.esc(s) : String(s == null ? '' : s); }
  function toast(m) { if (window.toast) window.toast(m); else if (window.alert) alert(m); }

  /* ---------- 图片工具 ---------- */
  function fileToDataURL(file, maxSide) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var k = Math.min(1, maxSide / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = rej;
        img.src = rd.result;
      };
      rd.onerror = rej;
      rd.readAsDataURL(file);
    });
  }
  function resizeDataURL(dataUrl, maxSide) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var k = Math.min(1, maxSide / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/jpeg', 0.62));
      };
      img.onerror = function () { res(dataUrl); };
      img.src = dataUrl;
    });
  }

  /* ---------- 框选一题（Crop）---------- */
  var Crop = (function () {
    function open(dataUrl, opts) {
      opts = opts || {};
      return new Promise(function (resolve) {
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px';
        var head = document.createElement('div');
        head.style.cssText = 'color:#fff;font-size:15px;margin-bottom:8px;text-align:center';
        head.textContent = (opts.title || '拖动四角，框住这一道题') + '（确认后只识别框内的题）';
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;background:#fff;border-radius:6px;box-shadow:0 0 0 9999px rgba(0,0,0,.55);overflow:hidden';
        var img = new Image();
        img.src = dataUrl;
        img.style.cssText = 'display:block;user-select:none;-webkit-user-drag:none';
        wrap.appendChild(img);
        var sel = document.createElement('div');
        sel.style.cssText = 'position:absolute;border:2px dashed #1D4ED8;box-sizing:border-box;cursor:move;background:rgba(29,78,216,.08)';
        wrap.appendChild(sel);
        var HANDLES = ['tl', 'tr', 'bl', 'br'];
        HANDLES.forEach(function (h) {
          var d = document.createElement('div');
          d.setAttribute('data-h', h);
          d.style.cssText = 'position:absolute;width:22px;height:22px;border-radius:50%;background:#1D4ED8;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)';
          sel.appendChild(d);
        });
        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:10px;margin-top:12px';
        var bAll = document.createElement('button'); bAll.textContent = '用整张图'; bAll.className = 'btn btn-o';
        var bOk = document.createElement('button'); bOk.textContent = '✓ 就框这里'; bOk.className = 'btn btn-p';
        var bX = document.createElement('button'); bX.textContent = '✕ 取消'; bX.className = 'btn btn-o';
        bar.appendChild(bAll); bar.appendChild(bOk); bar.appendChild(bX);
        ov.appendChild(head); ov.appendChild(wrap); ov.appendChild(bar);
        document.body.appendChild(ov);

        var natW = 0, natH = 0, dispW = 0, dispH = 0;
        var S = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };           // 归一化选框
        function layout() {
          var availW = Math.min(window.innerWidth - 24, 900);
          var availH = window.innerHeight - 150;
          var k = Math.min(availW / natW, availH / natH);
          dispW = Math.round(natW * k); dispH = Math.round(natH * k);
          /* 关键：显示尺寸用 JS 算，同时设到 wrap 和 img，否则竖长照片被压扁、坐标全错 */
          wrap.style.width = dispW + 'px'; wrap.style.height = dispH + 'px';
          img.style.width = dispW + 'px'; img.style.height = dispH + 'px';
          draw();
        }
        function draw() {
          var x = S.x * dispW, y = S.y * dispH, w = S.w * dispW, h = S.h * dispH;
          sel.style.left = x + 'px'; sel.style.top = y + 'px'; sel.style.width = w + 'px'; sel.style.height = h + 'px';
          var hs = { tl: [0, 0], tr: [w, 0], bl: [0, h], br: [w, h] };
          HANDLES.forEach(function (hn) {
            var d = sel.querySelector('[data-h="' + hn + '"]');
            var p = hs[hn];
            d.style.left = (p[0] - 11) + 'px'; d.style.top = (p[1] - 11) + 'px';
          });
        }
        img.onload = function () {
          natW = img.naturalWidth; natH = img.naturalHeight;
          layout();
        };
        if (img.complete && img.naturalWidth) { natW = img.naturalWidth; natH = img.naturalHeight; layout(); }

        var drag = null;   // {mode:'move'|'tl'|'tr'|'bl'|'br', sx, sy, ox, oy, ow, oh}
        function pos(e) { return { x: e.clientX, y: e.clientY }; }
        function clampSel() {
          S.x = Math.max(0, Math.min(S.x, 1 - S.w));
          S.y = Math.max(0, Math.min(S.y, 1 - S.h));
          S.w = Math.max(0.05, Math.min(S.w, 1 - S.x));
          S.h = Math.max(0.05, Math.min(S.h, 1 - S.y));
        }
        function onDown(e) {
          var mode = e.target.getAttribute && e.target.getAttribute('data-h');
          if (!mode && e.target === sel) mode = 'move';
          if (!mode) return;
          e.preventDefault();
          var p = pos(e);
          drag = { mode: mode, sx: p.x, sy: p.y, ox: S.x, oy: S.y, ow: S.w, oh: S.h };
          try { wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId); } catch (err) { }
        }
        function onMove(e) {
          if (!drag) return;
          var p = pos(e);
          var dx = (p.x - drag.sx) / dispW, dy = (p.y - drag.sy) / dispH;
          if (drag.mode === 'move') { S.x = drag.ox + dx; S.y = drag.oy + dy; }
          else {
            if (drag.mode.indexOf('l') === 0 && drag.mode.length === 2) { /* tl or bl handled below */ }
            if (drag.mode === 'tl') { S.x = drag.ox + dx; S.y = drag.oy + dy; S.w = drag.ow - dx; S.h = drag.oh - dy; }
            if (drag.mode === 'tr') { S.y = drag.oy + dy; S.w = drag.ow + dx; S.h = drag.oh - dy; }
            if (drag.mode === 'bl') { S.x = drag.ox + dx; S.w = drag.ow - dx; S.h = drag.oh + dy; }
            if (drag.mode === 'br') { S.w = drag.ow + dx; S.h = drag.oh + dy; }
          }
          if (S.w < 0.05) { S.w = 0.05; }
          if (S.h < 0.05) { S.h = 0.05; }
          clampSel(); draw();
        }
        function onUp() { drag = null; }
        wrap.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);

        function close() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          document.body.removeChild(ov);
        }
        bAll.onclick = function () { close(); resolve(dataUrl); };
        bX.onclick = function () { close(); resolve(null); };
        bOk.onclick = function () {
          var x = Math.round(S.x * natW), y = Math.round(S.y * natH);
          var w = Math.round(S.w * natW), h = Math.round(S.h * natH);
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          var im2 = new Image();
          im2.onload = function () {
            cv.getContext('2d').drawImage(im2, x, y, w, h, 0, 0, w, h);
            close();
            resolve(cv.toDataURL('image/jpeg', 0.92));   // 从原始 dataURL 裁，精度不受显示缩放影响
          };
          im2.src = dataUrl;
        };
      });
    }
    return { open: open };
  })();

  /* ---------- OCR：Tesseract 纯前端本地引擎（vendor 自托管，断网可用） ---------- */
  var _ocrWorker = null, _ocrLoading = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = res; s.onerror = function () { rej(new Error('load fail ' + src)); };
      document.body.appendChild(s);
    });
  }
  function ensureTesseract(onProgress) {
    if (window.Tesseract && _ocrWorker) return Promise.resolve(_ocrWorker);
    var seq = Promise.resolve();
    if (!window.Tesseract) seq = loadScript('vendor/tesseract/tesseract.min.js');
    _ocrLoading = seq.then(function () {
      return Tesseract.createWorker('chi_sim', 1, {
        workerPath: 'vendor/tesseract/worker.min.js',
        corePath: 'vendor/tesseract/',
        langPath: 'vendor/tesseract/lang/',
        logger: function (m) { if (onProgress) onProgress(m); }
      });
    }).then(function (w) { _ocrWorker = w; return w; });
    return _ocrLoading;
  }
  function preprocessForOCR(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var W = img.naturalWidth, H = img.naturalHeight;
          if (!W || !H) return resolve(dataUrl);
          var scale = W < 1800 ? Math.min(1800 / W, 3) : 1;
          var w = Math.round(W * scale), h = Math.round(H * scale);
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var d = ctx.getImageData(0, 0, w, h), px = d.data;
          var g = new Uint8ClampedArray(w * h), i, j;
          for (i = 0, j = 0; i < px.length; i += 4, j++) g[j] = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          var out = new Uint8ClampedArray(g.length);
          var at = function (x, y) { return (x < 0 || y < 0 || x >= w || y >= h) ? g[y * w + x] : g[y * w + x]; };
          for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var idx = y * w + x;
            out[idx] = Math.max(0, Math.min(255, 5 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1)));
          }
          for (i = 0, j = 0; i < px.length; i += 4, j++) { px[i] = px[i + 1] = px[i + 2] = out[j]; }
          ctx.putImageData(d, 0, 0);
          resolve(cv.toDataURL('image/png'));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }
  function ocrText(dataUrl, onProgress) {
    if (!window.Tesseract && location.protocol === 'file:') {
      return Promise.resolve({ text: '' });   // file:// 下 worker 受限，直接走手动选
    }
    return ensureTesseract(onProgress).then(function (w) {
      return preprocessForOCR(dataUrl).then(function (clean) {
        return w.recognize(clean);
      }).then(function (r) {
        return { text: ((r && r.data && r.data.text) || '').replace(/\s+/g, '') };
      });
    }).catch(function () { return { text: '' }; });
  }
  function guessKp(text) {
    var best = null, score = 0;
    if (text) {
      (window.MATH_KPS || []).forEach(function (kp) {
        var s2 = 0;
        (kp.keywords || []).forEach(function (w) { if (text.indexOf(w) >= 0) s2 += w.length; });
        if (s2 > score) { score = s2; best = kp; }
      });
    }
    return { kp: best, score: score };
  }

  /* ---------- 真题抽取：从真题库抽 3 道（题目来自教材/真卷，非自编） ---------- */
  function pickRealQuestions(kpId, n) {
    var bank = (window.MATH_BANK || {})[kpId] || [];
    var idx = shuffle(bank.map(function (_, i) { return i; })).slice(0, Math.min(n, bank.length));
    return idx.map(function (i) { return bank[i]; });
  }
  /* 题库答案是否纯数字：数字 → 键盘输入；文字（如“平行四边形”）→ 保留点选 */
  function isNumAns(q) { return q && q.opts && /^-?\d+(\.\d+)?$/.test(String(q.opts[q.ans]).trim()); }
  /* 旧版记录 picks 存的是选项下标，统一重置为未答，避免新旧混用出错 */
  function normSess(s) {
    if (s && s.picks && s.picks.length && typeof s.picks[0] === 'number') {
      s.picks = s.picks.map(function () { return ''; });
      s.done = false; s.got = 0; saveSess(s);
    }
    return s;
  }

  /* ---------- 每日口算（10 题 · 键盘输答案 · 计时 · 评级） ---------- */
  function makeAdd() { var a = rnd(100, 999), b = rnd(10, 99); return { q: a + ' + ' + b, a: a + b }; }
  function makeSub() { var a = rnd(100, 999), b = rnd(10, 99); return { q: a + ' − ' + b, a: a - b }; }
  function makeMul() { var a = rnd(10, 99), b = rnd(2, 9); return { q: a + ' × ' + b, a: a * b }; }
  function makeDiv() { var d = rnd(2, 9), q2 = rnd(3, 9); return { q: (d * q2) + ' ÷ ' + d, a: q2 }; }
  function buildQuiz() {
    var makers = [makeAdd, makeSub, makeMul, makeDiv];
    var qs = makers.map(function (m) { return m(); });
    for (var i = qs.length; i < 10; i++) qs.push(makers[rnd(0, 3)]());
    shuffle(qs);
    qs.forEach(function (q, i) { q.no = i + 1; });
    return qs;
  }
  function ratingOf(right, total) {
    var tiers = [
      { name: '小芽苗', emoji: '🌱', msg: '哪怕只答对 1 题，也是个闪亮的好开始！' },
      { name: '小脚步', emoji: '🐢', msg: '迈开步子了，慢慢来，每天进步一点点！' },
      { name: '小战士', emoji: '🌈', msg: '三题答对，勇敢的小战士！错过的记心里。' },
      { name: '小勇者', emoji: '💡', msg: '四题过关，每个高手都是从这里开始的！' },
      { name: '小攀登', emoji: '🚀', msg: '一半都对啦，再冲一把就过半！' },
      { name: '小稳健', emoji: '🌟', msg: '六题及格，稳稳的，再练练你就能飞！' },
      { name: '潜力星', emoji: '🌟', msg: '七题真棒，潜力新星正在发光！' },
      { name: '进步星', emoji: '💪', msg: '八题优秀，进步之星就是你！' },
      { name: '985星', emoji: '⭐', msg: '九题几乎满分，985 之星闪耀！' },
      { name: '清北苗', emoji: '🚀', msg: '哇，满分小学霸，清华北大在招手！' }
    ];
    var idx = Math.max(0, Math.min(tiers.length - 1, total ? Math.round(right / total * 10) - 1 : right - 1));
    return tiers[idx];
  }
  var _quiz = null, _quizTimer = null, _quizStart = 0;

  /* ---------- 自绘数字键盘（不弹系统输入法，题目/输入框不会被遮挡） ----------
   * makePad(mount, limit, onOk) → { get, lock, mark }
   *   mount  挂载容器；limit 最大位数；onOk(val) 点“确定”时回调，回调里调 pad.lock()/mark()
   */
  function makePad(mount, limit, onOk) {
    var val = '';
    var h = '<div class="padDisp" style="height:54px;border:2.5px solid #1D4ED8;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;color:#94A3B8;background:#F8FAFC;margin-bottom:8px;letter-spacing:2px">点下方键盘输入答案</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;max-width:360px;margin:0 auto">';
    var KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '确'];
    KEYS.forEach(function (k) {
      var bg = '#fff', fg = '#1E293B', bd = '#e2e8f0', fs = 24;
      if (k === '⌫') { bg = '#FEF3C7'; fg = '#B45309'; bd = '#FDE68A'; fs = 22; }
      if (k === '确') { bg = '#1D4ED8'; fg = '#fff'; bd = '#1D4ED8'; fs = 22; }
      h += '<button class="pad-k" data-k="' + k + '" style="font-size:' + fs + 'px;font-weight:800;padding:13px 0;border-radius:12px;border:1.5px solid ' + bd + ';background:' + bg + ';color:' + fg + ';box-shadow:0 1px 2px rgba(15,23,42,.08)">' + k + '</button>';
    });
    h += '</div>';
    mount.innerHTML = h;
    var disp = mount.querySelector('.padDisp');
    var btns = mount.querySelectorAll('.pad-k');
    var locked = false;
    function draw() {
      disp.textContent = val === '' ? '点下方键盘输入答案' : val;
      disp.style.color = val === '' ? '#94A3B8' : '#1E293B';
    }
    function lock() { locked = true; for (var i = 0; i < btns.length; i++) { btns[i].disabled = true; btns[i].style.opacity = 0.55; } }
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = (function (b) {
        return function () {
          if (locked) return;
          var k = b.getAttribute('data-k');
          if (k === '确') {
            if (val === '') { toast('先输入答案哦'); return; }
            onOk(val); return;
          }
          if (k === '⌫') { val = val.slice(0, -1); }
          else if (val.length < limit) { val += k; }
          draw();
        };
      })(btns[i]);
    }
    draw();
    return {
      get: function () { return val; },
      lock: lock,
      mark: function (ok, note) {
        disp.style.borderColor = ok ? '#16A34A' : '#DC2626';
        disp.style.color = ok ? '#16A34A' : '#DC2626';
        disp.textContent = (val || '') + (note ? '　' + note : '');
      }
    };
  }

  /* ---------- 路由与渲染 ---------- */
  var maRoute = { page: 'home' };
  function el(id) { return document.getElementById(id); }

  function renderHome(box) {
    var n = sessList().length;
    var best = xget('quiz_best_' + dayKey(), null);
    box.innerHTML =
      '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      + '<button class="icon-btn" data-ma-go="backHome" title="返回">‹ 返回</button><h2 style="margin:0">🧮 数学</h2></div>'
      + '<p class="sub" style="margin-bottom:14px">今天先来练一练！口算热热身，或把错题拍下来针对性练。</p>'
      + '<button class="big-btn bg-p" data-ma-go="quiz" style="width:100%;margin-bottom:10px"><span class="ico">📝</span>'
      + '<span>每日口算打卡<small>10 道口算 · 键盘输答案 · 计时评级' + (best ? ' · 今日最佳 ' + best.right + '/10' : '') + '</small></span></button>'
      + '<div style="display:flex;gap:10px;margin-bottom:10px">'
      + '<button class="big-btn bg-b" id="maCam" style="flex:1"><span class="ico">📷</span><span>拍照错题<small>打开相机</small></span></button>'
      + '<button class="big-btn bg-c" id="maAlbum2" style="flex:1"><span class="ico">🖼️</span><span>相册选图<small>或选电脑截图</small></span></button></div>'
      + '<button class="big-btn bg-o" data-ma-go="album" style="width:100%;margin-bottom:14px"><span class="ico">🗂️</span>'
      + '<span>我的错题本<small>共 ' + n + ' 张 · 按时间排列</small></span></button>'
      + '<div id="maWork"></div>'
      + '<input type="file" id="maFile" accept="image/*" style="display:none">'
      + '<div class="card"><div style="font-weight:800;margin-bottom:6px">怎么用？</div>'
      + '<div style="color:#475569;font-size:15px;line-height:1.9">① 拍下或选一张错题照片<br>'
      + '② <b>拖动四角，只框住这一道题</b>（一张照片有多题时尤其有用）<br>'
      + '③ 自动识别知识点（认不出会请你选），从<b>真题库</b>抽 3 道同类题（计算题键盘输答案，概念题点选）<br>'
      + '④ 做完自动判分，每题都有解析和出处；错题自动存进错题本<br>'
      + '<span style="font-size:13px">照片只存在本机浏览器里，首次识别需下载约 20MB 识别包（之后离线可用）</span></div></div>';
    var fi = el('maFile');
    if (fi) {
      fi.onchange = function () { if (fi.files && fi.files[0]) handlePhoto(fi.files[0]); fi.value = ''; };
    }
    var cam = el('maCam'); if (cam) cam.onclick = function () { fi.setAttribute('capture', 'environment'); fi.click(); };
    var alb = el('maAlbum2'); if (alb) alb.onclick = function () { fi.removeAttribute('capture'); fi.click(); };
  }

  function workBox() { return el('maWork'); }

  function handlePhoto(file) {
    if (!/^image\//.test(file.type)) { toast('请选择一张图片哦'); return; }
    var box = workBox();
    box.innerHTML = '<div class="card" style="text-align:center;padding:16px"><div>正在读取照片…</div></div>';
    fileToDataURL(file, 1600).then(function (big) {
      return Crop.open(big, { title: '框住你要练的那道题' }).then(function (picked) {
        if (picked === null) { box.innerHTML = '<div class="card" style="text-align:center;color:#475569">已取消，重新选一张吧</div>'; return null; }
        return resizeDataURL(picked, 1400);
      });
    }).then(function (picked) {
      if (!picked) return;
      box.innerHTML = '<div class="card" style="text-align:center;padding:16px" id="maOcrBox"><div id="maOcrStep">正在准备识别引擎…（首次约 20MB，之后离线秒开）</div></div>';
      var step = function () { var s2 = el('maOcrStep'); return s2; };
      ocrText(picked, function (m) {
        if (m && m.status) {
          var pct = m.progress != null ? Math.round(m.progress * 100) : 0;
          var L = { 'loading language traineddata': '正在下载识别包', 'initializing tesseract': '正在准备识别引擎', 'recognizing text': '正在识别文字', 'recognized': '识别完成' };
          var e2 = step(); if (e2) e2.textContent = (L[m.status] || m.status) + (pct ? '（' + pct + '%）' : '') + '…';
        }
      }).then(function (r) {
        var g = guessKp(r.text);
        if (g.kp && g.score >= 2) { startSession(g.kp.id, r.text, picked); return; }
        /* 认不出 → 手动选，绝不随机抽 */
        var h = '<div class="card"><div style="font-weight:800">🔍 没认出这道是什么题</div>'
          + '<div style="color:#475569;font-size:14px;margin-top:6px">' + (r.text ? '我读到的文字：<b>' + esc(r.text.slice(0, 60)) + '</b>' : '没有读到文字（照片可能不够清晰）') + '</div>'
          + '<div style="margin-top:10px;font-size:14px;color:#475569">请选一下这道题考的知识点：</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
        (window.MATH_KPS || []).forEach(function (k) {
          h += '<button class="btn btn-o" data-ma-kp="' + k.id + '" style="font-size:13px;padding:6px 10px">' + k.emoji + ' ' + esc(k.name) + '</button>';
        });
        h += '</div></div>';
        box.innerHTML = h;
        var btns = box.querySelectorAll('[data-ma-kp]');
        for (var i = 0; i < btns.length; i++) {
          btns[i].onclick = (function (b) { return function () { startSession(b.getAttribute('data-ma-kp'), r.text, picked); }; })(btns[i]);
        }
      });
    }).catch(function () {
      box.innerHTML = '<div class="card" style="text-align:center">照片处理失败，换一张试试～</div>';
    });
  }

  function startSession(kpId, ocrTxt, photo) {
    var kp = null;
    (window.MATH_KPS || []).forEach(function (k) { if (k.id === kpId) kp = k; });
    if (!kp) { toast('知识点不见了'); return; }
    var qs = pickRealQuestions(kpId, 3);
    if (!qs.length) { toast('这个知识点的真题库还在补充中，换一个知识点吧'); return; }
    var s = {
      id: 's' + Date.now(), kp: kpId, kpName: kp.name, emoji: kp.emoji, color: kp.color,
      ocr: ocrTxt || '', photo: photo || '', time: nowStr(),
      qs: qs, picks: ['', '', ''], done: false, got: 0
    };
    saveSess(s);
    maRoute = { page: 'sess', id: s.id };
    render(el('maBody'));
  }

  function renderQuiz(box) {
    _quiz = buildQuiz();
    _quizStart = Date.now();
    var best = xget('quiz_best_' + dayKey(), null);
    var h = '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      + '<button class="icon-btn" data-ma-go="home" title="返回">‹ 返回</button><h2 style="margin:0">📝 每日口算打卡</h2></div>'
      + '<p class="sub" style="margin-bottom:10px">10 道口算直接输答案，计时开始！' + (best ? '今日最佳：' + best.right + '/10 · ' + best.rating : '') + '</p>'
      + '<div class="card" id="quizCard"></div>'
      + '<div style="text-align:center;margin-top:10px;font-size:14px;color:#475569">⏱ <span id="quizTime">00:00</span></div>';
    box.innerHTML = h;
    clearInterval(_quizTimer);
    _quizTimer = setInterval(function () {
      var t = el('quizTime');
      if (!t) { clearInterval(_quizTimer); return; }
      var ms = Date.now() - _quizStart, s2 = Math.floor(ms / 1000);
      t.textContent = String(Math.floor(s2 / 60)).padStart(2, '0') + ':' + String(s2 % 60).padStart(2, '0');
    }, 500);
    renderQuizQ(0, 0);
  }
  function renderQuizQ(i, right) {
    var card = el('quizCard');
    if (!card) return;
    if (i >= _quiz.length) { quizDone(right); return; }
    var q = _quiz[i];
    window.scrollTo(0, 0);   /* 换题回到顶部：题目和输入框始终在最上面，键盘不压住 */
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
      + '<b>第 ' + (i + 1) + ' / ' + _quiz.length + ' 题</b><span class="chip" style="background:#DBEAFE;color:#1D4ED8">已对 ' + right + '</span></div>'
      + '<div style="font-size:34px;font-weight:800;text-align:center;margin:6px 0 12px">' + esc(q.q) + ' =</div>'
      + '<div id="quizPad"></div>';
    card.innerHTML = h;
    var pad = makePad(el('quizPad'), 6, function (v) {
      var ok = Number(v) === q.a;
      pad.lock();
      pad.mark(ok, ok ? '✔ 答对了' : '✘ 正确答案 ' + q.a);
      if (window.sfxTap) sfxTap(); else if (ok && window.sfxRight) sfxRight();
      setTimeout(function () { renderQuizQ(i + 1, right + (ok ? 1 : 0)); }, 650);
    });
  }
  function quizDone(right) {
    clearInterval(_quizTimer);
    var ms = Date.now() - _quizStart;
    var rt = ratingOf(right, 10);
    var prevBest = xget('quiz_best_' + dayKey(), null);
    if (!prevBest || right > prevBest.right) xset('quiz_best_' + dayKey(), { right: right, rating: rt.name, time: fmtT(ms) });
    var hist = xget('quiz_hist', []);
    hist.unshift({ d: dayKey(), right: right, t: fmtT(ms) });
    xset('quiz_hist', hist.slice(0, 60));
    var card = el('quizCard');
    if (card) card.innerHTML =
      '<div style="text-align:center;padding:16px 8px">'
      + '<div style="font-size:44px">' + rt.emoji + '</div>'
      + '<div style="font-size:24px;font-weight:800;margin:6px 0">' + right + ' / 10 · ' + rt.name + '</div>'
      + '<div style="color:#475569;margin-bottom:8px">用时 ' + fmtT(ms) + '</div>'
      + '<div style="color:#475569;font-size:15px;margin-bottom:14px">' + rt.msg + '</div>'
      + '<button class="btn btn-p" data-ma-go="quiz">再刷一套</button> '
      + '<button class="btn btn-o" data-ma-go="home">回数学首页</button></div>';
  }
  function fmtT(ms) {
    var s2 = Math.floor(ms / 1000);
    return String(Math.floor(s2 / 60)).padStart(2, '0') + ':' + String(s2 % 60).padStart(2, '0');
  }

  function renderAlbum(box) {
    var list = sessList().map(function (id) { return getSess(id); }).filter(Boolean);
    var h = '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      + '<button class="icon-btn" data-ma-go="home" title="返回">‹ 返回</button><h2 style="margin:0">🗂️ 我的错题本</h2></div>';
    if (!list.length) {
      h += '<div class="card" style="text-align:center;color:#475569;padding:20px">还没有错题。拍一张错题照片试试～</div>';
      box.innerHTML = h; return;
    }
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    list.forEach(function (s) {
      h += '<div class="card" style="padding:8px;cursor:pointer" data-ma-sess="' + s.id + '">'
        + (s.photo ? '<img src="' + s.photo + '" style="width:100%;height:110px;object-fit:cover;border-radius:10px">' : '<div style="height:110px;display:flex;align-items:center;justify-content:center;font-size:34px">' + s.emoji + '</div>')
        + '<div style="font-weight:700;font-size:14px;margin-top:6px">' + s.emoji + ' ' + esc(s.kpName) + '</div>'
        + '<div style="font-size:12px;color:#64748B">' + esc(s.time) + ' · ' + (s.done ? '得分 ' + s.got + '/' + s.qs.length : '未练完') + '</div></div>';
    });
    h += '</div>';
    box.innerHTML = h;
    var cards = box.querySelectorAll('[data-ma-sess]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].onclick = (function (c) {
        return function () { maRoute = { page: 'sess', id: c.getAttribute('data-ma-sess') }; render(el('maBody')); };
      })(cards[i]);
    }
  }

  function renderSess(box, id) {
    var s = normSess(getSess(id));
    if (!s) { box.innerHTML = '<div class="card" style="text-align:center">这条错题记录不见了</div>'; return; }
    var qi = 0;
    while (qi < s.qs.length && s.picks[qi] !== '') qi++;
    var h = '<div class="page-head" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      + '<button class="icon-btn" data-ma-go="album" title="返回">‹ 返回</button>'
      + '<h2 style="margin:0">' + s.emoji + ' ' + esc(s.kpName) + '</h2></div>'
      + '<p class="sub" style="margin-bottom:8px">' + esc(s.time) + '</p>';
    if (!s.done) {
      /* 题目和输入框上移：紧跟页头，照片缩小放到键盘下方，避免被数字键盘压住 */
      var q = s.qs[qi];
      h += '<div class="card" style="margin-bottom:10px"><div style="font-weight:800;margin-bottom:2px">同类真题 第 ' + (qi + 1) + ' / ' + s.qs.length + ' 题</div>'
        + '<div style="font-size:19px;line-height:1.7;margin:6px 0 12px">' + esc(q.q) + '</div>';
      if (isNumAns(q)) {
        h += '<div id="maPad"></div>';
      } else {
        var LABELS = ['A', 'B', 'C', 'D'];
        q.opts.forEach(function (o, oi) {
          h += '<button class="btn btn-o" data-ma-opt="' + oi + '" style="display:block;width:100%;text-align:left;margin-bottom:8px"><b>' + LABELS[oi] + '.</b> ' + esc(o) + '</button>';
        });
      }
      h += '</div><div id="maExp"></div>';
      h += s.photo ? '<div class="card" style="margin-top:10px"><div style="font-weight:800;margin-bottom:4px">📷 拍的这道题（点图放大）</div>'
        + '<img src="' + s.photo + '" id="maPhoto" style="width:100%;max-height:110px;object-fit:cover;object-position:top;border-radius:10px;cursor:pointer"></div>' : '';
    } else {
      h += s.photo ? '<img src="' + s.photo + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:14px;margin-bottom:10px">' : '';
      h += sessResultHtml(s);
    }
    h += '<div class="card" style="margin-top:10px"><div style="font-weight:800;margin-bottom:4px">📝 识别出的题目文字（可改）</div>'
      + '<textarea rows="2" style="width:100%;box-sizing:border-box;font-size:14px;padding:8px;border-radius:10px;border:1.5px solid #d9e2ec;font-family:inherit" placeholder="识别出的题目文字（可改）">' + esc(s.ocr || '') + '</textarea>'
      + '<div style="display:flex;gap:8px;margin-top:8px">'
      + '<button class="btn btn-o" data-ma-go="repractice" style="flex:1">再练 3 题</button>'
      + '<button class="btn btn-o" data-ma-go="delsess" style="flex:1;color:#DC2626">删除这条</button></div></div>';
    box.innerHTML = h;

    /* 点小图放大查看 */
    var ph = el('maPhoto');
    if (ph) {
      ph.onclick = function () {
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.92);display:flex;align-items:center;justify-content:center;padding:12px;cursor:zoom-out';
        var im = new Image(); im.src = s.photo;
        im.style.cssText = 'max-width:100%;max-height:100%;border-radius:8px';
        ov.appendChild(im);
        ov.onclick = function () { document.body.removeChild(ov); };
        document.body.appendChild(ov);
      };
    }

    if (!s.done) {
      if (isNumAns(s.qs[qi])) {
        makePad(el('maPad'), 12, function (v) {
          answerSess(box, id, qi, v);
        });
      }
      var btns = box.querySelectorAll('[data-ma-opt]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].onclick = (function (bi) { return function () { answerSess(box, id, qi, s.qs[qi].opts[bi]); }; })(i);
      }
    }
  }
  function sessResultHtml(s) {
    return '<div class="card" style="text-align:center;padding:14px">'
      + '<div style="font-size:30px">' + (s.got === s.qs.length ? '🏆' : s.got >= 2 ? '👍' : '💪') + '</div>'
      + '<div style="font-size:22px;font-weight:800;margin:4px 0">得分 ' + s.got + ' / ' + s.qs.length + '</div>'
      + '<div style="color:#475569;font-size:14px">' + (s.got === s.qs.length ? '全对！这个知识点过关了' : '错题解析都在下面，再看一遍就懂了') + '</div></div>'
      + '<div class="card" style="margin-top:10px"><div style="font-weight:800;margin-bottom:8px">逐题回顾</div>'
      + s.qs.map(function (q, i) {
        var ans = String(q.opts[q.ans]).trim();
        var ok = s.picks[i] === ans;
        return '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #e2e8f0">'
          + '<div style="font-size:15px;line-height:1.7"><b>' + (i + 1) + '.</b> ' + esc(q.q) + '</div>'
          + '<div style="font-size:14px;margin-top:2px;color:' + (ok ? '#16A34A' : '#DC2626') + '">你答了 ' + (s.picks[i] ? esc(s.picks[i]) : '（未答）') + (ok ? ' ✔' : '，正确答案是 ' + esc(ans)) + '</div>'
          + '<div style="font-size:13px;color:#475569;margin-top:2px">💡 ' + esc(q.exp) + '</div>'
          + '<div style="font-size:12px;color:#94A3B8;margin-top:2px">出处：' + esc(q.src) + '</div></div>';
      }).join('') + '</div>';
  }
  function answerSess(box, id, qi, pickedText) {
    var s = getSess(id);
    if (!s || s.picks[qi] !== '') return;
    var q = s.qs[qi];
    var ans = String(q.opts[q.ans]).trim();
    var typed = String(pickedText).trim();
    s.picks[qi] = typed;
    var ok = typed === ans;
    if (ok) s.got++;
    /* 输入题：键盘变色锁定；点选题：按钮变灰锁定 */
    var padDisp = box.querySelector('.padDisp');
    if (padDisp && isNumAns(q)) {
      padDisp.style.borderColor = ok ? '#16A34A' : '#DC2626';
      padDisp.style.color = ok ? '#16A34A' : '#DC2626';
      padDisp.textContent = typed + (ok ? '　✔ 答对了' : '　✘ 正确答案 ' + ans);
    }
    var pks = box.querySelectorAll('.pad-k');
    for (var p = 0; p < pks.length; p++) { pks[p].disabled = true; pks[p].style.opacity = 0.55; }
    var optBtns = box.querySelectorAll('[data-ma-opt]');
    for (var i2 = 0; i2 < optBtns.length; i2++) {
      optBtns[i2].disabled = true; optBtns[i2].style.opacity = 0.6;
      if (optBtns[i2].textContent.indexOf(typed) >= 0 && ok) { optBtns[i2].style.opacity = 1; optBtns[i2].style.background = '#DCFCE7'; }
    }
    var expBox = el('maExp');
    if (expBox) {
      expBox.innerHTML = '<div class="card" style="border:2px solid ' + (ok ? '#16A34A' : '#DC2626') + '">'
        + '<div style="font-weight:800;color:' + (ok ? '#16A34A' : '#DC2626') + '">' + (ok ? '答对了！' : '答错了，正确答案是 ' + esc(ans)) + '</div>'
        + '<div style="font-size:14px;color:#334155;margin-top:4px">💡 ' + esc(q.exp) + '</div>'
        + '<div style="font-size:12px;color:#94A3B8;margin-top:2px">出处：' + esc(q.src) + '</div>'
        + '<button class="btn btn-p" data-ma-go="nextq" style="margin-top:8px">' + (qi + 1 < s.qs.length ? '下一题' : '看结果') + '</button></div>';
      var nb = expBox.querySelector('[data-ma-go="nextq"]');
      if (nb) nb.onclick = function () {
        if (qi + 1 >= s.qs.length) { s.done = true; }
        saveSess(s);
        renderSess(box, id);
      };
    }
    saveSess(s);
  }

  function render(box) {
    if (!window.MATH_KPS || !window.MATH_BANK) {
      box.innerHTML = '<div class="card" style="text-align:center">数学题库数据没加载出来（data/math_bank.js 缺失），刷新试试</div>';
      return;
    }
    if (maRoute.page === 'quiz') { renderQuiz(box); return; }
    if (maRoute.page === 'album') { renderAlbum(box); return; }
    if (maRoute.page === 'sess') { renderSess(box, maRoute.id); return; }
    renderHome(box);
  }

  function handle(box, attr, elm) {
    var v = elm.getAttribute(attr);
    if (attr === 'data-ma-kp') return;   // 已在 handlePhoto 里单独绑定
    if (v === 'home') { maRoute = { page: 'home' }; render(box); return; }
    if (v === 'quiz') { maRoute = { page: 'quiz' }; render(box); return; }
    if (v === 'album') { maRoute = { page: 'album' }; render(box); return; }
    if (v === 'backHome') {
      if (window.switchView) switchView('home'); else { maRoute = { page: 'home' }; render(box); }
      return;
    }
    if (v === 'repractice') {
      var s = getSess(maRoute.id);
      if (s) {
        s.qs = pickRealQuestions(s.kp, 3); s.picks = ['', '', '']; s.done = false; s.got = 0;
        saveSess(s); renderSess(box, s.id);
      }
      return;
    }
    if (v === 'delsess') {
      if (window.confirmModal) {
        confirmModal('删除这条错题记录？', '照片和练习记录都会删掉，删了就找不回来了。', function () {
          delSess(maRoute.id); maRoute = { page: 'album' }; render(box);
        }, '删除');
      } else if (confirm('删除这条错题记录？')) { delSess(maRoute.id); maRoute = { page: 'album' }; render(box); }
      return;
    }
  }

  function bindOnce(box) {
    if (box.__maBound) return;
    box.__maBound = true;
    box.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== box) {
        if (t.getAttribute && t.getAttribute('data-ma-opt')) return;   // 单独绑
        if (t.getAttribute && t.getAttribute('data-ma-kp')) return;
        if (t.getAttribute && t.getAttribute('data-ma-go')) { handle(box, 'data-ma-go', t); return; }
        if (t.getAttribute && t.getAttribute('data-ma-sess')) { handle(box, 'data-ma-sess', t); return; }
        t = t.parentNode;
      }
    });
  }

  function open() {
    var box = el('maBody');
    if (!box) return;
    bindOnce(box);
    render(box);
  }

  return { open: open, render: render, pickRealQuestions: pickRealQuestions, guessKp: guessKp };
})();
