/* Munshi: one script for your website.
   For visitors it quietly records what they do (no cookies, nothing they type, no names).
   For you, the owner, it shows the analyst panel on the right edge of every page. */
(function () {
  'use strict';
  if (window.__munshiLoaded) return;
  window.__munshiLoaded = 1;

  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); for (var i = s.length - 1; i >= 0; i--) if (/\/m\.js(\?|$)/.test(s[i].src)) return s[i]; })();
  if (!script || !script.src) return;
  var ORIGIN = new URL(script.src).origin;
  var EP = ORIGIN + '/api/e';
  var W = window, D = document, L = location, N = navigator;

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function rid() { return Math.random().toString(36).slice(2, 10); }
  function now() { return Date.now(); }
  function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

  // ---------- owner mode ----------
  var qs = new URLSearchParams(L.search);
  if (qs.get('munshi')) {
    if (qs.get('munshi') === 'off') store.del('munshi_owner'); else store.set('munshi_owner', qs.get('munshi'));
    qs.delete('munshi');
    try { history.replaceState(history.state, '', L.pathname + (qs.toString() ? '?' + qs : '') + L.hash); } catch (e) {}
  }
  var ownerKey = store.get('munshi_owner');
  if (ownerKey) { W.munshi = function () {}; dock(ownerKey); return; }
  if (N.webdriver && !W.__munshiTest) return;

  // ---------- who and which visit ----------
  var vid = store.get('munshi_v'), isNew = 0;
  if (!vid) { vid = rid() + rid().slice(0, 4); store.set('munshi_v', vid); isNew = 1; }
  var sess = (store.get('munshi_s') || '').split('|');
  var refHost = '', utm = '';
  if (!sess[0] || now() - Number(sess[1] || 0) > 30 * 60000) {
    try { var rh = D.referrer ? new URL(D.referrer).hostname : ''; if (rh && rh !== L.hostname) refHost = rh; } catch (e) {}
    utm = qs.get('utm_source') || (qs.get('gclid') ? 'google' : qs.get('fbclid') ? 'facebook' : '');
    sess = [rid() + rid().slice(0, 4), now(), refHost, utm, isNew];
  } else { refHost = sess[2] || ''; utm = sess[3] || ''; isNew = Number(sess[4]) || 0; }
  var sid = sess[0];
  function touch() { sess[1] = now(); store.set('munshi_s', sess.join('|')); }
  touch();
  var ua = N.userAgent || '';
  var dev = /Mobi|iPhone|Android.+Mobile/.test(ua) ? 'm' : /iPad|Tablet|Android/.test(ua) ? 't' : 'd';

  // ---------- sending ----------
  var q = [], timer = 0, realFetch = W.fetch ? W.fetch.bind(W) : null;
  function push(e, soon) {
    e.t = now(); if (!e.id) e.id = rid(); e.p = L.pathname;
    q.push(e); touch();
    if (q.length >= 20) return flush();
    if (soon && timer) { clearTimeout(timer); timer = 0; }
    if (!timer) timer = setTimeout(flush, soon ? 400 : 2500);
  }
  function flush(leaving) {
    clearTimeout(timer); timer = 0;
    if (!q.length) return;
    var body = JSON.stringify({ v: vid, i: sid, n: isNew, d: dev, r: refHost, u: utm, h: L.hostname, now: now(), e: q.splice(0, 40) });
    try {
      if (leaving && N.sendBeacon && N.sendBeacon(EP, body)) return;
      if (realFetch) realFetch(EP, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () {});
      else if (N.sendBeacon) N.sendBeacon(EP, body);
    } catch (e) {}
  }

  // ---------- pages, time on page, scroll, speed ----------
  var pv = null, beats = [5000, 15000, 30000, 60000], beatTimer = 0, lcp = 0, firstPage = true;
  function scrollPct() {
    var h = Math.max(D.documentElement.scrollHeight, D.body ? D.body.scrollHeight : 0);
    return h ? Math.min(100, Math.round(((W.scrollY || 0) + W.innerHeight) / h * 100)) : 100;
  }
  function tick() {
    if (!pv) return;
    if (pv.vis) { pv.eng += now() - pv.vis; pv.vis = D.visibilityState === 'visible' ? now() : 0; }
    pv.sc = Math.max(pv.sc, scrollPct());
  }
  function report(leaving, ending) {
    if (!pv) return;
    tick();
    var e = { k: 'pe', pv: pv.id, du: Math.round(pv.eng), sc: pv.sc };
    if (pv.first) {
      if (lcp) e.lcp = Math.round(lcp);
      try { var nav = performance.getEntriesByType('navigation')[0]; if (nav) { if (nav.loadEventEnd > 0) e.ld = Math.round(nav.loadEventEnd); if (nav.responseStatus) e.st = nav.responseStatus; } } catch (x) {}
    }
    formsLeft();
    push(e, true);
    if (leaving) flush(true);
  }
  function beat() {
    clearTimeout(beatTimer);
    if (!pv) return;
    var next = pv.beat < beats.length ? beats[pv.beat] : beats[beats.length - 1] + (pv.beat - beats.length + 1) * 60000;
    if (next > 30 * 60000) return;
    beatTimer = setTimeout(function () { if (!pv) return; pv.beat++; if (D.visibilityState === 'visible') report(); beat(); }, Math.max(1000, next - pv.eng));
  }
  function startPage() {
    if (pv) report(false, true);
    pv = { id: rid(), eng: 0, vis: D.visibilityState === 'visible' ? now() : 0, sc: 0, beat: 0, first: firstPage, clicks: 0, errs: {}, fails: {} };
    firstPage = false; forms = {};
    push({ k: 'pv', id: pv.id, ti: clip(D.title, 70) }, true);
    beat(); pendingSignup(true);
  }
  try { new PerformanceObserver(function (l) { var en = l.getEntries(); if (en.length) lcp = en[en.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  D.addEventListener('visibilitychange', function () {
    if (D.visibilityState === 'hidden') report(true);
    else if (pv) { pv.vis = now(); beat(); }
  });
  W.addEventListener('pagehide', function () { report(true); });
  W.addEventListener('scroll', function () { if (pv) pv.sc = Math.max(pv.sc, scrollPct()); }, { passive: true });

  // single-page apps change the address without loading a new page
  var lastPath = L.pathname;
  function routeChanged() { if (L.pathname !== lastPath) { lastPath = L.pathname; startPage(); } }
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(routeChanged, 0); return r; };
  });
  W.addEventListener('popstate', function () { setTimeout(routeChanged, 0); });

  // ---------- clicks and rage clicks ----------
  var CLICKABLE = 'a,button,[role=button],input[type=submit],input[type=button],summary,[onclick],[data-munshi-goal]';
  function labelOf(el) {
    if (!el) return '';
    var img = el.querySelector && el.querySelector('img[alt]');
    return clip(el.getAttribute('aria-label') || el.innerText || el.value || el.title || (img && img.alt) || el.id || el.tagName.toLowerCase(), 40);
  }
  var recent = [], raged = {};
  D.addEventListener('click', function (ev) {
    var t = ev.target; if (!t || !t.closest || !pv) return;
    var el = t.closest(CLICKABLE);
    var goalEl = t.closest('[data-munshi-goal]');
    if (goalEl) goal(goalEl.getAttribute('data-munshi-goal'));
    if (el && pv.clicks < 25) { pv.clicks++; push({ k: 'ck', x: labelOf(el) }); }
    // three fast clicks in the same spot on something that looks clickable
    if (t.closest('input,textarea,select,[contenteditable]')) return;
    var looks = el || (function () { try { return getComputedStyle(t).cursor === 'pointer' ? t : null; } catch (e) { return null; } })();
    var n = now();
    recent.push({ t: n, x: ev.clientX, y: ev.clientY });
    recent = recent.filter(function (c) { return n - c.t < 900 && Math.abs(c.x - ev.clientX) < 40 && Math.abs(c.y - ev.clientY) < 40; });
    if (recent.length >= 3 && looks && !String(W.getSelection ? W.getSelection() : '')) {
      var lab = labelOf(looks);
      if (!raged[pv.id + lab]) { raged[pv.id + lab] = 1; push({ k: 'rg', x: lab }); }
      recent = [];
    }
  }, true);

  // ---------- things that break ----------
  function err(msg, src) {
    msg = clip(msg, 150);
    if (!pv || !msg || /^Script error\.?$/i.test(msg) || /ResizeObserver loop/.test(msg) || pv.errs[msg] || Object.keys(pv.errs).length >= 5) return;
    pv.errs[msg] = 1;
    push({ k: 'er', m: msg, src: clip(src, 80) });
    if (pending) pending.bad = 1;
  }
  W.addEventListener('error', function (e) {
    if (e && e.message) err(e.message, e.filename ? String(e.filename).split('/').pop().split('?')[0] + ':' + (e.lineno || 0) : '');
  });
  W.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; err(r && (r.message || (typeof r === 'string' ? r : '')) || 'Unhandled promise rejection', '');
  });

  var IGNORE = /google-analytics|googletagmanager|doubleclick|facebook\.(com|net)|clarity\.ms|hotjar|sentry|segment\.|mixpanel|amplitude|intercom|googlesyndication|analytics|\/api\/e$/i;
  var PAY = /razorpay|stripe|paypal|payu|cashfree|paytm|phonepe|ccavenue|instamojo|checkout|payment|\/pay(\/|$)/i;
  function failed(method, rawUrl, status) {
    if (!pv) return;
    var u; try { u = new URL(rawUrl, L.href); } catch (e) { return; }
    if (u.origin === ORIGIN || IGNORE.test(u.href)) return;
    var path = u.pathname.replace(/\/(\d{3,}|[0-9a-f]{12,}|[0-9a-f-]{32,})(?=\/|$)/gi, '/:id').slice(0, 70);
    var x = (u.hostname === L.hostname ? '' : u.hostname) + path;
    var key = method + x + status;
    if (pv.fails[key] || Object.keys(pv.fails).length >= 8) return;
    pv.fails[key] = 1;
    var e = { k: 'nf', m: method, x: x, st: status };
    if (PAY.test(u.href)) e.pay = 1;
    push(e);
    if (pending && method !== 'GET') pending.bad = 1;
  }
  if (realFetch) {
    W.fetch = function (input, init) {
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      return realFetch(input, init).then(function (res) {
        if (res.status >= 400) failed(method, url, res.status);
        return res;
      }, function (e) {
        if (!e || e.name !== 'AbortError') failed(method, url, 0);
        throw e;
      });
    };
  }
  if (W.XMLHttpRequest) {
    var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__m = [String(m || 'GET').toUpperCase(), u]; return xo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      var x = this;
      x.addEventListener('loadend', function () { if (x.__m && (x.status >= 400 || x.status === 0) && !x.__aborted) failed(x.__m[0], x.__m[1], x.status); });
      x.addEventListener('abort', function () { x.__aborted = 1; });
      return xs.apply(this, arguments);
    };
  }

  // ---------- forms (which field people stop at; never what they type) ----------
  var forms = {};
  function formName(f) {
    var h = f.querySelector('h1,h2,h3,legend');
    var b = f.querySelector('button[type=submit],input[type=submit],button:not([type])');
    return clip(f.getAttribute('aria-label') || f.getAttribute('name') || (h && h.innerText) || (b && (b.innerText || b.value)) || f.id || 'form', 40);
  }
  function fieldName(el) {
    var lab = el.id && D.querySelector('label[for="' + String(el.id).replace(/"/g, '') + '"]');
    var wrap = el.closest('label');
    return clip(el.getAttribute('aria-label') || (lab && lab.innerText) || (wrap && wrap.innerText) || el.placeholder || el.name || el.type || 'field', 30);
  }
  D.addEventListener('focusin', function (ev) {
    var el = ev.target; if (!el || !el.matches || !el.matches('input,textarea,select') || !pv) return;
    if (/^(hidden|submit|button|search)$/.test(el.type || '')) return;
    var f = el.closest('form'); if (!f) return;
    var name = formName(f), st = forms[name];
    if (!st) { st = forms[name] = { fields: {}, last: '', sent: '', done: 0 }; push({ k: 'fs', f: name }); }
    st.last = fieldName(el); st.fields[st.last] = 1;
  }, true);
  D.addEventListener('submit', function (ev) {
    var f = ev.target; if (!f || !f.querySelector || !pv) return;
    var name = formName(f), st = forms[name] || (forms[name] = { fields: {}, last: '', sent: '' });
    st.done = 1;
    push({ k: 'fb', f: name });
    var btn = f.querySelector('button[type=submit],input[type=submit],button:not([type])');
    var text = (name + ' ' + (btn ? btn.innerText || btn.value || '' : '') + ' ' + L.pathname).toLowerCase();
    if (f.querySelector('input[type=password]') && /sign ?up|register|create (an |your )?account|join|get started/.test(text) && !/log ?in|sign ?in/.test(btn ? (btn.innerText || btn.value || '').toLowerCase() : '')) {
      pending = { t: now(), path: L.pathname, bad: 0 };
      try { sessionStorage.setItem('munshi_ps', JSON.stringify(pending)); } catch (e) {}
      setTimeout(function () { pendingSignup(false); }, 4000);
    }
  }, true);
  function formsLeft() {
    for (var name in forms) {
      var st = forms[name];
      if (!st.done && st.last && st.sent !== st.last) { st.sent = st.last; push({ k: 'fa', f: name, x: st.last, n: Object.keys(st.fields).length }); }
    }
  }

  // ---------- goals ----------
  var pending = null, goals = {};
  function goal(name, props) {
    name = clip(name, 30).toLowerCase().replace(/[^a-z0-9_]+/g, '_'); if (!name) return;
    props = props || {};
    if (goals[name] && name !== 'payment_failed') return;
    goals[name] = 1;
    var e = { k: 'gl', g: name };
    if (props.value != null) e.val = Number(props.value) || 0;
    if (props.reason || props.label) e.x = clip(props.reason || props.label, 80);
    push(e, true);
  }
  // A sign-up form was submitted. Count it once nothing has gone wrong: either a few
  // seconds pass on the same page, or the site moves the person on to another page.
  function pendingSignup(onNewPage) {
    if (!pending) { try { pending = JSON.parse(sessionStorage.getItem('munshi_ps') || 'null'); } catch (e) {} }
    if (!pending) return;
    var age = now() - pending.t;
    var ok = !pending.bad && (onNewPage ? age < 60000 && L.pathname !== pending.path : age >= 3500);
    if (ok) goal('signup');
    pending = null; try { sessionStorage.removeItem('munshi_ps'); } catch (e) {}
  }
  W.munshi = function (name, props) { goal(name, props); };

  startPage();

  // ---------- the owner's panel ----------
  function dock(key) {
    function build() {
      if (D.getElementById('munshi-dock')) return;
      var wide = function () { return W.innerWidth >= 1100; };
      var open = store.get('munshi_dock') !== 'closed';
      var host = D.createElement('div'); host.id = 'munshi-dock';
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      root.innerHTML =
        '<style>' +
        ':host{all:initial}' +
        '.p{position:fixed;top:0;right:0;height:100vh;height:100dvh;width:min(392px,100vw);z-index:2147483646;background:#F4F6F9;box-shadow:-1px 0 0 rgba(15,27,61,.14),-18px 0 40px -24px rgba(15,27,61,.35);transform:translateX(100%);transition:transform .22s ease;}' +
        '.p.on{transform:none}' +
        'iframe{border:0;width:100%;height:100%;display:block}' +
        '.t{position:fixed;right:0;top:38%;z-index:2147483647;background:#101B3D;color:#fff;border:0;border-radius:10px 0 0 10px;padding:12px 9px 10px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;writing-mode:vertical-rl;letter-spacing:.02em;display:flex;align-items:center;gap:8px;box-shadow:-4px 6px 18px -8px rgba(15,27,61,.6)}' +
        '.t:focus-visible{outline:3px solid #7C9BFF;outline-offset:2px}' +
        '.t.on{display:none}' +
        '.b{writing-mode:horizontal-tb;background:#C2281D;border-radius:9px;min-width:18px;height:18px;font:700 11px/18px system-ui,sans-serif;text-align:center;padding:0 5px;box-sizing:border-box}' +
        '.b:empty{display:none}' +
        '@media (prefers-reduced-motion:reduce){.p{transition:none}}' +
        '</style>' +
        '<button class="t" type="button" aria-label="Open Munshi, your site analyst">Munshi<span class="b"></span></button>' +
        '<div class="p" role="complementary" aria-label="Munshi analyst"><iframe title="Munshi analyst" allow="clipboard-write"></iframe></div>';
      (D.body || D.documentElement).appendChild(host);
      var panel = root.querySelector('.p'), tab = root.querySelector('.t'), badge = root.querySelector('.b'), frame = root.querySelector('iframe');
      frame.src = ORIGIN + '/panel#k=' + encodeURIComponent(key) + '&embed=1&page=' + encodeURIComponent(L.pathname) + '&host=' + encodeURIComponent(L.hostname);
      var prevMargin = D.documentElement.style.marginRight;
      function apply() {
        panel.classList.toggle('on', open); tab.classList.toggle('on', open);
        D.documentElement.style.transition = 'margin-right .22s ease';
        D.documentElement.style.marginRight = open && wide() ? '392px' : prevMargin;
        store.set('munshi_dock', open ? 'open' : 'closed');
      }
      tab.addEventListener('click', function () { open = true; apply(); });
      W.addEventListener('resize', apply);
      W.addEventListener('message', function (ev) {
        if (ev.origin !== ORIGIN || !ev.data) return;
        if (ev.data.type === 'munshi:close') { open = false; apply(); tab.focus(); }
        if (ev.data.type === 'munshi:badge') badge.textContent = ev.data.n ? String(ev.data.n) : '';
        if (ev.data.type === 'munshi:signout') { store.del('munshi_owner'); host.remove(); D.documentElement.style.marginRight = prevMargin; }
        if (ev.data.type === 'munshi:goto' && typeof ev.data.path === 'string' && ev.data.path.charAt(0) === '/') L.href = ev.data.path;
      });
      var last = L.pathname;
      setInterval(function () { if (L.pathname !== last) { last = L.pathname; try { frame.contentWindow.postMessage({ type: 'munshi:page', path: last }, ORIGIN); } catch (e) {} } }, 700);
      apply();
    }
    if (D.body) build(); else D.addEventListener('DOMContentLoaded', build);
  }
})();
