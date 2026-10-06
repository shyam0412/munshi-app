// Turns raw tracker batches into session records, and merges session records.
// Merging is idempotent and commutative, so the same data can be folded in twice
// (from two server instances, or from a retry) without double counting.

const MAX_PAGES = 80;
const MAX_EVENTS = 160;

const SOCIAL = {
  instagram: 'Instagram', 'l.instagram': 'Instagram', facebook: 'Facebook', fb: 'Facebook',
  'm.facebook': 'Facebook', 'l.facebook': 'Facebook', 't.co': 'X (Twitter)', twitter: 'X (Twitter)',
  x: 'X (Twitter)', linkedin: 'LinkedIn', lnkd: 'LinkedIn', youtube: 'YouTube', youtu: 'YouTube',
  whatsapp: 'WhatsApp', 'wa.me': 'WhatsApp', 'web.whatsapp': 'WhatsApp', reddit: 'Reddit',
  pinterest: 'Pinterest', telegram: 'Telegram', 't.me': 'Telegram', threads: 'Threads',
};
const SEARCH = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', yandex: 'Yandex', baidu: 'Baidu', brave: 'Brave Search', ecosia: 'Ecosia' };

export function classifySource(refHost, utm) {
  if (utm) {
    const u = String(utm).toLowerCase().slice(0, 40);
    for (const k in SOCIAL) if (u === k || u.includes(k)) return SOCIAL[k];
    for (const k in SEARCH) if (u.includes(k)) return SEARCH[k] + ' (ad)';
    return u.charAt(0).toUpperCase() + u.slice(1);
  }
  if (!refHost) return 'Direct';
  const h = String(refHost).toLowerCase().replace(/^www\./, '');
  const parts = h.split('.');
  for (const k in SEARCH) if (parts.includes(k)) return SEARCH[k];
  for (const k in SOCIAL) if (h === k || h.startsWith(k + '.') || parts.includes(k)) return SOCIAL[k];
  if (/chatgpt|openai|perplexity|claude\.ai|gemini/.test(h)) return 'AI assistants';
  return h.slice(0, 40);
}

const str = (v, n) => (v == null ? undefined : String(v).slice(0, n));
const num = (v, max) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), max) : undefined;
};

