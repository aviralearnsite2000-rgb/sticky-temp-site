/*!
 * product-shot.js — جایگزین سبک model-viewer برای Sticky Temp (نسخهٔ ۲)
 *
 * فریم‌های پخته‌شده (WebP شفاف) را روی یک <canvas> می‌کشد و همان API قبلی
 * (cameraOrbit، variantName، jumpCameraToGoal، getCameraOrbit، رویداد load) را دارد.
 *
 * تغییرات نسخهٔ ۲ (رفع «تیک زدن» و ناپیوستگی چرخش):
 *  ۱) پیش‌بارگذاری کامل و «پیش‌دیکود» همهٔ فریم‌ها (createImageBitmap / img.decode)
 *     قبل از اینکه لازم شوند؛ دیکود شدن هنگام رسم دیگر روی نخ اصلی اتفاق نمی‌افتد.
 *  ۲) ترتیب «تدریجی» بارگذاری: اول هر ۸ فریم یکی، بعد هر ۴، هر ۲ و بقیه؛ پس حتی اگر
 *     کاربر زود اسکرول کند، پوشش کامل مسیر با فاصلهٔ کم وجود دارد.
 *  ۳) اگر فریم دقیقِ لحظه هنوز نرسیده باشد، «نزدیک‌ترین فریم آماده» کشیده می‌شود
 *     (هرگز روی فریم قدیمی گیر نمی‌کند) و به محض رسیدن، جایگزین می‌شود.
 *  ۴) درون‌یابی بین دو فریم مجاور (cross-fade دقیق با composite «lighter»):
 *     زاویه‌های بین دو فریم هم نرم دیده می‌شوند ⇒ ۶۱/۹۰ فریم مثل ۶۰fps حس می‌شود.
 *  ۵) صفحهٔ «عادی» نمایشگر حالا مسیر چرخش کامل دارد (dnormal_000…060، همان مسیر dalert)
 *     ⇒ نمایشگر در پرواز استیج ۱→۲ واقعاً می‌چرخد و در پایان بی‌پرش به صفحهٔ هشدار می‌رود.
 *  ۶) تعویض صفحه (variant) با محوشدن نرم ۳۰۰ میلی‌ثانیه‌ای.
 *  ۷) صف اولویت‌دار واقعی: درخواست فوری (فریم جاری) از صف عقب نمی‌ماند.
 */
