/* bitsoup lab: site.js
   Charts, sparklines, time-lapses, time ranges and the theme switch of the tracking site.
   Plain browser JavaScript: no libraries, no build step, no network requests.
   Every colour is a CSS custom property from site.css (var(--s1), var(--plants), ...), so the page and the
   charts share one palette; charts are drawn again when the theme changes.
   Strings from data go in with textContent or setAttribute, never innerHTML. */
(function () {
  "use strict";

  var doc = document, root = doc.documentElement, win = window;
  var SVGNS = "http://www.w3.org/2000/svg", NBSP = " ";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SEC = 1e3, MIN = 6e4, HOUR = 36e5, DAY = 864e5;
  var FORMATS = ["count", "percent", "bytes", "decimal", "seconds"];
  var COLORS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "plants", "eaters", "both", "neither", "muted"];

  /* ---------- helpers ---------- */
  function all(sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); }
  function h(tag, cls, parent) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function sv(tag, attrs, parent) {
    var e = doc.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function svText(parent, str, attrs) { var t = sv("text", attrs, parent); t.textContent = str; return t; }
  function finite(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function px(v) { return Math.round(v) + 0.5; }   // hairlines on whole pixels
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function parseJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage off */ } }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function mq(q) { return win.matchMedia ? win.matchMedia(q) : null; }
  function onMq(m, fn) { if (m) { if (m.addEventListener) m.addEventListener("change", fn); else if (m.addListener) m.addListener(fn); } }
  function sortNum(a) { return a.sort(function (p, q) { return p - q; }); }
  function uniq(sorted) { var out = []; for (var i = 0; i < sorted.length; i++) if (!i || sorted[i] !== sorted[i - 1]) out.push(sorted[i]); return out; }
  function nearest(arr, v) {   // index of the value closest to v in a sorted array
    var lo = 0, hi = arr.length - 1;
    if (hi < 0) return -1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid; else hi = mid; }
    return Math.abs(arr[lo] - v) <= Math.abs(arr[hi] - v) ? lo : hi;
  }
  function medianGap(sorted) {
    var g = [];
    for (var i = 1; i < sorted.length; i++) { var d = sorted[i] - sorted[i - 1]; if (d > 0) g.push(d); }
    return g.length ? sortNum(g)[g.length >> 1] : 0;
  }
  function lastPoint(pts) { for (var i = pts.length - 1; i >= 0; i--) if (pts[i][1] !== null) return pts[i]; return null; }
  function focusVisible(el) { try { return el.matches(":focus-visible"); } catch (e) { return true; } }

  var mctx = null, mfont = "";
  function measure(str, size, weight) {
    if (mctx === null) {
      var c = doc.createElement("canvas");
      mctx = (c.getContext && c.getContext("2d")) || false;
      mfont = getComputedStyle(doc.body).fontFamily || "sans-serif";
    }
    if (!mctx) return str.length * size * 0.6;
    mctx.font = (weight || 400) + " " + size + "px " + mfont;
    return mctx.measureText(str).width;
  }

  /* ---------- numbers ---------- */
  var SI = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "K"]];
  var BYTES = [[1e15, "PB"], [1e12, "TB"], [1e9, "GB"], [1e6, "MB"], [1e3, "kB"], [1, "B"]];
  var SECS = [[86400, "d"], [3600, "h"], [60, "min"], [1, "s"]];
  function trim0(s) { return s.indexOf(".") < 0 ? s : s.replace(/\.?0+$/, ""); }
  function fixed(v, d) { return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function decimalsOf(x) {
    x = Math.abs(x);
    for (var d = 0; d < 7; d++) { var p = x * Math.pow(10, d); if (Math.abs(p - Math.round(p)) < 1e-6 * Math.max(1, p)) return d; }
    return 7;
  }
  function unitFor(list, a) { for (var i = 0; i < list.length; i++) if (a >= list[i][0] * 0.99995) return list[i]; return list[list.length - 1]; }
  function secUnit(a) { return a >= 172800 ? SECS[0] : a >= 7200 ? SECS[1] : a >= 120 ? SECS[2] : SECS[3]; }

  function compact(v) {   // 950, 12.9K, 4.2M, 1.3G
    var a = Math.abs(v);
    if (a >= 999.5) { var u = unitFor(SI, a), x = v / u[0]; return trim0(x.toFixed(Math.abs(x) < 99.95 ? 1 : 0)) + u[1]; }
    if (a >= 99.5 || v === Math.round(v)) return String(Math.round(v));
    if (a >= 1) return trim0(v.toFixed(1));
    return trim0(v.toPrecision(2));
  }
  function fmtBytes(v) {   // 1.8 GB
    var u = unitFor(BYTES, Math.abs(v)), x = v / u[0];
    return trim0(x.toFixed(u[0] === 1 || Math.abs(x) >= 99.95 ? 0 : 1)) + NBSP + u[1];
  }
  function fmtSeconds(v) {   // 36 s, 4 min, 2.1 h
    var a = Math.abs(v);
    if (a === 0) return "0" + NBSP + "s";
    if (a < 0.9995) return trim0((v * 1000).toFixed(a < 0.00995 ? 1 : 0)) + NBSP + "ms";
    if (a < 59.5) return trim0(v.toFixed(a < 9.95 ? 1 : 0)) + NBSP + "s";
    if (a < 3570) return trim0((v / 60).toFixed(a < 597 ? 1 : 0)) + NBSP + "min";
    if (a < 172800) return trim0((v / 3600).toFixed(1)) + NBSP + "h";
    return trim0((v / 86400).toFixed(1)) + NBSP + "d";
  }
  function fmtPercent(v) {   // 84%
    var a = Math.abs(v);
    return (a >= 9.95 || a === 0 ? fixed(v, 0) : a >= 0.995 ? trim0(v.toFixed(1)) : trim0(v.toPrecision(2))) + "%";
  }
  function fmtDecimal(v) {   // two decimals, or two significant digits below 1
    var a = Math.abs(v);
    return a === 0 ? "0" : a >= 1 ? fixed(v, 2) : trim0(v.toPrecision(2));
  }
  function valueFormatter(fmt, unit) {
    var f = fmt === "percent" ? fmtPercent : fmt === "bytes" ? fmtBytes : fmt === "seconds" ? fmtSeconds : fmt === "decimal" ? fmtDecimal : compact;
    return unit ? function (v) { return f(v) + NBSP + unit; } : f;
  }
  // axis ticks: one style per axis; counts in full below 10,000 and compact from there
  function tickFormatter(fmt, ys, unit, sunit) {
    var maxAbs = Math.max(Math.abs(ys.lo), Math.abs(ys.hi)), step = ys.step, d, u, f;
    if (fmt === "percent") { d = decimalsOf(step); f = function (v) { return fixed(v, d) + "%"; }; }
    else if (fmt === "bytes" || fmt === "seconds") {
      u = fmt === "bytes" ? unitFor(BYTES, maxAbs) : sunit;
      d = decimalsOf(step / u[0]);
      f = function (v) { return v === 0 ? "0" : trim0(fixed(v / u[0], d)) + NBSP + u[1]; };
    } else if (fmt === "decimal" || maxAbs < 1e4) { d = decimalsOf(step); f = function (v) { return fixed(v, d); }; }
    else { u = unitFor(SI, maxAbs); d = decimalsOf(step / u[0]); f = function (v) { return v === 0 ? "0" : trim0(fixed(v / u[0], d)) + u[1]; }; }
    return unit ? function (v) { return f(v) + NBSP + unit; } : f;
  }

  /* ---------- scales and ticks ---------- */
  var NICE = [1, 2, 2.5, 5, 10];
  function niceStep(span, count, integer) {   // the 1-2-2.5-5 step closest (by ratio) to span / count
    if (!(span > 0)) return 1;
    var raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, step = mag;
    NICE.forEach(function (n) { if (Math.abs(Math.log(n / f)) < Math.abs(Math.log(step / mag / f))) step = n * mag; });
    if (integer) step = step < 1 ? 1 : step % 1 ? Math.floor(step) : step;
    return step;
  }
  function ticksFor(lo, hi, step) {
    var out = [], i0 = Math.ceil(lo / step - 1e-9), i1 = Math.floor(hi / step + 1e-9);
    for (var i = i0; i <= i1 && out.length < 200; i++) out.push(+(i * step).toPrecision(12));
    return out;
  }
  // round ticks around [lo, hi]: of a few nice steps near the wanted count, the one that wastes the least height
  function yScale(lo, hi, fixLo, fixHi, count, div, integer) {
    if (!(hi > lo)) {
      var pad = Math.abs(hi || lo) * 0.1 || 1;
      if (fixLo && !fixHi) hi = lo + pad;
      else if (fixHi && !fixLo) lo = hi - pad;
      else { hi += pad; if (lo !== 0) lo -= pad; }
    }
    var best = null;
    for (var c = Math.max(2, count - 1); c <= count + 3; c++) {
      var step = niceStep((hi - lo) / div, c, integer) * div;
      var a = fixLo ? lo : Math.floor(lo / step + 1e-9) * step, b = fixHi ? hi : Math.ceil(hi / step - 1e-9) * step;
      var n = Math.round((b - a) / step), score = (b - a) / (hi - lo) + 0.1 * Math.abs(n - count);
      if (!best || score < best.score - 1e-9) best = { score: score, lo: a, hi: b, step: step };
    }
    return { lo: best.lo, hi: best.hi, step: best.step, ticks: ticksFor(best.lo, best.hi, best.step) };
  }
  function fmtDay(t) { var d = new Date(t); return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate(); }
  function fmtClock(t, secs) { var d = new Date(t); return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + (secs ? ":" + pad2(d.getUTCSeconds()) : ""); }
  var TSTEPS = [SEC, 5 * SEC, 15 * SEC, 30 * SEC, MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN,
                HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY];
  // UTC ticks: clock times with the date under the first tick and under each new day; dates or months for long spans
  function timeTicks(lo, hi, maxN) {
    var span = hi - lo, step = 0, ticks = [], i, t;
    for (i = 0; i < TSTEPS.length; i++) if (span / TSTEPS[i] <= maxN) { step = TSTEPS[i]; break; }
    if (!step) {
      var months = span / (30.44 * DAY), k = 1, d0 = new Date(lo), y = d0.getUTCFullYear(), mo = d0.getUTCMonth();
      [1, 2, 3, 6, 12, 24, 60, 120].some(function (c) { k = c; return months / c <= maxN; });
      if (Date.UTC(y, mo, 1) < lo) mo++;
      while (mo % k) mo++;
      for (t = Date.UTC(y, mo, 1); t <= hi; mo += k, t = Date.UTC(y, mo, 1)) ticks.push(t);
      return { ticks: ticks, two: false, labels: ticks.map(function (t, j) {
        var d = new Date(t), m = d.getUTCMonth();
        return [MONTHS[m] + (m === 0 || j === 0 ? " " + d.getUTCFullYear() : ""), ""];
      }) };
    }
    for (t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
    if (step >= DAY) return { ticks: ticks, two: false, labels: ticks.map(function (t) { return [fmtDay(t), ""]; }) };
    return { ticks: ticks, two: true, labels: ticks.map(function (t, j) {
      var newDay = j === 0 || Math.floor(t / DAY) !== Math.floor(ticks[j - 1] / DAY);
      return [fmtClock(t, step < MIN), newDay ? fmtDay(t) : ""];
    }) };
  }
  function roundTicks(lo, hi, maxN) {
    var step = niceStep(hi - lo, maxN, true), ticks = ticksFor(lo, hi, step), big = Math.max(Math.abs(lo), Math.abs(hi)) >= 1e6;
    return { ticks: ticks, two: false, labels: ticks.map(function (t) { return [big ? compact(t) : fixed(t, 0), ""]; }) };
  }

  /* ---------- theme ---------- */
  var THEME_KEY = "bitsoup-theme", THEMES = ["auto", "light", "dark"];
  function theme() { var t = root.getAttribute("data-theme"); return t === "light" || t === "dark" ? t : "auto"; }
  function setTheme(t) { if (t === "light" || t === "dark") root.setAttribute("data-theme", t); else root.removeAttribute("data-theme"); }
  setTheme(recall(THEME_KEY));   // as early as the script runs
  function labelTheme(b) {
    var t = theme(), next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
    var lab = b.querySelector(".theme-label") || h("span", "theme-label", b);
    lab.textContent = t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark";
    b.setAttribute("aria-label", "Colour theme: " + t + ". Switch to " + next);
    b.title = "Theme: " + t + " (next: " + next + ")";
  }
  function initTheme() {
    all("button.theme").forEach(function (b) {
      labelTheme(b);
      b.addEventListener("click", function () {
        var next = THEMES[(THEMES.indexOf(theme()) + 1) % THEMES.length];
        setTheme(next);
        store(THEME_KEY, next === "auto" ? null : next);
        all("button.theme").forEach(labelTheme);
        redraw();
      });
    });
    onMq(mq("(prefers-color-scheme: dark)"), redraw);
  }

  /* ---------- one tooltip and one live region, shared by every chart ---------- */
  var tip = null, live = null, active = null;
  function ensureTip() {
    if (tip) return;
    tip = h("div", "viz-tip", doc.body);
    tip.hidden = true;
    tip.setAttribute("aria-hidden", "true");
    live = h("div", "sr-only", doc.body);
    live.setAttribute("aria-live", "polite");
  }

  /* ---------- charts ---------- */
  var charts = [], sparks = [], nextId = 0;

  function colorOf(c, i) {   // a palette token, else the slot of the series' place in the spec: colour follows the entity
    if (typeof c === "string" && COLORS.indexOf(c) >= 0) return "var(--" + c + ")";
    return i < 8 ? "var(--s" + (i + 1) + ")" : "var(--muted)";   // never cycled past eight
  }
  function runsOf(pts) {   // null values break a line
    var runs = [], cur = [];
    pts.forEach(function (p) { if (p[1] === null) { if (cur.length) runs.push(cur); cur = []; } else cur.push(p); });
    if (cur.length) runs.push(cur);
    return runs;
  }

  function Chart(fig) {
    var self = this, cap = fig.querySelector("figcaption"), js = fig.querySelector('script[type="application/json"]');
    var spec = js ? parseJSON(js.textContent) : null;
    this.fig = fig;
    this.id = ++nextId;
    this.spec = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : null;
    this.time = !!(this.spec && this.spec.x && this.spec.x.kind === "time");
    this.plot = fig.querySelector(".plot");
    if (!this.plot) { this.plot = h("div", "plot"); fig.insertBefore(this.plot, cap ? cap.nextSibling : fig.firstChild); }
    this.legend = h("ul", "legend");
    this.legend.hidden = true;
    fig.insertBefore(this.legend, this.plot);
    var t = cap && cap.querySelector("h3"), st = cap && cap.querySelector("p");
    this.title = ((t || cap || {}).textContent || "Chart").trim();
    this.sub = st ? st.textContent.trim() : "";
    this.view = null; this.w = 0; this.i = -1; this.geo = null; this.touch = false;
    var p = this.plot;
    p.__chart = this;
    p.addEventListener("pointerdown", function (e) { if (e.pointerType === "touch") { self.touch = true; self.pointAt(e); } });
    p.addEventListener("pointermove", function (e) { if (e.pointerType !== "touch" || self.touch) self.pointAt(e); });
    p.addEventListener("pointerup", function () { self.touch = false; });
    p.addEventListener("pointercancel", function () { self.touch = false; });
    p.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") self.hide(); });
    p.addEventListener("focus", function () { if (self.geo && focusVisible(p)) self.show(self.i >= 0 ? self.i : self.geo.X.length - 1, "key"); });
    p.addEventListener("blur", function () { self.hide(); });
    p.addEventListener("keydown", function (e) { self.key(e); });
  }

  // [first x, last x] over every point that has a value, ignoring any time range
  Chart.prototype.extent = function () {
    var lo = Infinity, hi = -Infinity, list = this.spec && Array.isArray(this.spec.series) ? this.spec.series : [];
    list.forEach(function (s) {
      if (!s || !Array.isArray(s.x) || !Array.isArray(s.y)) return;
      for (var k = 0; k < s.x.length; k++) {
        var x = finite(s.x[k]);
        if (x !== null && finite(s.y[k]) !== null) { if (x < lo) lo = x; if (x > hi) hi = x; }
      }
    });
    return lo <= hi ? [lo, hi] : null;
  };

  Chart.prototype.model = function () {
    var sp = this.spec, X = sp.x || {}, Y = sp.y || {};
    var stack = sp.stack === "share" || sp.stack === "sum" ? sp.stack : null;
    var from = this.view ? this.view.from : -Infinity, to = this.view ? this.view.to : Infinity;
    var list = Array.isArray(sp.series) ? sp.series : [], series = [], ux = [], lo = Infinity, hi = -Infinity;
    list.forEach(function (sr, i) {
      if (!sr || !Array.isArray(sr.x) || !Array.isArray(sr.y)) return;
      var pts = [], any = false, n = Math.min(sr.x.length, sr.y.length);
      for (var k = 0; k < n; k++) {
        var x = finite(sr.x[k]);
        if (x === null || x < from || x > to) continue;
        var y = finite(sr.y[k]);
        if (Y.log && !(y > 0)) y = null;   // a logarithmic axis has no place for zero or less: a gap
        if (y !== null) any = true;
        pts.push([x, y]);
      }
      if (!any) return;   // a series with no points is skipped
      pts.sort(function (a, b) { return a[0] - b[0]; });
      series.push({
        name: sr.name == null || sr.name === "" ? "series " + (i + 1) : String(sr.name),
        color: colorOf(sr.color, i), pts: pts, xs: pts.map(function (q) { return q[0]; }),
        faint: !!sr.faint   // context, drawn thin and pale: the same entity in an earlier run
      });
    });
    var m = { X: X, Y: Y, time: X.kind === "time", stack: stack, series: series };
    m.fmt = stack === "share" ? "percent" : FORMATS.indexOf(Y.format) >= 0 ? Y.format : "count";
    if (stack) {
      var xs = [];
      series.forEach(function (s) { s.pts.forEach(function (q) { xs.push(q[0]); }); });
      xs = uniq(sortNum(xs));
      var maps = series.map(function (s) {
        var mp = new Map();
        s.pts.forEach(function (q) { if (!mp.has(q[0]) || q[1] !== null) mp.set(q[0], q[1]); });
        return mp;
      });
      m.rows = xs.map(function (x) {
        var raw = maps.map(function (mp) { var v = mp.get(x); return v === undefined ? null : v; });
        if (raw.every(function (v) { return v === null; })) return { x: x, gap: true };
        var vals = raw.map(function (v) { return v === null || v < 0 ? 0 : v; });
        var tot = vals.reduce(function (a, b) { return a + b; }, 0);
        if (stack === "share") {
          if (!(tot > 0)) return { x: x, gap: true };
          vals = vals.map(function (v) { return v / tot * 100; });
        }
        var c = 0;
        return { x: x, raw: raw, vals: vals, total: tot, bands: vals.map(function (v) { var b = [c, c + v]; c += v; return b; }) };
      });
      m.rowX = xs;
      m.rows.forEach(function (r) { if (!r.gap) { ux.push(r.x); hi = Math.max(hi, r.bands[r.bands.length - 1][1]); } });
      lo = 0;
    } else {
      series.forEach(function (s) {
        s.pts.forEach(function (q) { if (q[1] !== null) { ux.push(q[0]); if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; } });
      });
      ux = uniq(sortNum(ux));
      var g = medianGap(ux);
      // a series answers the crosshair when it has a point within about half its own sampling step
      series.forEach(function (s) { s.tol = 0.6 * (medianGap(s.xs) || g); });
    }
    // reference levels (spec.refs: [{ y, label }]): thresholds the data is read against; the axis always shows them
    m.refs = (Array.isArray(sp.refs) ? sp.refs : []).map(function (r) {
      var y = r ? finite(r.y) : null;
      return y === null ? null : { y: y, label: r.label == null ? "" : String(r.label) };
    }).filter(Boolean);
    if (!stack) m.refs.forEach(function (r) { if (r.y < lo) lo = r.y; if (r.y > hi) hi = r.y; });
    m.ux = ux; m.dlo = lo; m.dhi = hi;
    if (this.view) { m.x0 = this.view.from; m.x1 = this.view.to; } else { m.x0 = ux[0]; m.x1 = ux[ux.length - 1]; }
    if (!(m.x1 > m.x0)) { var padX = m.time ? 30 * MIN : 1; m.x0 -= padX; m.x1 += padX; }
    m.multiYear = m.time && new Date(m.x0).getUTCFullYear() !== new Date(m.x1).getUTCFullYear();
    m.secs = m.time && medianGap(ux) > 0 && medianGap(ux) < MIN;
    m.events = (Array.isArray(sp.events) ? sp.events : []).map(function (e) {
      var x = e ? finite(e.x) : null;
      if (x === null || x < m.x0 || x > m.x1) return null;
      return { x: x, label: e.label == null ? "" : String(e.label), kind: e.kind == null ? "" : String(e.kind), title: e.title == null ? "" : String(e.title) };
    }).filter(Boolean).sort(function (a, b) { return a.x - b.x; });
    return m;
  };

  Chart.prototype.render = function () {
    var plot = this.plot, W = Math.floor(plot.clientWidth);
    this.w = W;
    if (!W) return;   // hidden; drawn when it gets a width
    this.hide();
    plot.textContent = "";
    this.geo = null;
    this.i = -1;
    try {
      this.draw(W);
    } catch (err) {
      plot.textContent = "";
      this.geo = null;
      this.empty("this chart could not be drawn");
      if (win.console) console.warn("chart " + (this.fig.id || this.title) + ":", err);
    }
  };

  Chart.prototype.empty = function (msg) {
    this.legend.hidden = true;
    h("p", "empty", this.plot).textContent = msg;
    this.plot.removeAttribute("tabindex");
    this.plot.removeAttribute("role");
    this.plot.removeAttribute("aria-label");
  };

  Chart.prototype.drawLegend = function (m) {   // two or more series: a legend above the plot
    var lg = this.legend;
    lg.textContent = "";
    lg.hidden = m.series.length < 2;
    if (lg.hidden) return;
    m.series.forEach(function (s) {
      var li = h("li", null, lg);
      var key = h("span", m.stack ? "key box" : "key", li);
      key.style.background = s.color;
      if (s.faint) key.style.opacity = "0.45";
      h("span", null, li).textContent = s.name;
    });
  };

  Chart.prototype.xTicks = function (m, plotW) {   // as many as fit, labels at least 10 px apart
    var maxN = Math.max(2, Math.floor(plotW / (m.time ? 78 : 64))), r = null;
    for (var tries = 0; tries < 6; tries++) {
      r = m.time ? timeTicks(m.x0, m.x1, maxN) : roundTicks(m.x0, m.x1, maxN);
      var ok = true, prev = -Infinity;
      for (var i = 0; i < r.ticks.length && ok; i++) {
        var l = r.labels[i], w = Math.max(measure(l[0], 11), l[1] ? measure(l[1], 11) : 0);
        var c = (r.ticks[i] - m.x0) / (m.x1 - m.x0) * plotW;
        if (c - w / 2 < prev + 10) ok = false;
        prev = c + w / 2;
      }
      if (ok || maxN <= 2) break;
      maxN = Math.max(2, Math.floor(maxN * 0.66));
    }
    return r;
  };

  // direct labels at the line ends (or band middles) for up to four series; all dropped if two would sit within 12 px
  Chart.prototype.endLabels = function (m, sy, ys, fmtV) {
    // faint series are context: they are labelled only when there is nothing else to label
    var strong = m.series.filter(function (s) { return !s.faint; }), list = m.stack || !strong.length ? m.series : strong;
    var n = list.length, out = [];
    if (n > 4) return out;
    if (m.stack) {
      var last = null;
      m.rows.forEach(function (r) { if (!r.gap) last = r; });
      if (!last) return out;
      m.series.forEach(function (s, j) { var b = last.bands[j]; out.push({ x: last.x, y: sy((b[0] + b[1]) / 2), text: s.name }); });
    } else {
      for (var k = 0; k < n; k++) {
        var p = lastPoint(list[k].pts);
        if (!p || p[1] < ys.lo || p[1] > ys.hi) return [];
        out.push({ x: p[0], y: sy(p[1]), text: m.series.length === 1 ? fmtV(p[1]) : list[k].name });
      }
    }
    return this.spaced(out);
  };
  Chart.prototype.spaced = function (out) {
    var ys2 = out.map(function (o) { return o.y; }).sort(function (a, b) { return a - b; });
    for (var i = 1; i < ys2.length; i++) if (ys2[i] - ys2[i - 1] < 12) return [];
    out.forEach(function (o) { o.w = measure(o.text, 12); });
    return out;
  };

  Chart.prototype.draw = function (W) {
    var plot = this.plot, sp = this.spec;
    var m = this.model();
    if (!m.series.length || !m.ux.length) {
      return this.empty(this.view && this.extent() ? "no data in this time range" : "no data yet");
    }
    this.drawLegend(m);
    var Y = m.Y, X = m.X, stack = m.stack;
    var H = Math.round(clamp(finite(sp.height) || 260, 120, 1200) * (W < 520 ? 0.85 : 1));
    var yTitle = Y.label == null ? "" : String(Y.label);
    var top = yTitle || m.events.length ? 26 : 10;
    var xt = this.xTicks(m, Math.max(60, W - 60));
    var bottom = xt.two ? 38 : 24;
    var plotH = Math.max(40, H - top - bottom);

    // y: min 0 for counts, bytes and percent unless the spec says otherwise; 100 on top of a share stack
    var fixLo = finite(Y.min) !== null, fixHi = finite(Y.max) !== null;
    var zero = m.fmt === "count" || m.fmt === "bytes" || m.fmt === "percent";
    var lo = fixLo ? Y.min : stack ? 0 : zero ? Math.min(0, m.dlo) : m.dlo;
    var hi = fixHi ? Y.max : stack === "share" ? 100 : zero ? Math.max(0, m.dhi) : m.dhi;
    var sunit = m.fmt === "seconds" ? secUnit(Math.max(Math.abs(lo), Math.abs(hi))) : null;
    var fmtV = valueFormatter(m.fmt, Y.unit ? String(Y.unit) : ""), ys, tickY, sy;
    if (Y.log && !stack) {
      // powers of ten: every one between the smallest and the largest value gets a tick
      var e0 = Math.floor(Math.log10(Math.max(m.dlo, 1e-12))), e1 = Math.ceil(Math.log10(Math.max(m.dhi, 1e-12)));
      if (e1 <= e0) e1 = e0 + 1;
      var every = Math.max(1, Math.ceil((e1 - e0) / Math.max(2, Math.round(plotH / 34)))), lt = [];
      for (var e = e0; e <= e1; e += every) lt.push(Math.pow(10, e));
      ys = { lo: Math.pow(10, e0), hi: Math.pow(10, e1), step: 0, ticks: lt };
      tickY = function (v) { return fmtV(v); };
      sy = function (v) { return top + plotH - (Math.log10(v) - e0) / (e1 - e0) * plotH; };
    } else {
      ys = yScale(lo, hi, fixLo, fixHi, clamp(Math.round(plotH / 52), 2, 6), sunit ? sunit[0] : 1, m.fmt === "count");
      tickY = tickFormatter(m.fmt, ys, Y.unit ? String(Y.unit) : "", sunit);
      sy = function (v) { return top + plotH - (v - ys.lo) / (ys.hi - ys.lo) * plotH; };
    }
    var yl = ys.ticks.map(tickY), left = 0;
    yl.forEach(function (s) { left = Math.max(left, measure(s, 11)); });
    left = Math.max(24, Math.ceil(left) + 10);

    var ends = this.endLabels(m, sy, ys, fmtV), right = 8;
    if (ends.length) {
      var mw = 0;
      ends.forEach(function (e) { mw = Math.max(mw, e.w); });
      right = Math.ceil(mw) + 14;
      if (W - left - right < W * 0.55) { ends = []; right = 8; }
    }
    var plotW = Math.max(40, W - left - right);
    xt = this.xTicks(m, plotW);
    var sx = function (v) { return left + (v - m.x0) / (m.x1 - m.x0) * plotW; };

    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, "class": "viz", "aria-hidden": "true", focusable: "false" }, plot);
    var clipId = "viz-clip-" + this.id;
    var cp = sv("clipPath", { id: clipId }, sv("defs", null, svg));
    sv("rect", { x: left - 2, y: top - 3, width: plotW + 4, height: plotH + 6 }, cp);

    // gridlines, y ticks, baseline
    var gAxis = sv("g", null, svg), yBase = px(top + plotH);
    ys.ticks.forEach(function (t, i) {
      var y = px(sy(t));
      if (Math.abs(y - yBase) > 0.5) sv("line", { x1: left, x2: left + plotW, y1: y, y2: y, style: "stroke:var(--grid)", "shape-rendering": "crispEdges" }, gAxis);
      svText(gAxis, yl[i], { x: left - 8, y: y, dy: "0.32em", "text-anchor": "end", "class": "tick" });
    });
    if (ys.lo < 0 && ys.hi > 0) { var y0 = px(sy(0)); sv("line", { x1: left, x2: left + plotW, y1: y0, y2: y0, style: "stroke:var(--axis)", "shape-rendering": "crispEdges" }, gAxis); }
    sv("line", { x1: left, x2: left + plotW, y1: yBase, y2: yBase, style: "stroke:var(--axis)", "shape-rendering": "crispEdges" }, gAxis);
    m.refs.forEach(function (r) {   // a threshold is the one line that is dashed
      if (r.y < ys.lo || r.y > ys.hi) return;
      var y = px(sy(r.y));
      sv("line", { x1: left, x2: left + plotW, y1: y, y2: y, style: "stroke:var(--ink-3)", "stroke-dasharray": "5 4", "shape-rendering": "crispEdges" }, gAxis);
      if (r.label) svText(gAxis, r.label, { x: left + plotW, y: y - 5, "text-anchor": "end", "class": "tick" });
    });

    // x ticks
    var lastRight = 0;
    xt.ticks.forEach(function (t, i) {
      var x = px(sx(t)), lab = xt.labels[i], w = Math.max(measure(lab[0], 11), lab[1] ? measure(lab[1], 11) : 0);
      var anchor = "middle", lx = x;
      if (x - w / 2 < 0) { anchor = "start"; lx = 0; } else if (x + w / 2 > W) { anchor = "end"; lx = W; }
      sv("line", { x1: x, x2: x, y1: yBase, y2: yBase + 4, style: "stroke:var(--axis)", "shape-rendering": "crispEdges" }, gAxis);
      svText(gAxis, lab[0], { x: lx, y: yBase + 15, "text-anchor": anchor, "class": "tick" });
      if (lab[1]) svText(gAxis, lab[1], { x: lx, y: yBase + 29, "text-anchor": anchor, "class": "tick" });
      lastRight = anchor === "end" ? W : anchor === "start" ? w : x + w / 2;
    });
    var xTitle = X.label == null || X.label === "" ? (m.time ? "UTC" : "") : String(X.label);
    if (xTitle && lastRight + 12 < W - measure(xTitle, 11)) svText(gAxis, xTitle, { x: W, y: yBase + 15, "text-anchor": "end" });

    // y title and events share the row above the plot; event labels are dropped where they would collide
    var taken = [];
    if (yTitle) { svText(svg, yTitle, { x: 0, y: 11 }); taken.push([0, measure(yTitle, 11)]); }
    var gEv = sv("g", null, svg);
    m.events.forEach(function (e) {
      var x = px(sx(e.x));
      sv("line", { x1: x, x2: x, y1: top, y2: top + plotH, style: "stroke:var(--muted)", "stroke-opacity": "0.6", "shape-rendering": "crispEdges" }, gEv);
      sv("path", { d: "M" + (x - 4) + " " + (top - 9) + "h8l-4 6z", style: "fill:var(--muted)" }, gEv);
      if (!e.label) return;
      var w = measure(e.label, 11), a = x - 4, end = false;
      if (a + w > W) { a = x + 4 - w; end = true; }
      if (a < 0) return;
      for (var k = 0; k < taken.length; k++) if (a < taken[k][1] + 8 && a + w > taken[k][0] - 8) return;
      taken.push([a, a + w]);
      svText(gEv, e.label, { x: end ? x + 4 : x - 4, y: 11, "text-anchor": end ? "end" : "start" });
    });

    // data
    var gData = sv("g", { "clip-path": "url(#" + clipId + ")" }, svg), gTop = sv("g", null, svg);
    if (stack) this.drawStack(m, gData, sx, sy); else this.drawLines(m, gData, gTop, sx, sy, ys);
    ends.forEach(function (e) { svText(gTop, e.text, { x: r1(sx(e.x) + 8), y: r1(e.y), dy: "0.32em", "class": "end" }); });
    var hover = sv("g", null, svg);

    var gapPx = medianGap(m.ux) / (m.x1 - m.x0) * plotW;
    this.geo = {
      m: m, svg: svg, hover: hover, W: W, H: H, top: top, left: left, plotW: plotW, plotH: plotH,
      sx: sx, sy: sy, ys: ys, X: m.ux, gapPx: gapPx, fmtV: fmtV,
      fmtX: m.time
        ? function (x) { return fmtDay(x) + (m.multiYear ? " " + new Date(x).getUTCFullYear() : "") + " " + fmtClock(x, m.secs) + " UTC"; }
        : function (x) { return (X.label ? String(X.label) : "round") + " " + fixed(x, Math.min(2, decimalsOf(x))); }
    };
    plot.setAttribute("tabindex", "0");
    plot.setAttribute("role", "img");
    plot.setAttribute("aria-label", this.title + (this.sub ? " (" + this.sub + ")" : "") +
      ". Chart: the left and right arrow keys read the values" + (this.fig.querySelector("table") ? "; the table lists them all." : "."));
  };

  Chart.prototype.drawLines = function (m, g, gTop, sx, sy, ys) {
    var single = m.series.length === 1, base = r1(sy(clamp(0, ys.lo, ys.hi)));
    m.series.forEach(function (s) {
      var d = "";
      runsOf(s.pts).forEach(function (run) {
        if (run.length < 2) {   // a lone point between gaps
          sv("circle", { cx: r1(sx(run[0][0])), cy: r1(sy(run[0][1])), r: 2.5, style: "fill:" + s.color }, g);
          return;
        }
        var p = "M" + run.map(function (q) { return r1(sx(q[0])) + " " + r1(sy(q[1])); }).join("L");
        if (single && !s.faint) {   // a 10% wash under a single series
          sv("path", { d: p + "L" + r1(sx(run[run.length - 1][0])) + " " + base + "L" + r1(sx(run[0][0])) + " " + base + "Z",
            style: "fill:" + s.color, "fill-opacity": "0.1" }, g);
        }
        d += p;
      });
      if (d) sv("path", { d: d, fill: "none", style: "stroke:" + s.color, "stroke-width": s.faint ? 1.5 : 2, "stroke-opacity": s.faint ? 0.45 : 1, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
      var last = lastPoint(s.pts);
      if (!s.faint && last && last[1] >= ys.lo && last[1] <= ys.hi) {
        sv("circle", { cx: r1(sx(last[0])), cy: r1(sy(last[1])), r: 4, style: "fill:" + s.color + ";stroke:var(--surface)", "stroke-width": 2 }, gTop);
      }
    });
  };

  Chart.prototype.drawStack = function (m, g, sx, sy) {
    var runs = [], cur = [], n = m.series.length;
    m.rows.forEach(function (r) { if (r.gap) { if (cur.length) runs.push(cur); cur = []; } else cur.push(r); });
    if (cur.length) runs.push(cur);
    function edge(run, j, k) { return run.map(function (r) { return r1(sx(r.x)) + " " + r1(sy(r.bands[j][k])); }).join("L"); }
    m.series.forEach(function (s, j) {
      var d = "";
      runs.forEach(function (run) { if (run.length > 1) d += "M" + edge(run, j, 1) + "L" + edge(run.slice().reverse(), j, 0) + "Z"; });
      if (d) sv("path", { d: d, style: "fill:" + s.color }, g);
    });
    for (var j = 0; j < n - 1; j++) {   // the surface shows between touching bands
      var line = "";
      runs.forEach(function (run) { if (run.length > 1) line += "M" + edge(run, j, 1); });
      if (line) sv("path", { d: line, fill: "none", style: "stroke:var(--surface)", "stroke-width": 2, "stroke-linejoin": "round" }, g);
    }
  };

  Chart.prototype.pointAt = function (e) {
    var g = this.geo;
    if (!g || !g.X.length) return;
    var rect = g.svg.getBoundingClientRect();
    if (!rect.width) return;
    var x = (e.clientX - rect.left) * g.W / rect.width;
    var v = g.m.x0 + (x - g.left) / g.plotW * (g.m.x1 - g.m.x0);
    this.show(nearest(g.X, v), e.pointerType === "touch" ? "touch" : "pointer", e.clientY);
  };

  // crosshair at X[i]: every series' value there, and the events at or near it
  Chart.prototype.show = function (i, how, clientY) {
    var g = this.geo;
    if (!g || !g.X.length) return;
    ensureTip();
    if (active && active !== this) active.hide();
    active = this;
    i = clamp(i, 0, g.X.length - 1);
    this.i = i;
    var m = g.m, X = g.X[i], cx = px(g.sx(X)), hv = g.hover, rows = [], k;
    hv.textContent = "";
    sv("line", { x1: cx, x2: cx, y1: g.top, y2: g.top + g.plotH, style: "stroke:var(--ink-3)", "shape-rendering": "crispEdges" }, hv);
    if (m.stack) {
      var j = nearest(m.rowX, X), row = j >= 0 && m.rows[j].x === X && !m.rows[j].gap ? m.rows[j] : null;
      for (k = m.series.length - 1; k >= 0; k--) {   // top band first, as drawn
        rows.push({ s: m.series[k], v: row && row.raw[k] !== null ? (m.stack === "share" ? row.vals[k] : row.raw[k]) : null });
      }
      if (m.stack === "sum" && row) rows.push({ s: null, v: row.total });
    } else {
      m.series.forEach(function (s) {
        var j = nearest(s.xs, X), p = j < 0 ? null : s.pts[j];
        var v = p && Math.abs(p[0] - X) <= s.tol + 1e-9 ? p[1] : null;
        rows.push({ s: s, v: v });
        if (v !== null && v >= g.ys.lo && v <= g.ys.hi) {
          sv("circle", { cx: r1(g.sx(p[0])), cy: r1(g.sy(v)), r: 4, style: "fill:" + s.color + ";stroke:var(--surface)", "stroke-width": 2 }, hv);
        }
      });
    }
    var reach = Math.max(6, g.gapPx * 0.6);
    var near = m.events.filter(function (e) { return Math.abs(g.sx(e.x) - g.sx(X)) <= reach; });
    near.forEach(function (e) {
      var ex = px(g.sx(e.x));
      sv("line", { x1: ex, x2: ex, y1: g.top, y2: g.top + g.plotH, style: "stroke:var(--ink-2)", "shape-rendering": "crispEdges" }, hv);
    });

    tip.textContent = "";
    var said = [];
    h("div", "tx", tip).textContent = g.fmtX(X);
    var grid = h("div", "rows", tip);
    rows.forEach(function (r) {
      var key = h("span", "k", grid);
      if (r.s) key.style.background = r.s.color;
      var val = r.v === null ? "–" : g.fmtV(r.v), name = r.s ? r.s.name : "total";
      h("span", r.v === null ? "v na" : "v", grid).textContent = val;
      h("span", "n", grid).textContent = name;
      said.push(name + " " + (r.v === null ? "no value" : val));
    });
    if (near.length) {
      var evs = h("div", "evs", tip);
      near.forEach(function (e) {
        var row = h("div", null, evs), more = e.title && e.label && e.title !== e.label;
        if (e.kind) h("span", "ek", row).textContent = e.kind;
        h("b", null, row).textContent = e.label || e.title;
        if (more) h("div", "et", row).textContent = e.title;
        said.push((e.kind ? e.kind + ": " : "") + (e.label || e.title) + (more ? ", " + e.title : ""));
      });
    }
    tip.hidden = false;
    this.place(cx, how, clientY);
    if (how === "key") live.textContent = g.fmtX(X) + ": " + said.join("; ");
  };

  Chart.prototype.place = function (cx, how, clientY) {   // beside the crosshair, inside the viewport
    var g = this.geo, rect = g.svg.getBoundingClientRect(), scale = rect.width / g.W;
    var vx = rect.left + cx * scale, vw = root.clientWidth, vh = win.innerHeight;
    var tw = tip.offsetWidth, th = tip.offsetHeight, x = vx + 14, y;
    if (x + tw > vw - 8) x = vx - 14 - tw;
    x = clamp(x, 8, Math.max(8, vw - 8 - tw));
    if (how === "touch") y = clientY - th - 28;   // above the finger
    else if (how === "pointer") y = clientY - th / 2;
    else y = rect.top + g.top * scale;
    y = clamp(y, 8, Math.max(8, vh - 8 - th));
    tip.style.left = Math.round(x + win.pageXOffset) + "px";
    tip.style.top = Math.round(y + win.pageYOffset) + "px";
  };

  Chart.prototype.hide = function () {
    if (this.geo) this.geo.hover.textContent = "";
    if (active === this) { active = null; if (tip) tip.hidden = true; }
  };

  Chart.prototype.key = function (e) {
    var g = this.geo;
    if (!g || !g.X.length) return;
    var n = g.X.length, i = this.i < 0 ? n - 1 : this.i, big = Math.max(1, Math.round(n / 10));
    switch (e.key) {
      case "ArrowLeft": i -= e.shiftKey ? big : 1; break;
      case "ArrowRight": i += e.shiftKey ? big : 1; break;
      case "Home": i = 0; break;
      case "End": i = n - 1; break;
      case "Escape": this.hide(); return;
      default: return;
    }
    e.preventDefault();
    this.show(i, "key");
  };

  /* ---------- KPI sparklines ---------- */
  function Spark(el) {
    var d = parseJSON(el.getAttribute("data-spark"));
    this.el = el;
    this.w = 0;
    this.data = Array.isArray(d) ? d.map(finite) : [];
    el.__spark = this;
  }
  Spark.prototype.render = function () {
    var el = this.el, W = Math.floor(el.clientWidth), H = 28, d = this.data, n = d.length, pad = 4;
    this.w = W;
    el.textContent = "";
    var vals = d.filter(function (v) { return v !== null; });
    if (!W || !vals.length) return;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var sx = function (i) { return n > 1 ? pad + i * (W - 2 * pad) / (n - 1) : W / 2; };
    var sy = function (v) { return pad + (hi - v) / (hi - lo) * (H - 2 * pad); };
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, "aria-hidden": "true", focusable: "false" }, el);
    var path = "", run = [];
    function flush() { if (run.length > 1) path += "M" + run.join("L"); run = []; }
    d.forEach(function (v, i) { if (v === null) flush(); else run.push(r1(sx(i)) + " " + r1(sy(v))); });
    flush();
    if (path) sv("path", { d: path, fill: "none", style: "stroke:var(--muted)", "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    for (var i = n - 1; i >= 0; i--) {
      if (d[i] !== null) { sv("circle", { cx: r1(sx(i)), cy: r1(sy(d[i])), r: 3, style: "fill:var(--accent);stroke:var(--surface)", "stroke-width": 1.5 }, svg); break; }
    }
  };

  /* ---------- drawing on resize and on theme change ---------- */
  function schedule(c) {
    if (c._raf) return;
    c._raf = requestAnimationFrame(function () { c._raf = 0; c.render(); });
  }
  function redraw() { charts.forEach(function (c) { c.render(); }); sparks.forEach(function (s) { s.render(); }); }
  var ro = win.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (en) {
      var t = en.target, c = t.__chart || t.__spark;
      if (c && Math.floor(t.clientWidth) !== c.w) schedule(c);   // next frame, so a redraw never re-enters the observer
    });
  }) : null;

  /* ---------- time-range buttons for the time charts in a scope ---------- */
  function initRanges() {
    all(".ranges").forEach(function (box, idx) {
      var sid = box.getAttribute("data-scope"), scope = sid ? doc.getElementById(sid) : box.nextElementSibling;
      if (!scope) return;
      var group = charts.filter(function (c) { return c.time && scope.contains(c.fig); });
      var buttons = all("button[data-range]", box);
      if (!group.length || !buttons.length) return;
      var lo = Infinity, hi = -Infinity;
      group.forEach(function (c) { var e = c.extent(); if (e) { lo = Math.min(lo, e[0]); hi = Math.max(hi, e[1]); } });
      var key = "bitsoup-range:" + location.pathname + "#" + (sid || idx);
      function apply(b, save, draw) {
        buttons.forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        var r = b.getAttribute("data-range"), ms = r === "all" ? NaN : parseFloat(r);
        if (lo <= hi) {
          // one window for the whole group: from (latest - range), or everything when the data is shorter
          var from = isFinite(ms) && ms > 0 ? Math.max(lo, hi - ms) : lo;
          group.forEach(function (c) { c.view = { from: from, to: hi }; if (draw) c.render(); });
        }
        if (save) store(key, r);
      }
      var saved = recall(key), start = null;
      buttons.forEach(function (b) {
        if (saved !== null && b.getAttribute("data-range") === saved) start = b;
        b.addEventListener("click", function () { apply(b, true, true); });
      });
      start = start || buttons.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; })[0] || buttons[buttons.length - 1];
      apply(start, false, false);
    });
  }

  /* ---------- time-lapse ---------- */
  var PLAY = "M4 2.5v11l9.5-5.5z", PAUSE = "M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z";
  function initTimelapse(fig) {
    var raw = parseJSON(fig.getAttribute("data-frames")), frames = [];
    (Array.isArray(raw) ? raw : []).forEach(function (f) {
      if (f && typeof f.src === "string" && f.src) frames.push({ src: f.src, label: f.label == null ? "" : String(f.label) });
    });
    var img = fig.querySelector("img"), cap = fig.querySelector("figcaption"), n = frames.length;
    if (!img) { img = h("img"); img.alt = ""; fig.insertBefore(img, fig.firstChild); }
    if (!cap) cap = h("figcaption", null, fig);
    if (!n) { img.hidden = true; cap.textContent = "no frames yet"; return; }
    var bar = h("div", "tl-controls"), btn = h("button", "tl-play", bar), range = h("input", "tl-range", bar), count = h("span", "tl-count", bar);
    btn.type = "button";
    var icon = sv("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" }, btn), glyph = sv("path", { d: PLAY }, icon);
    range.type = "range";
    range.min = "0";
    range.max = String(n - 1);
    range.step = "1";
    range.setAttribute("aria-label", "Frame");
    fig.insertBefore(bar, cap);
    var i = -1, playing = false, timer = 0, cache = {}, delay = clamp(Math.round(8000 / n), 150, 900);
    function preload(k) { if (k < n && !cache[k]) { var im = new Image(); im.decoding = "async"; im.src = frames[k].src; cache[k] = im; } }
    function show(k) {
      k = clamp(k, 0, n - 1);
      if (k !== i) { i = k; img.src = frames[k].src; }
      cap.textContent = frames[k].label;
      range.value = String(k);
      range.setAttribute("aria-valuetext", frames[k].label || "frame " + (k + 1) + " of " + n);
      count.textContent = (k + 1) + " / " + n;
      preload(k + 1);
    }
    function setPlaying(on) {
      playing = on;
      glyph.setAttribute("d", on ? PAUSE : PLAY);
      btn.setAttribute("aria-label", on ? "Pause" : "Play");
      clearTimeout(timer);
      if (on) timer = setTimeout(step, delay);
    }
    function step() {   // next frame once it has loaded (or after 3 s), stop on the last
      if (!playing) return;
      if (i >= n - 1) { setPlaying(false); return; }
      preload(i + 1);
      var next = cache[i + 1], waited = 0;
      (function go() {
        if (!playing) return;
        if (next.complete || waited >= 3000) { show(i + 1); timer = setTimeout(step, delay); }
        else { waited += 100; timer = setTimeout(go, 100); }
      })();
    }
    btn.addEventListener("click", function () {
      if (playing) { setPlaying(false); return; }
      if (i >= n - 1) show(0);
      setPlaying(true);
    });
    range.addEventListener("input", function () { setPlaying(false); show(+range.value); });
    if (n < 2) { btn.disabled = true; range.disabled = true; }
    show(n - 1);   // the latest frame until it plays
    setPlaying(false);
    // plays once from the first frame when it comes into view; never with reduced motion
    var reduce = mq("(prefers-reduced-motion: reduce)");
    if (n > 1 && !(reduce && reduce.matches) && win.IntersectionObserver) {
      var io = new IntersectionObserver(function (es) {
        if (!es.some(function (e) { return e.isIntersecting; })) return;
        io.disconnect();
        if (!playing && i === n - 1) { preload(0); preload(1); show(0); setPlaying(true); }
      }, { threshold: 0.5 });
      io.observe(fig);
    }
  }

  /* ---------- the rest ---------- */
  function wrapTables() {   // wide Markdown tables scroll inside their own box
    all(".prose table").forEach(function (t) {
      var p = t.parentNode;
      if (p.classList && p.classList.contains("scroll")) return;
      var w = h("div", "scroll");
      p.insertBefore(w, t);
      w.appendChild(t);
    });
  }
  function initPrint() {   // tables of the charts open on paper
    var opened = [];
    win.addEventListener("beforeprint", function () {
      opened = all("details.tbl:not([open])");
      opened.forEach(function (d) { d.open = true; });
    });
    win.addEventListener("afterprint", function () {
      opened.forEach(function (d) { d.open = false; });
      opened = [];
    });
  }

  // A static page cannot know when it is read. Times marked class="ago" get how long ago they are, counted now
  // and again every half minute; a page of live numbers that was built long ago says so at its top.
  function span(ms) {
    var s = Math.max(0, ms / 1000);
    return s < 100 ? Math.round(s) + " s" : s < 6000 ? Math.round(s / 60) + " min" : s < 172800 ? (s / 3600).toFixed(1) + " h" : (s / 86400).toFixed(1) + " d";
  }
  function initTimes() {
    var meta = doc.querySelector('meta[name="built"]'), builtAt = meta ? Date.parse(meta.content) : NaN, note = null;
    function tick() {
      var now = Date.now();
      all("time.ago").forEach(function (t) {
        var at = Date.parse(t.getAttribute("datetime"));
        if (!isFinite(at)) return;
        var rel = t.querySelector(".rel");
        if (!rel) { rel = doc.createElement("span"); rel.className = "rel"; t.appendChild(rel); }
        rel.textContent = " (" + span(now - at) + " ago)";
      });
      if (doc.body.hasAttribute("data-live") && isFinite(builtAt) && now - builtAt > 45 * 60000) {
        var main = doc.querySelector("main");
        if (!note && main) { note = doc.createElement("p"); note.className = "stale"; note.setAttribute("role", "status"); main.insertBefore(note, main.firstChild); }
        if (note) note.textContent = "This page was built " + span(now - builtAt) + " ago. Its numbers are from then: the tracker that rebuilds it may not be running.";
      }
    }
    tick();
    win.setInterval(tick, 30000);
  }

  function init() {
    initTheme();
    initTimes();
    wrapTables();
    all("figure.chart").forEach(function (f) { charts.push(new Chart(f)); });
    initRanges();
    charts.forEach(function (c) { c.render(); if (ro) ro.observe(c.plot); });
    all(".spark[data-spark]").forEach(function (el) { var s = new Spark(el); sparks.push(s); s.render(); if (ro) ro.observe(el); });
    all("figure.timelapse").forEach(initTimelapse);
    if (!ro) win.addEventListener("resize", function () { charts.concat(sparks).forEach(schedule); });
    doc.addEventListener("pointerdown", function (e) { if (active && !active.plot.contains(e.target)) active.hide(); });
    initPrint();
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init); else init();
})();