export function cleanPath(p) {
  let s = String(p || '/').split('#')[0].split('?')[0].slice(0, 120);
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

// batch: { v, i, n, d, r, u, now, e: [...] }  meta: { serverNow, country, host }
export function foldBatch(session, batch, meta) {
  const skew = meta.serverNow - (Number(batch.now) || meta.serverNow);
  const fix = (t) => {
    const x = (Number(t) || meta.serverNow) + skew;
    // Never trust a client clock further than a day either way.
    return Math.abs(x - meta.serverNow) > 864e5 ? meta.serverNow : Math.round(x);
  };
  const s = session || {
    id: str(batch.i, 24), v: str(batch.v, 24), nw: batch.n ? 1 : 0,
    st: Infinity, la: 0, dev: ['m', 't', 'd'].includes(batch.d) ? batch.d : 'd',
    pg: [], ev: [], g: {},
  };
  if (!s.ref && batch.r) s.ref = str(batch.r, 60);
  if (!s.utm && batch.u) s.utm = str(batch.u, 40);
  if (!s.co && meta.country) s.co = meta.country;
  if (!s.host && meta.host) s.host = meta.host;

  for (const e of Array.isArray(batch.e) ? batch.e.slice(0, 60) : []) {
    if (!e || typeof e !== 'object') continue;
    const t = fix(e.t);
    s.st = Math.min(s.st, t);
    s.la = Math.max(s.la, t);
    const p = cleanPath(e.p);
    if (e.k === 'pv') {
      if (s.pg.length < MAX_PAGES && !s.pg.find((x) => x.id === e.id)) {
        s.pg.push({ id: str(e.id, 12), p, t, ti: str(e.ti, 70), du: 0, sc: 0 });
      }
    } else if (e.k === 'pe') {
      const pg = s.pg.find((x) => x.id === e.pv);
      if (pg) {
        pg.du = Math.max(pg.du || 0, num(e.du, 36e5) || 0);
        pg.sc = Math.max(pg.sc || 0, num(e.sc, 100) || 0);
        if (e.lcp != null) pg.lcp = num(e.lcp, 12e4);
        if (e.ld != null) pg.ld = num(e.ld, 12e4);
        if (e.st != null) pg.hs = num(e.st, 999);
      } else {
        // The page view may arrive on another server instance; keep a stub to merge later.
        s.pg.push({ id: str(e.pv, 12), p, t, du: num(e.du, 36e5) || 0, sc: num(e.sc, 100) || 0, stub: 1,
          ...(e.lcp != null ? { lcp: num(e.lcp, 12e4) } : {}), ...(e.ld != null ? { ld: num(e.ld, 12e4) } : {}),
          ...(e.st != null ? { hs: num(e.st, 999) } : {}) });
      }
    } else if (e.k === 'gl') {
      const g = str(e.g, 30);
      if (g) {
        const prev = s.g[g];
        if (!prev || t < prev.t) s.g[g] = { t, p, ...(e.val != null ? { val: num(e.val, 1e9) } : {}), ...(e.x ? { x: str(e.x, 80) } : {}) };
      }
    } else if (['ck', 'rg', 'er', 'nf', 'fs', 'fa', 'fb'].includes(e.k)) {
      if (s.ev.length < MAX_EVENTS && !s.ev.find((x) => x.id === e.id)) {
        const o = { id: str(e.id, 12), k: e.k, t, p };
        if (e.x != null) o.x = str(e.x, 90);
        if (e.f != null) o.f = str(e.f, 50);
        if (e.m != null) o.m = str(e.m, 160);
        if (e.st != null) o.st = num(e.st, 999);
        if (e.n != null) o.n = num(e.n, 99);
        if (e.pay) o.pay = 1;
        if (e.src != null) o.src = str(e.src, 80);
        s.ev.push(o);
      }
    }
  }
  if (!Number.isFinite(s.st)) { s.st = meta.serverNow; s.la = Math.max(s.la, meta.serverNow); }
  return s;
}

export function mergeSessions(a, b) {
  if (!a) return b;
  if (!b) return a;
  const o = { ...b, ...a };
  o.st = Math.min(a.st, b.st);
  o.la = Math.max(a.la, b.la);
  o.nw = a.nw || b.nw ? 1 : 0;
  o.ref = a.ref || b.ref; o.utm = a.utm || b.utm; o.co = a.co || b.co; o.host = a.host || b.host;
  const pages = new Map();
  for (const pg of [...(a.pg || []), ...(b.pg || [])]) {
    const prev = pages.get(pg.id);
    if (!prev) { pages.set(pg.id, { ...pg }); continue; }
    const real = prev.stub && !pg.stub ? pg : prev;
    const m = { ...prev, ...pg, ...real };
    m.du = Math.max(prev.du || 0, pg.du || 0);
    m.sc = Math.max(prev.sc || 0, pg.sc || 0);
    m.t = Math.min(prev.t, pg.t);
    if (prev.stub && pg.stub) m.stub = 1; else delete m.stub;
    pages.set(pg.id, m);
  }
  o.pg = [...pages.values()].sort((x, y) => x.t - y.t).slice(0, MAX_PAGES);
  const evs = new Map();
  for (const e of [...(a.ev || []), ...(b.ev || [])]) if (!evs.has(e.id)) evs.set(e.id, e);
  o.ev = [...evs.values()].sort((x, y) => x.t - y.t).slice(0, MAX_EVENTS);
  o.g = { ...(b.g || {}) };
  for (const k in a.g || {}) if (!o.g[k] || a.g[k].t < o.g[k].t) o.g[k] = a.g[k];
  return o;
}

// --- time helpers (site timezone) ---
export function dayKey(ts, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}
export function hourOf(ts, tz) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ts)));
}
export function tzOffsetMs(ts, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
export function dayStart(key, tz) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return guess - tzOffsetMs(guess, tz);
}
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
