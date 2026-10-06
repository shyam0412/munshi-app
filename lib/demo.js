// Sample data: a believable small product site with real problems planted in it, so the
// analyst can be seen working before any real visitor arrives. Deterministic per day.

import { dayStart } from './fold.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const HOURS = [1, 1, 0.5, 0.5, 0.5, 1, 2, 4, 6, 8, 10, 12, 12, 10, 8, 8, 9, 10, 11, 12, 13, 12, 8, 4];
const SOURCES = [
  { ref: 'l.instagram.com', w: 30, phone: 0.92, entry: '/', quick: 0.8 },
  { ref: 'www.google.com', w: 22, phone: 0.55, entry: '/', quick: 0.42 },
  { ref: null, utm: 'google', w: 9, phone: 0.7, entry: '/pricing', quick: 0.74 },
  { ref: null, w: 20, phone: 0.4, entry: '/', quick: 0.38 },
  { ref: 'wa.me', w: 8, phone: 0.97, entry: '/', quick: 0.5 },
  { ref: 'www.linkedin.com', w: 6, phone: 0.3, entry: '/blog/how-it-works', quick: 0.35 },
  { ref: 'www.youtube.com', w: 5, phone: 0.6, entry: '/features', quick: 0.45 },
];
const TITLES = { '/': 'Home', '/pricing': 'Pricing', '/features': 'Features', '/signup': 'Create your account', '/blog/how-it-works': 'How it works', '/contact': 'Contact', '/welcome': 'Welcome' };

export function demoSessions(day, tz, now = Date.now()) {
  const r = rng(hash('munshi-demo-' + day));
  const start = dayStart(day, tz);
  const dow = new Date(start + 12 * 3600000).getUTCDay();
  const total = Math.round((dow === 0 || dow === 6 ? 400 : 520) * (0.85 + r() * 0.3));
  const hsum = HOURS.reduce((a, b) => a + b, 0);
  const wsum = SOURCES.reduce((a, b) => a + b.w, 0);
  const out = [];
  let n = 0;
  const id = () => (n++).toString(36) + Math.floor(r() * 1e9).toString(36);
  for (let i = 0; i < total; i++) {
    let x = r() * hsum, h = 0;
    while (x > HOURS[h]) x -= HOURS[h++];
    const st = start + h * 3600000 + Math.floor(r() * 3600000);
    let y = r() * wsum, si = 0;
    while (y > SOURCES[si].w) y -= SOURCES[si++].w;
    const src = SOURCES[si];
    const phone = r() < src.phone;
    const s = { id: 'd' + id(), v: 'v' + Math.floor(r() * total * 4).toString(36), nw: r() < 0.78 ? 1 : 0, st, la: st, dev: phone ? 'm' : r() < 0.08 ? 't' : 'd', ref: src.ref || undefined, utm: src.utm, co: r() < 0.86 ? 'IN' : ['US', 'AE', 'GB', 'SG'][Math.floor(r() * 4)], pg: [], ev: [], g: {} };
    let t = st;
    const view = (p, du, sc) => {
      const slow = p === '/pricing' && phone;
      s.pg.push({ id: id(), p, t, ti: TITLES[p], du, sc, lcp: Math.round(slow ? 4600 + r() * 2400 : 900 + r() * 1300), ld: Math.round(slow ? 5200 + r() * 2500 : 1200 + r() * 1500) });
      t += du + 400; s.la = t;
    };
    const ev = (k, p, o = {}) => { s.ev.push({ id: id(), k, t: t - 300, p, ...o }); };
    const quick = r() < src.quick;
    if (quick) { view(src.entry, Math.round(600 + r() * 3900), Math.round(r() * 12)); }
    else {
      view(src.entry, Math.round(7000 + r() * 50000), Math.round(25 + r() * 70));
      const roll = r();
      if (roll < 0.34) { /* read one page and left */ }
      else {
        if (src.entry !== '/pricing' && r() < 0.6) { ev('ck', src.entry, { x: 'See pricing' }); view('/pricing', Math.round(6000 + r() * 40000), Math.round(30 + r() * 60)); }
        else if (src.entry !== '/features' && r() < 0.5) { ev('ck', src.entry, { x: 'Features' }); view('/features', Math.round(8000 + r() * 30000), Math.round(30 + r() * 60)); }
        const onPricing = s.pg[s.pg.length - 1].p === '/pricing';
        if (onPricing && phone && r() < 0.3) { ev('ck', '/pricing', { x: 'Start free trial' }); ev('rg', '/pricing', { x: 'Start free trial' }); }
        if (r() < (onPricing ? 0.42 : 0.2)) {
          ev('ck', s.pg[s.pg.length - 1].p, { x: onPricing ? 'Start free trial' : 'Get started' });
          view('/signup', Math.round(9000 + r() * 45000), Math.round(40 + r() * 50));
          if (onPricing && r() < 0.28) ev('er', '/signup', { m: "TypeError: Cannot read properties of undefined (reading 'plan')", src: 'signup.js:214' });
          if (r() < 0.8) {
            ev('fs', '/signup', { f: 'Sign up' });
            const fate = r();
            if (fate < 0.62) ev('fa', '/signup', { f: 'Sign up', x: 'Phone number', n: 2 });
            else if (fate < 0.76) ev('fa', '/signup', { f: 'Sign up', x: r() < 0.5 ? 'Password' : 'Company name', n: 3 });
            else {
              ev('fb', '/signup', { f: 'Sign up' });
              if (r() < 0.55) ev('nf', '/signup', { m: 'POST', x: '/api/signup', st: 500 });
              else if (r() < 0.2) { s.g.signup = { t, p: '/signup' }; view('/welcome', Math.round(5000 + r() * 20000), 60); }
            }
          }
        }
      }
    }
    if (st <= now) { if (s.la > now) s.la = now; out.push(s); }
  }
  return out;
}