(function () {
  'use strict';
  // صفحه‌های کوچک (موبایل/تبلت عمودی): نسخهٔ سبک‌تر همان فریم‌ها (۷۲۰px / سنسور ۴۵۰px)
  // اندازهٔ نمایش واقعی روی موبایل ≈ ۲۴۰px × DPR3 ⇒ ۷۲۰ کافی است و حجم ≈ ۴۰٪ می‌شود.
  var SMALL = Math.min(screen.width || 9999, window.innerWidth || 9999) <= 820;
  var BASE = SMALL ? 'assets/frames/m/' : 'assets/frames/';
  var pad = function (i) { return ('00' + i).slice(-3); };
  var list = function (p, n) { var a = []; for (var i = 0; i < n; i++) a.push(BASE + p + '_' + pad(i) + '.webp'); return a; };

  // مسیر دوربین نمایشگر (همان مسیر پخت در tools/bake.mjs، حالت disp)
  var DISP_TH0 = 25, DISP_TH1 = -45;
  // سنسور: فریم i ⇔ θ = −195 + 4·i  (۹۰ فریم = ۳۶۰°)
  var ASM_TH0 = -195, ASM_STEP = 4;

  var SETS = {
    display: { normal: list('dnormal', 61), alert: list('dalert', 61), 'new': [BASE + 'show_000.webp'], size: SMALL ? 720 : 1200 },
    sensor: { all: list('asm', 90), size: SMALL ? 450 : 900, loop: true }
  };

  /* ---------------- بارگذار با اولویت ---------------- */
  var cache = {};          // url → {state:0|1|2|3, bmp, prio, waiters[]}  (0=صف،1=در حال،2=آماده،3=خطا)
  var queue = [];
  var active = 0;
  var MAX_ACTIVE = 6;
  var canBitmap = typeof createImageBitmap === 'function';

  function entry(url) {
    var c = cache[url];
    if (!c) { c = cache[url] = { url: url, state: 0, bmp: null, prio: -1, waiters: [] }; queue.push(c); }
    return c;
  }
  function request(url, prio) {
    var c = entry(url);
    if (c.state === 0 && prio > c.prio) { c.prio = prio; queue.sorted = false; }
    pump();
    return c;
  }
  function whenReady(c) {
    if (c.state >= 2) return Promise.resolve(c);
    return new Promise(function (res) { c.waiters.push(res); });
  }
  function settle(c, bmp, ok) {
    c.bmp = bmp; c.state = ok ? 2 : 3; active--;
    var w = c.waiters; c.waiters = [];
    for (var i = 0; i < w.length; i++) w[i](c);
    pump();
  }
  function pump() {
    if (active >= MAX_ACTIVE) return;
    if (!queue.sorted) { queue.sort(function (a, b) { return b.prio - a.prio; }); queue.sorted = true; }
    while (active < MAX_ACTIVE && queue.length) {
      var c = queue.shift();
      if (c.state !== 0) continue;
      c.state = 1; active++;
      load(c);
    }
  }
  function load(c) {
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      var p = canBitmap
        ? createImageBitmap(img).catch(function () { return img.decode ? img.decode().then(function () { return img; }) : img; })
        : (img.decode ? img.decode().then(function () { return img; }, function () { return img; }) : Promise.resolve(img));
      p.then(function (b) { settle(c, b || img, true); });
    };
    img.onerror = function () { settle(c, null, false); };
    img.src = c.url;
  }

  // ترتیب تدریجی: 0,8,16… سپس 4,12… سپس 2,6… سپس فردها
  function progressiveOrder(n) {
    var seen = {}, out = [];
    [8, 4, 2, 1].forEach(function (s) { for (var i = 0; i < n; i += s) if (!seen[i]) { seen[i] = 1; out.push(i); } });
    if (!seen[n - 1]) out.push(n - 1);
    return out;
  }
  // سطح (tier) هر اندیس در ترتیب تدریجی: ۰ = هر ۸تا، ۱ = هر ۴تا، ۲ = هر ۲تا، ۳ = بقیه
  function tierOf(i, n) { return (i % 8 === 0 || i === n - 1) ? 0 : i % 4 === 0 ? 1 : i % 2 === 0 ? 2 : 3; }
  function preloadSet(arr, basePrio, reverse) {
    var n = arr.length;
    progressiveOrder(n).forEach(function (i, k) {
      var idx = reverse ? n - 1 - i : i;
      // سطح، اولویت اصلی است ⇒ مجموعه‌های هم‌زمان (نمایشگر + سنسور) «درهم» بار می‌شوند
      request(arr[idx], basePrio - tierOf(i, n) * 100 - k * 0.001);
    });
  }

  /* ---------------- کمک‌ها ---------------- */
  function parseAngle(s, fb) {
    if (s == null) return fb;
    var m = String(s).trim().match(/^(-?[\d.eE+-]+)\s*(deg|rad)?$/);
    if (!m) return fb;
    var v = parseFloat(m[1]);
    if (!isFinite(v)) return fb;
    return m[2] === 'rad' ? v * 180 / Math.PI : v;
  }
  function kindOf(src) { return /assem/i.test(src || '') ? 'sensor' : 'display'; }
  function ready(url) { var c = cache[url]; return c && c.state === 2 && c.bmp ? c : null; }

  /* ---------------- المنت ---------------- */
  class ProductShot extends HTMLElement {
    static get observedAttributes() { return ['src', 'variant-name', 'camera-orbit']; }
    constructor() {
      super();
      this._theta = 25; this._phi = 68; this._variant = 'normal';
      this._fov = '28deg'; this.interpolationDecay = 100; this.loaded = false;
      this._canvas = document.createElement('canvas');
      this._canvas.setAttribute('aria-hidden', 'true');
      this._canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
      this._ctx = this._canvas.getContext('2d');
      this._key = '';
      this._fade = null;      // {from: snapshot canvas, t0}
      this._pendingRedraw = false;
    }
    connectedCallback() {
      if (!this._canvas.parentNode) this.appendChild(this._canvas);
      if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
      if (this.getAttribute('alt')) this.setAttribute('aria-label', this.getAttribute('alt'));
    }
    attributeChangedCallback(name, _o, v) {
      if (name === 'src') this._setSrc(v);
      else if (name === 'variant-name') this.variantName = v;
      else if (name === 'camera-orbit') this.cameraOrbit = v;
    }
    _set() { return SETS[this._kind || 'display']; }
    _frames() {
      var set = this._set();
      return this._kind === 'sensor' ? set.all : (set[this._variant] || set.normal);
    }
    /* موقعیت اعشاری روی آرایهٔ فریم‌ها */
    _pos() {
      var fr = this._frames(), n = fr.length;
      if (n === 1) return 0;
      if (this._kind === 'sensor') {
        var d = (((this._theta - ASM_TH0) % 360) + 360) % 360;
        return d / ASM_STEP;                    // 0 … 90 (پیچشی)
      }
      var u = (DISP_TH0 - this._theta) / (DISP_TH0 - DISP_TH1);
      return Math.max(0, Math.min(1, u)) * (n - 1);
    }
    _setSrc(src) {
      var kind = kindOf(src);
      if (this._kind === kind && this.loaded) return;
      this._kind = kind;
      this.loaded = false;
      var set = SETS[kind];
      this._canvas.width = this._canvas.height = set.size;
      var self = this;
      var fr = this._frames();
      var i0 = Math.round(this._pos()) % fr.length;
      var first = request(fr[i0], 1000);
      whenReady(first).then(function () {
        self._draw(true);
        self.loaded = true;
        self.dispatchEvent(new CustomEvent('load', { detail: { url: src } }));
      });
    }
    /* انتخاب دو فریم مجاور + وزن؛ با جایگزینی نزدیک‌ترین فریم آماده */
    _pick() {
      var fr = this._frames(), n = fr.length, loop = this._kind === 'sensor';
      var p = this._pos();
      var a = Math.floor(p), f = p - a, b = a + 1;
      if (loop) { a = ((a % n) + n) % n; b = (a + 1) % n; }
      else { if (b > n - 1) { b = n - 1; f = 0; } }
      // فریم‌های لازم فوراً در صدر صف
      request(fr[a], 900); if (f > 0.001) request(fr[b], 899);
      for (var k = 2; k <= 6; k++) {          // چند فریم جلوتر/عقب‌تر
        var ia = loop ? (a + k) % n : Math.min(n - 1, a + k);
        var ib = loop ? ((a - k + 1) % n + n) % n : Math.max(0, a - k + 1);
        request(fr[ia], 800 - k); request(fr[ib], 790 - k);
      }
      var ca = ready(fr[a]), cb = ready(fr[b]);
      if (ca && (f < 0.02 || !cb)) return { a: ca, b: null, f: 0, exact: !!(f < 0.02 || cb) };
      if (ca && cb) return { a: ca, b: cb, f: f, exact: true };
      if (cb && f > 0.5) return { a: cb, b: null, f: 0, exact: false };
      // نزدیک‌ترین فریم آماده
      var best = null;
      for (var d = 1; d < n; d++) {
        var x1 = loop ? (a + d) % n : a + d, x2 = loop ? ((a - d) % n + n) % n : a - d;
        if (x1 >= 0 && x1 < n && (best = ready(fr[x1]))) break;
        if (x2 >= 0 && x2 < n && (best = ready(fr[x2]))) break;
      }
      if (!best && this._kind === 'display') {   // آخرین چاره: هر صفحهٔ دیگری در همان زاویه
        var set = this._set(), idx = Math.round(p);
        best = ready((set.alert[idx]) || '') || ready((set.normal[idx]) || '') || ready(set.normal[0]);
      }
      return best ? { a: best, b: null, f: 0, exact: false } : null;
    }
    _paint(ctx, pk) {
      var W = this._canvas.width, H = this._canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (!pk) return;
      if (!pk.b || pk.f <= 0) { ctx.drawImage(pk.a.bmp, 0, 0, W, H); return; }
      // درون‌یابی خطیِ دقیق دو تصویر premultiplied: A·(1−f) + B·f
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - pk.f; ctx.drawImage(pk.a.bmp, 0, 0, W, H);
      ctx.globalAlpha = pk.f;     ctx.drawImage(pk.b.bmp, 0, 0, W, H);
      ctx.restore();
    }
    _draw(force) {
      if (!this._kind) return;
      var pk = this._pick();
      if (!pk) { this._waitAndRedraw(); return; }
      var key = pk.a.url + '|' + (pk.b ? pk.b.url : '') + '|' + Math.round(pk.f * 32);
      if (!force && key === this._key && !this._fade) return;
      this._key = key;
      if (this._fade) {
        var t = Math.min(1, (performance.now() - this._fade.t0) / 300);
        if (t < 1) {
          // cross-fade دقیق: قبلی·(1−t) + جدید·t
          var off = this._off || (this._off = document.createElement('canvas'));
          if (off.width !== this._canvas.width) { off.width = this._canvas.width; off.height = this._canvas.height; }
          this._paint(off.getContext('2d'), pk);
          var ctx = this._ctx;
          ctx.clearRect(0, 0, off.width, off.height);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - t; ctx.drawImage(this._fade.from, 0, 0);
          ctx.globalAlpha = t;     ctx.drawImage(off, 0, 0);
          ctx.restore();
        } else { this._fade = null; this._paint(this._ctx, pk); }
      } else this._paint(this._ctx, pk);
      if (!pk.exact) this._waitAndRedraw();
    }
    _waitAndRedraw() {
      if (this._pendingRedraw) return;
      this._pendingRedraw = true;
      var self = this, fr = this._frames(), p = Math.round(this._pos()) % fr.length;
      whenReady(entry(fr[p])).then(function () {
        self._pendingRedraw = false;
        requestAnimationFrame(function () { self._draw(true); });
      });
    }
    _fadeLoop() {
      var self = this;
      (function step() {
        if (!self._fade) return;
        self._draw(true);
        if (self._fade) requestAnimationFrame(step);
      })();
    }
    get cameraOrbit() { return this._theta + 'deg ' + this._phi + 'deg auto'; }
    set cameraOrbit(v) {
      var parts = String(v || '').trim().split(/\s+/);
      this._theta = parseAngle(parts[0], this._theta);
      this._phi = parseAngle(parts[1], this._phi);
      this._draw(false);
    }
    get variantName() { return this._variant; }
    set variantName(v) {
      v = v || 'normal';
      if (v === this._variant) return;
      var had = this.loaded && this._kind === 'display';
      if (had) {
        // عکس لحظهٔ فعلی برای محوشدن نرم به صفحهٔ جدید
        var snap = document.createElement('canvas');
        snap.width = this._canvas.width; snap.height = this._canvas.height;
        snap.getContext('2d').drawImage(this._canvas, 0, 0);
        this._fade = { from: snap, t0: performance.now() };
      }
      this._variant = v;
      if (had) this._fadeLoop(); else this._draw(true);
    }
    get fieldOfView() { return this._fov; }
    set fieldOfView(v) { this._fov = v; }
    get minFieldOfView() { return this._fov; }
    set minFieldOfView(_v) {}
    get maxFieldOfView() { return this._fov; }
    set maxFieldOfView(_v) {}
    getCameraOrbit() { return { theta: this._theta * Math.PI / 180, phi: this._phi * Math.PI / 180, radius: 1.2 }; }
    getFieldOfView() { return 28; }
    jumpCameraToGoal() { this._draw(false); }
  }
  if (!customElements.get('product-shot')) customElements.define('product-shot', ProductShot);

  /* ---------------- پیش‌بارگذاری سراسری ----------------
     ترتیب = ترتیب نیاز در روایت صفحه:
     ۱) نمایشگر عادی ۰…۶۰ و سنسور (هر دو در پرواز استیج ۱→۲ هم‌زمان)
     ۲) نمایشگر هشدار از ۶۰ به عقب (پایان پرواز / برگشت)
     ۳) صفحهٔ showcase */
  function preloadAll() {
    request(SETS.display.normal[0], 1000);
    preloadSet(SETS.display.normal, 600, false);
    preloadSet(SETS.sensor.all, 600, false);
    request(SETS.display.alert[60], 590);
    preloadSet(SETS.display.alert, 150, true);
    request(SETS.display['new'][0], 100);
  }
  ProductShot.preloadAll = preloadAll;
  // «پوشش درشت» برای پرواز استیج ۱→۲: فریم‌های سطح ۰ نمایشگر عادی + سنسور + فریم پایانی هشدار
  function coarseUrls() {
    var u = [SETS.display.alert[60]];
    [SETS.display.normal, SETS.sensor.all].forEach(function (a) {
      for (var i = 0; i < a.length; i++) if (tierOf(i, a.length) === 0) u.push(a[i]);
    });
    return u;
  }
  ProductShot.coarseReady = function () { return coarseUrls().every(function (x) { return !!ready(x); }); };
  // promise: وقتی پوشش درشت آماده شد یا maxMs گذشت (هر کدام زودتر)
  ProductShot.whenCoarse = function (maxMs) {
    var urls = coarseUrls();
    urls.forEach(function (x) { request(x, 950); });
    var all = Promise.all(urls.map(function (x) { return whenReady(entry(x)); }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, maxMs || 1500); })]);
  };
  // پیشرفت «پوشش درشت» برای صفحهٔ لودینگ: {ready, total}
  ProductShot.coarseProgress = function () {
    var urls = coarseUrls(), n = 0;
    for (var i = 0; i < urls.length; i++) { var c = cache[urls[i]]; if (c && c.state >= 2) n++; }
    return { ready: n, total: urls.length };
  };
  // لودینگ فوراً و با اولویت بالا فقط فریم‌های «پوشش درشت» را می‌خواهد (بقیه بعد از لودینگ با kick عادی)
  // v4.3: «همهٔ فریم‌ها» (نمایشگر عادی + هشدار + سنسور + showcase) — لودینگ تا رسیدن/دیکود همه صبر می‌کند
  function allUrls() {
    return [].concat(SETS.display.normal, SETS.display.alert, SETS.sensor.all, SETS.display['new']);
  }
  ProductShot.fullProgress = function () {
    var urls = allUrls(), n = 0;
    for (var i = 0; i < urls.length; i++) { var c = cache[urls[i]]; if (c && c.state >= 2) n++; }
    return { ready: n, total: urls.length };
  };
  // لودینگ همهٔ فریم‌ها را می‌خواهد: اول «درشت‌ها» (اولویت ۹۵۰)، بعد بقیه به‌ترتیب تدریجی
  ProductShot.startPreload = function () {
    coarseUrls().forEach(function (x) { request(x, 950); });
    kick();   // preloadAll: نمایشگر عادی، سنسور، هشدار، showcase با ترتیب تدریجی
  };
  ProductShot.isSetReady = function () {
    var all = [].concat(SETS.display.normal, SETS.display.alert, SETS.sensor.all);
    for (var i = 0; i < all.length; i++) if (!ready(all[i])) return false;
    return true;
  };
  window.ProductShot = ProductShot;
  // فریم اول هیرو بلافاصله؛ بقیه بعد از DOMContentLoaded تا با CSS/عکس‌های هیرو رقابت نکند
  request(SETS.display.normal[0], 1000);
  // v3.2: پیش‌بارگذاری ۲۰۰+ فریم تا «لود کامل صفحه» (عکس‌ها و فونت هیرو) یا اولین تعامل کاربر
  // عقب می‌افتد تا هیرو سریع‌تر نمایش داده شود. پرواز استیج ۱→۲ با whenCoarse منتظر فریم‌های
  // درشت می‌ماند، پس انیمیشن‌ها بریده‌بریده نمی‌شوند.
  var kicked = false;
  function kick() {
    if (kicked) return; kicked = true;
    ['scroll', 'wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (e) { window.removeEventListener(e, kick, true); });
    preloadAll();
  }
  ['scroll', 'wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (e) { window.addEventListener(e, kick, { capture: true, passive: true }); });
  if (document.readyState === 'complete') setTimeout(kick, 30);
  else window.addEventListener('load', function () { setTimeout(kick, 30); });
  setTimeout(kick, 2200);
})();
