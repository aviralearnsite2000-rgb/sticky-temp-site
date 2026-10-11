/*!
 * loader.js — صفحهٔ لودینگ Sticky Temp (v4)
 *
 * وظیفه‌ها:
 *  ۱) تا آماده شدن «همه چیزِ لازم برای تجربهٔ اسکرول» صفحه را قفل و پوشیده نگه می‌دارد:
 *     فونت، عکس‌های هیرو (کودک/مادر)، آمادگی DOM، و فریم‌های «پوشش درشت» انیمیشن
 *     (همانی که پرواز استیج ۱→۲ برای نرم بودن لازم دارد).
 *  ۲) پیشرفت واقعی را نشان می‌دهد؛ حداقل ۱٫۶ ثانیه (تا نپرد) و حداکثر ۱۰ ثانیه (تا گیر نکند) می‌ماند.
 *  ۳) در پایان لنگه‌ها باز می‌شوند، قفل برداشته می‌شود و رویداد `stickytemp:ready` ارسال می‌شود.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var el = document.getElementById('stLoader');
  if (!el) { root.classList.remove('st-loading'); return; }

  window.__stReady = false;
  var MIN_MS = 1600, MAX_MS = 10000;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var t0 = performance.now();
  var FA = '۰۱۲۳۴۵۶۷۸۹';
  var fa = function (s) { return String(s).replace(/\d/g, function (d) { return FA[d]; }).replace('.', '٫'); };

  var tempEl = document.getElementById('stTemp');
  var pctEl = document.getElementById('stPct');
  var msgEl = document.getElementById('stMsg');
  var barEl = document.getElementById('stBar');
  var ticksG = document.getElementById('stTicks');

  /* ---------- مدرج گیج: ۶۰ خط دور سنسور ---------- */
  var N = 60, ticks = [];
  (function build() {
    if (!ticksG) return;
    var ns = 'http://www.w3.org/2000/svg', cx = 110, cy = 110, r1 = 98, r2 = 106;
    for (var i = 0; i < N; i++) {
      var a = (-90 + (i / N) * 360) * Math.PI / 180;
      var len = i % 5 === 0 ? 0 : 3;             // هر پنجمی بلندتر
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', (cx + Math.cos(a) * (r1 - len)).toFixed(2));
      l.setAttribute('y1', (cy + Math.sin(a) * (r1 - len)).toFixed(2));
      l.setAttribute('x2', (cx + Math.cos(a) * r2).toFixed(2));
      l.setAttribute('y2', (cy + Math.sin(a) * r2).toFixed(2));
      l.setAttribute('class', 'st-tick');
      ticksG.appendChild(l); ticks.push(l);
    }
  })();

  /* ---------- پیگیری آماده‌شدن منابع ---------- */
  var part = { font: 0, imgs: 0, load: 0, frames: 0 };
  var W = { font: 0.08, imgs: 0.17, load: 0.05, frames: 0.70 };

  // فونت
  (function () {
    if (!document.fonts || !document.fonts.ready) { part.font = 1; return; }
    var done = function () { part.font = 1; };
    document.fonts.ready.then(done, done);
    setTimeout(done, 3500);
  })();

  // عکس‌های هیرو (decode شده تا اولین نمایش بدون پرش باشد)
  (function () {
    var list = ['assets/img/baby.webp', 'assets/img/mother.webp'], n = 0;
    list.forEach(function (u) {
      var im = new Image(); im.decoding = 'async';
      var fin = function () { n++; part.imgs = n / list.length; };
      im.onload = function () { (im.decode ? im.decode().then(fin, fin) : fin()); };
      im.onerror = fin;
      im.src = u;
    });
  })();

  // آمادگی DOM (رویداد load عمداً شرط نیست: بارگذاری پس‌زمینهٔ ۲۰۰ فریم آن را عقب می‌اندازد)
  if (document.readyState !== 'loading') part.load = 1;
  else document.addEventListener('DOMContentLoaded', function () { part.load = 1; });

  // فریم‌های انیمیشن: ProductShot در پایان body بارگذاری می‌شود
  var shotStarted = false;
  function pollFrames() {
    var PS = window.ProductShot;
    if (!PS || !PS.coarseProgress) return;
    if (!shotStarted) { shotStarted = true; try { PS.startPreload(); } catch (e) {} }
    var p = PS.coarseProgress();
    part.frames = p.total ? p.ready / p.total : 1;
  }

  /* ---------- حلقهٔ نمایش ---------- */
  var shown = 0;            // درصد نمایش‌داده‌شده (۰…۱۰۰) — همیشه صعودی
  var finishing = false;
  var lastMsg = -1;
  var MSGS = ['سنسور در حال روشن شدن', 'نمایشگر آماده می‌شود', 'انیمیشن‌ها بارگذاری می‌شوند', 'تقریباً آماده است', 'آماده است'];

  function target() {
    var sum = 0; for (var k in W) sum += W[k] * part[k];
    return sum * 100;
  }
  function allDone() { return part.font >= 1 && part.imgs >= 1 && part.load >= 1 && part.frames >= 1; }

  function paint(p) {
    var lit = Math.round((p / 100) * N);
    for (var i = 0; i < N; i++) {
      var on = i < lit;
      if (ticks[i]._on !== on) { ticks[i]._on = on; ticks[i].classList.toggle('on', on); }
      var head = on && i === lit - 1 && p < 100;
      if (ticks[i]._h !== head) { ticks[i]._h = head; ticks[i].classList.toggle('head', head); }
    }
    // دمای بدن از ۳۵٫۰ تا ۳۶٫۸ (عادی؛ هرگز قرمز نمی‌شود)
    var t = 35 + 1.8 * (p / 100);
    if (tempEl) tempEl.textContent = fa(t.toFixed(1));
    if (pctEl) pctEl.textContent = fa(Math.round(p)) + '٪';
    if (barEl) barEl.style.transform = 'scaleX(' + (p / 100).toFixed(4) + ')';
    var m = p >= 100 ? 4 : p >= 80 ? 3 : p >= 45 ? 2 : p >= 15 ? 1 : 0;
    if (m !== lastMsg && msgEl) { lastMsg = m; msgEl.textContent = MSGS[m]; }
    el.setAttribute('aria-valuenow', Math.round(p));
  }

  function tick(now) {
    pollFrames();
    var elapsed = now - t0;
    var timeCap = Math.min(1, elapsed / MIN_MS) * 100;     // حداقل زمان نمایش
    var real = allDone() ? 100 : Math.min(target(), 99);
    var want = Math.min(real, timeCap);
    // نرم‌سازی زمان‌محور (مستقل از نرخ فریم): نزدیک شدن نمایی + حداقل سرعت تا انتهای راه گیر نکند
    var dt = Math.min(100, now - (tick.last || now)); tick.last = now;
    if (want > shown) {
      var k = 1 - Math.exp(-dt / 160);
      shown = Math.min(want, shown + Math.max((want - shown) * k, dt * 0.03));
    }
    paint(shown);

    if (shown >= 100 && !finishing) { finish(); return; }
    if (elapsed > MAX_MS && !finishing) { shown = 100; paint(100); finish(); return; }
    requestAnimationFrame(tick);
  }

  /* ---------- پایان: باز شدن لنگه‌ها ---------- */
  function finish() {
    finishing = true;
    paint(100);
    el.classList.add('is-done');
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () {
        el.classList.add('is-open');
        // قفل را کمی زودتر برمی‌داریم تا هیرو هم‌زمان با باز شدن زنده شود، اما اسکرول تا پایان باز شدن بسته می‌ماند
        root.classList.add('st-opening');      // اسکرول تا پایان باز شدن لنگه‌ها بسته می‌ماند
        root.classList.remove('st-loading');   // انیمیشن‌های هیرو از همین‌جا شروع می‌شوند
        window.scrollTo(0, 0);
        document.dispatchEvent(new CustomEvent('stickytemp:ready'));
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
          root.classList.remove('st-opening');
          window.__stReady = true;
        }, reduce ? 450 : 1050);
      }, reduce ? 0 : 380);
    }, 420);
  }

  // لودینگ، اسکرول/لمس/کلید را کاملاً می‌بندد
  function block(e) { if (window.__stReady === false) e.preventDefault(); }
  ['touchmove', 'wheel'].forEach(function (n) { el.addEventListener(n, block, { passive: false }); });
  window.addEventListener('keydown', function (e) {
    if (window.__stReady === false && [' ', 'Space', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) > -1) e.preventDefault();
  }, { passive: false });

  window.__stLoaderStart = t0;
  paint(0);
  requestAnimationFrame(tick);
})();
