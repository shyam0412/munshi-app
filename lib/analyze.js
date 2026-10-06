// The analyst. Takes session records and produces the numbers, the "where did everyone go"
// breakdown, and a ranked list of problems with evidence and a suggested fix.
// Everything here is plain arithmetic on real sessions, so every number can be traced.

import { classifySource, hourOf, dayKey } from './fold.js';

const INTENT_PATH = /(sign-?up|register|join|create-account|get-started|checkout|cart|payment|subscribe|book|order)/i;
const INTENT_CTA = /(sign ?up|get started|start (free|now|trial)|try (it|free|now)|buy|subscribe|book (a|now|demo)|join|register|checkout|add to cart|create account|order now|pay)/i;
const PURCHASE_PATH = /(thank-?you|order-?(confirmed|complete|success)|payment-?success|purchase-?complete|receipt)/i;

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const plural = (n, one, many) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many || one + 's'}`;
const secs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`);
const topN = (map, n, by = (v) => v) => [...map.entries()].sort((a, b) => by(b[1]) - by(a[1])).slice(0, n);
const bump = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);

export function derive(s, cfg = {}) {
  const pages = (s.pg || []).filter((p) => !p.stub);
  const pg = pages.length ? pages : s.pg || [];
  const dur = pg.reduce((a, p) => a + (p.du || 0), 0);
  const ev = s.ev || [];
  const g = { ...(s.g || {}) };
  const match = (list, path) => (list || []).some((u) => u && path.toLowerCase().startsWith(String(u).toLowerCase()));
  for (const p of pg) {
    if (!g.purchase && (match(cfg.purchaseUrls, p.p) || PURCHASE_PATH.test(p.p))) g.purchase = { t: p.t, p: p.p, auto: 1 };
    if (!g.signup && match(cfg.signupUrls, p.p)) g.signup = { t: p.t, p: p.p, auto: 1 };
  }
  const interacted = ev.some((e) => e.k === 'ck' || e.k === 'fs' || e.k === 'fb');
  const intent = pg.some((p) => INTENT_PATH.test(p.p)) || ev.some((e) => (e.k === 'ck' && INTENT_CTA.test(e.x || '')) || (e.k === 'fs'));
  const converted = !!(g.signup || g.purchase);
  const quick = dur < 5000 && pg.length <= 1 && !interacted && !converted;
  let fate = 'quick';
  if (g.purchase) fate = 'paid';
  else if (g.signup) fate = 'signup';
  else if (intent) fate = 'intent';
  else if (dur >= 30000 || pg.length >= 2 || interacted) fate = 'browsed';
  else if (dur >= 5000) fate = 'glance';
  return {
    s, pg, dur, g, quick, fate, intent, converted,
    entry: pg[0]?.p || '/', exit: pg[pg.length - 1]?.p || '/',
    src: classifySource(s.ref, s.utm),
    dev: s.dev === 'm' ? 'Phone' : s.dev === 't' ? 'Tablet' : 'Computer',
  };
}

export const FATES = [
  ['quick', 'Left within 5 seconds'],
  ['glance', 'Left within 30 seconds'],
  ['browsed', 'Looked around, then left'],
  ['intent', 'Started, did not finish'],
  ['signup', 'Signed up'],
  ['paid', 'Paid'],
];

export function summarizeDay(sessions, cfg) {
  const d = sessions.map((s) => derive(s, cfg));
  return {
    visits: d.length,
    people: new Set(d.map((x) => x.s.v)).size,
    quick: d.filter((x) => x.quick).length,
    signups: d.filter((x) => x.g.signup).length,
    paid: d.filter((x) => x.g.purchase).length,
    errors: d.filter((x) => x.s.ev?.some((e) => e.k === 'er')).length,
  };
}

export function analyze(sessions, opts = {}) {
  const { tz = 'Asia/Kolkata', now = Date.now(), cfg = {}, prev = null, range = 'today', page = null } = opts;
  const d = sessions.map((s) => derive(s, cfg));
  const N = d.length;
  const people = new Set(d.map((x) => x.s.v)).size;
  const count = (f) => d.filter(f).length;
  const quick = count((x) => x.quick);
  const signups = count((x) => x.g.signup);
  const paid = count((x) => x.g.purchase);
  const payFails = count((x) => x.g.payment_failed || x.s.ev?.some((e) => e.k === 'nf' && e.pay));
  const revenue = d.reduce((a, x) => a + (x.g.purchase?.val || 0), 0);

  const totals = {
    visits: N, people, newPeople: count((x) => x.s.nw),
    pageviews: d.reduce((a, x) => a + x.pg.length, 0),
    quick, quickPct: pct(quick, N),
    signups, paid, payFails, revenue,
    converted: count((x) => x.converted), convPct: N ? Math.round((count((x) => x.converted) / N) * 1000) / 10 : 0,
    medianTime: median(d.map((x) => x.dur)),
    live: count((x) => now - x.s.la < 5 * 60000),
  };

  const fate = FATES.map(([key, label]) => ({ key, label, n: count((x) => x.fate === key) }));

  // --- time series ---
  let series;
  if (range === '7d') {
    const m = new Map();
    for (const x of d) {
      const k = dayKey(x.s.st, tz);
      const o = m.get(k) || { label: k, visits: 0, conv: 0 };
      o.visits++; if (x.converted) o.conv++;
      m.set(k, o);
    }
    series = { unit: 'day', points: [...m.values()].sort((a, b) => (a.label < b.label ? -1 : 1)) };
  } else {
    const pts = Array.from({ length: 24 }, (_, h) => ({ label: String(h), visits: 0, conv: 0 }));
    for (const x of d) { const h = hourOf(x.s.st, tz); pts[h].visits++; if (x.converted) pts[h].conv++; }
    series = { unit: 'hour', points: pts, nowHour: range === 'today' ? hourOf(now, tz) : null };
  }

  // --- tables ---
  const pageMap = new Map();
  const P = (p) => { let o = pageMap.get(p); if (!o) pageMap.set(p, (o = { path: p, views: 0, entries: 0, quickExits: 0, exits: 0, times: [], scroll: [], lcp: [], errs: 0, title: '' })); return o; };
  for (const x of d) {
    x.pg.forEach((p, i) => {
      const o = P(p.p);
      o.views++; if (p.ti && !o.title) o.title = p.ti;
      if (p.du) o.times.push(p.du);
      if (p.sc) o.scroll.push(p.sc);
      if (p.lcp) o.lcp.push(p.lcp);
      if (i === 0) { o.entries++; if (x.quick) o.quickExits++; }
      if (i === x.pg.length - 1 && !x.converted) o.exits++;
    });
  }
  const pages = [...pageMap.values()].sort((a, b) => b.views - a.views).map((o) => ({
    path: o.path, title: o.title, views: o.views, entries: o.entries, quickExits: o.quickExits,
    quickPct: pct(o.quickExits, o.entries), exits: o.exits, exitPct: pct(o.exits, o.views),
    time: median(o.times), scroll: median(o.scroll), lcp: median(o.lcp), lcpN: o.lcp.length,
  }));

  const group = (keyFn) => {
    const m = new Map();
    for (const x of d) {
      const k = keyFn(x);
      const o = m.get(k) || { name: k, visits: 0, quick: 0, conv: 0 };
      o.visits++; if (x.quick) o.quick++; if (x.converted) o.conv++;
      m.set(k, o);
    }
    return [...m.values()].sort((a, b) => b.visits - a.visits).map((o) => ({ ...o, quickPct: pct(o.quick, o.visits) }));
  };
  const sources = group((x) => x.src);
  const devices = group((x) => x.dev);
  const countries = group((x) => x.s.co || 'Unknown');

  // --- problems ---
  const issues = [];
  const add = (o) => issues.push(o);
  const minN = Math.max(5, Math.round(N * 0.03));

  // 1. Entry pages where most people leave at once
  for (const p of pages) {
    if (p.entries >= Math.max(8, minN) && p.quickPct >= 50) {
      const onPage = d.filter((x) => x.entry === p.path);
      const mob = onPage.filter((x) => x.dev === 'Phone');
      const mobQ = pct(mob.filter((x) => x.quick).length, mob.length);
      const desk = onPage.filter((x) => x.dev !== 'Phone');
      const deskQ = pct(desk.filter((x) => x.quick).length, desk.length);
      const srcs = new Map(); onPage.filter((x) => x.quick).forEach((x) => bump(srcs, x.src));
      const [topSrc, topSrcN] = topN(srcs, 1)[0] || ['', 0];
      let why, fix;
      if (p.lcpN >= 4 && p.lcp > 3500) {
        why = `The page takes about ${secs(p.lcp)} to show its main content, so many people leave before they see it.`;
        fix = 'Make this page load faster: compress the large image or video at the top, and load anything below the first screen later.';
      } else if (mob.length >= 6 && desk.length >= 6 && mobQ - deskQ >= 20) {
        why = `On phones ${mobQ}% leave at once, on computers only ${deskQ}%. Something on the phone layout is putting people off.`;
        fix = 'Open this page on a phone. Check that the headline and the main button are visible without scrolling and nothing overflows the screen.';
      } else if (topSrcN >= p.quickExits * 0.6 && topSrc !== 'Direct') {
        why = `${pct(topSrcN, p.quickExits)}% of those quick exits came from ${topSrc}. What they were promised there does not match what they see here.`;
        fix = `Make the first line of this page repeat the promise of your ${topSrc} post or ad, or send that traffic to a page written for it.`;
      } else {
        why = 'People arrive and do not find a reason to stay in the first screen.';
        fix = 'Rewrite the first screen: one line saying what this is and who it is for, one clear button, and proof (a number, a customer, a screenshot).';
      }
      add({ id: 'quick:' + p.path, kind: 'bounce', sev: p.quickPct >= 70 ? 3 : 2, page: p.path, people: p.quickExits,
        title: `${p.quickExits} of ${p.entries} people who landed on ${p.path} left within 5 seconds`,
        detail: why, fix, evidence: [`${p.quickPct}% quick exits on this page`, p.lcpN ? `Shows main content in ${secs(p.lcp)}` : null, topSrc ? `Most came from ${topSrc}` : null].filter(Boolean) });
    }
  }

  // 2. Slow pages
  for (const p of pages) {
    if (p.lcpN >= 5 && p.lcp > 4000 && !issues.find((i) => i.id === 'quick:' + p.path && /load faster/.test(i.fix))) {
      add({ id: 'slow:' + p.path, kind: 'slow', sev: p.lcp > 6000 ? 3 : 2, page: p.path, people: p.views,
        title: `${p.path} takes ${secs(p.lcp)} to show`,
        detail: `Half of the ${p.views} views waited longer than ${secs(p.lcp)} for the main content. Anything over 2.5 seconds loses people.`,
        fix: 'Shrink the largest image on this page, remove scripts you do not need, and check your hosting response time.',
        evidence: [`Measured on ${p.lcpN} real visits`] });
    }
  }

  // 3. Errors in the page's code
  const errs = new Map();
  for (const x of d) for (const e of x.s.ev || []) if (e.k === 'er') {
    const k = (e.m || 'Unknown error') + '|' + e.p;
    const o = errs.get(k) || { m: e.m || 'Unknown error', p: e.p, src: e.src, sess: new Set(), lost: 0 };
    if (!o.sess.has(x.s.id)) { o.sess.add(x.s.id); if (!x.converted) o.lost++; }
    errs.set(k, o);
  }
  for (const [, o] of topN(errs, 6, (v) => v.sess.size)) {
    if (o.sess.size < Math.min(3, minN)) continue;
    add({ id: 'err:' + o.m.slice(0, 40) + o.p, kind: 'error', sev: o.sess.size >= minN * 2 ? 3 : 2, page: o.p, people: o.sess.size,
      title: `Something breaks on ${o.p} for ${plural(o.sess.size, 'visitor')}`,
      detail: `The page throws an error: “${o.m}”. ${o.lost} of those ${o.sess.size} left without converting.`,
      fix: `Give your developer this exact error and page${o.src ? ` (${o.src})` : ''}. It is a bug in the page's code, not something visitors did.`,
      evidence: [o.m, o.src].filter(Boolean) });
  }

  // 4. Requests that fail (forms, sign-up, payment)
  const fails = new Map();
  for (const x of d) for (const e of x.s.ev || []) if (e.k === 'nf') {
    const k = `${e.m || 'GET'} ${e.x}|${e.st || 0}`;
    const o = fails.get(k) || { what: `${e.m || 'GET'} ${e.x}`, st: e.st || 0, pay: 0, sess: new Set(), pages: new Map() };
    o.sess.add(x.s.id); if (e.pay) o.pay = 1; bump(o.pages, e.p);
    fails.set(k, o);
  }
  for (const [, o] of topN(fails, 6, (v) => v.sess.size)) {
    if (o.sess.size < (o.pay ? 1 : Math.min(3, minN))) continue;
    const pg = topN(o.pages, 1)[0]?.[0];
    const code = o.st ? `error ${o.st}` : 'no response (network or blocked)';
    add({ id: 'net:' + o.what + o.st, kind: o.pay ? 'payment' : 'request', sev: o.pay || o.st >= 500 ? 3 : 2, page: pg, people: o.sess.size,
      title: o.pay ? `Payment failed for ${plural(o.sess.size, 'visitor')}` : `A request fails for ${plural(o.sess.size, 'visitor')} on ${pg}`,
      detail: `${o.what} returned ${code}. ${o.st >= 500 || !o.st ? 'This is your server or a service it depends on failing.' : o.st === 404 ? 'The address being called does not exist.' : 'The server rejected what was sent.'}`,
      fix: o.pay ? 'Check your payment provider dashboard for these failures right now. Every one is a customer who tried to pay.' : `Ask your developer to check the server logs for ${o.what}.`,
      evidence: [`${o.what} → ${code}`] });
  }
  const pf = d.filter((x) => x.g.payment_failed);
  if (pf.length) {
    add({ id: 'payfail', kind: 'payment', sev: 3, page: pf[0].g.payment_failed.p, people: pf.length,
      title: `Payment failed for ${plural(pf.length, 'visitor')}`,
      detail: `${pf.length} people reached payment and it did not go through${pf[0].g.payment_failed.x ? ` (“${pf[0].g.payment_failed.x}”)` : ''}.`,
      fix: 'Check your payment provider dashboard for the decline reasons, and offer a second way to pay (UPI, card, wallet).',
      evidence: pf.slice(0, 3).map((x) => x.g.payment_failed.x).filter(Boolean) });
  }

  // 5. Rage clicks
  const rage = new Map();
  for (const x of d) for (const e of x.s.ev || []) if (e.k === 'rg') {
    const k = (e.x || 'an element') + '|' + e.p;
    const o = rage.get(k) || { x: e.x || 'an element', p: e.p, sess: new Set() };
    o.sess.add(x.s.id); rage.set(k, o);
  }
  for (const [, o] of topN(rage, 4, (v) => v.sess.size)) {
    if (o.sess.size < Math.min(3, minN)) continue;
    add({ id: 'rage:' + o.x + o.p, kind: 'rage', sev: 2, page: o.p, people: o.sess.size,
      title: `${plural(o.sess.size, 'person', 'people')} clicked “${o.x}” again and again on ${o.p}`,
      detail: 'Repeated fast clicks mean they expected something to happen and nothing did. Either it is broken, slow to respond, or looks clickable but is not.',
      fix: `Click “${o.x}” yourself on a phone and a computer. If it works, show a loading state the instant it is pressed.`,
      evidence: [`${o.sess.size} visits with 3+ rapid clicks`] });
  }

  // 6. Forms started and abandoned
  const forms = new Map();
  for (const x of d) {
    const seen = new Map();
    for (const e of x.s.ev || []) {
      if (!['fs', 'fa', 'fb'].includes(e.k)) continue;
      const k = (e.f || 'form') + '|' + e.p;
      const o = seen.get(k) || { f: e.f || 'form', p: e.p, started: 0, sub: 0, last: null };
      if (e.k === 'fs') o.started = 1;
      if (e.k === 'fb') { o.sub = 1; o.started = 1; }
      if (e.k === 'fa') { o.started = 1; o.last = e.x; }
      seen.set(k, o);
    }
    for (const [k, o] of seen) {
      const F = forms.get(k) || { f: o.f, p: o.p, started: 0, sub: 0, last: new Map() };
      F.started += o.started; F.sub += o.sub; if (!o.sub && o.last) bump(F.last, o.last);
      forms.set(k, F);
    }
  }
  const formRows = [...forms.values()].map((F) => ({ form: F.f, page: F.p, started: F.started, submitted: F.sub, abandoned: F.started - F.sub, lastField: topN(F.last, 1)[0] || null }));
  for (const F of formRows) {
    if (F.started >= Math.max(6, minN) && pct(F.abandoned, F.started) >= 50) {
      const lf = F.lastField;
      add({ id: 'form:' + F.form + F.page, kind: 'form', sev: pct(F.abandoned, F.started) >= 75 ? 3 : 2, page: F.page, people: F.abandoned,
        title: `${F.abandoned} of ${F.started} people who started the ${F.form} form on ${F.page} gave up`,
        detail: lf ? `${lf[1]} of them stopped at the “${lf[0]}” field. That field is asking for something they do not want to give, or it is rejecting what they type.` : 'They began typing and left before submitting.',
        fix: lf ? `Make “${lf[0]}” optional or remove it, and check its validation message on a phone.` : 'Cut the form to the fewest fields you can live with. Ask for the rest after they are in.',
        evidence: [`${pct(F.abandoned, F.started)}% abandon rate`, lf ? `Most common last field: ${lf[0]}` : null].filter(Boolean) });
    }
  }

  // 7. Broken pages
  const broken = new Map();
  for (const x of d) for (const p of x.pg) if (p.hs >= 400) bump(broken, `${p.p}|${p.hs}`);
  for (const [k, n] of topN(broken, 3)) {
    const [path, code] = k.split('|');
    if (n < 2) continue;
    add({ id: 'broken:' + k, kind: 'broken', sev: 3, page: path, people: n,
      title: `${path} did not open for ${plural(n, 'visit')} (error ${code})`,
      detail: code === '404' ? 'People are following a link to a page that does not exist.' : 'Your server returned an error instead of the page.',
      fix: code === '404' ? 'Find where this link is shared and correct it, or redirect this address to the right page.' : 'Check your hosting status and server logs for this page.',
      evidence: [`HTTP ${code}`] });
  }

  // 8. Phone vs computer gap
  const ph = d.filter((x) => x.dev === 'Phone'), pc = d.filter((x) => x.dev === 'Computer');
  if (ph.length >= 15 && pc.length >= 15) {
    const a = pct(ph.filter((x) => x.quick).length, ph.length), b = pct(pc.filter((x) => x.quick).length, pc.length);
    if (a - b >= 20 && !issues.some((i) => i.kind === 'bounce' && /phone/i.test(i.detail))) {
      add({ id: 'mobile', kind: 'mobile', sev: 2, people: ph.filter((x) => x.quick).length,
        title: `Phone visitors leave far more often than computer visitors (${a}% vs ${b}%)`,
        detail: `${pct(ph.length, N)}% of your visits are on phones, and the site is losing them in the first 5 seconds.`,
        fix: 'Go through your top pages on a real phone on mobile data. Look for slow loading, text that is too small, and buttons below the first screen.',
        evidence: [`${ph.length} phone visits, ${pc.length} computer visits`] });
    }
  }

  // 9. Sources sending the wrong people
  for (const s of sources) {
    if (s.visits >= Math.max(15, minN) && s.quickPct >= 70 && s.name !== 'Direct' && !issues.some((i) => i.kind === 'bounce' && i.detail.includes(s.name))) {
      add({ id: 'src:' + s.name, kind: 'source', sev: 1, people: s.quick,
        title: `${s.quickPct}% of visitors from ${s.name} leave within 5 seconds`,
        detail: `${s.visits} visits came from ${s.name} and ${s.conv} converted. This traffic is not finding what it expected.`,
        fix: `Look at what you post or advertise on ${s.name}. Either change the message to match the page, or stop spending effort there.`,
        evidence: [`${s.visits} visits, ${s.quick} quick exits`] });
    }
  }

  // 10. Funnel: intent without completion
  const intentN = count((x) => x.intent || x.converted), doneN = count((x) => x.converted);
  if (N >= 30 && doneN === 0) {
    const lastPages = new Map(); d.filter((x) => x.intent).forEach((x) => bump(lastPages, x.exit));
    const lp = topN(lastPages, 1)[0];
    add({ id: 'zero', kind: 'funnel', sev: intentN ? 3 : 2, people: intentN || N, page: lp?.[0],
      title: intentN ? `${intentN} people started to sign up or buy. None finished.` : `${N} visits and nobody tried to sign up or buy`,
      detail: intentN ? `They showed interest and then stopped${lp ? `, most often on ${lp[0]}` : ''}. The step right after their click is where you lose them.` : 'Nobody clicked a sign-up or buy button. Either the offer is not clear or the button is hard to find.',
      fix: intentN ? `Go through the sign-up or checkout yourself from ${lp ? lp[0] : 'the start'}, on a phone. Remove every field and step that is not essential.` : 'Put one clear button in the first screen of your home page that says exactly what people get.',
      evidence: [`${intentN} showed intent, ${doneN} completed`] });
  } else if (intentN >= 10 && pct(doneN, intentN) < 25) {
    add({ id: 'funnel', kind: 'funnel', sev: 2, people: intentN - doneN,
      title: `${intentN - doneN} of ${intentN} people who started to sign up or buy did not finish`,
      detail: 'Interest is there. The sign-up or checkout steps are losing most of it.',
      fix: 'Shorten the path: fewer fields, fewer screens, and let people sign up with Google or a phone number.',
      evidence: [`${pct(doneN, intentN)}% completion`] });
  }

  issues.sort((a, b) => b.sev * 1000 + b.people - (a.sev * 1000 + a.people));

  // --- comparison with the previous period ---
  let compare = null;
  if (prev) {
    const pd = prev.map((s) => derive(s, cfg));
    const pv = pd.length, pq = pd.filter((x) => x.quick).length, pc2 = pd.filter((x) => x.converted).length;
    const delta = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
    compare = { visits: pv, visitsDelta: delta(N, pv), quickPct: pct(pq, pv), converted: pc2 };
  }

  // --- the page the owner is looking at right now ---
  let pageFocus = null;
  if (page) {
    const row = pages.find((p) => p.path === page);
    const clicks = new Map(), next = new Map();
    let errN = 0, rageN = 0;
    for (const x of d) {
      x.pg.forEach((p, i) => { if (p.p === page) bump(next, x.pg[i + 1] ? x.pg[i + 1].p : '(left the site)'); });
      for (const e of x.s.ev || []) {
        if (e.p !== page) continue;
        if (e.k === 'ck' && e.x) bump(clicks, e.x);
        if (e.k === 'er') errN++;
        if (e.k === 'rg') rageN++;
      }
    }
    pageFocus = { path: page, row: row || null, clicks: topN(clicks, 5).map(([label, n]) => ({ label, n })), next: topN(next, 4).map(([path, n]) => ({ path, n })), errors: errN, rage: rageN, issues: issues.filter((i) => i.page === page).map((i) => i.id) };
  }

  const out = { range, generatedAt: now, tz, totals, fate, series, pages: pages.slice(0, 25), sources: sources.slice(0, 12), devices, countries: countries.slice(0, 8), forms: formRows.slice(0, 8), issues: issues.slice(0, 12), compare, pageFocus };
  out.brief = brief(out);
  return out;
}

const SINCE = { today: 'since midnight', yesterday: 'yesterday', '7d': 'in the last 7 days' };

export function brief(a) {
  const t = a.totals, when = SINCE[a.range] || '';
  if (!t.visits) return { headline: a.range === 'today' ? 'No visits yet today.' : `No visits ${when}.`, lines: [] };
  const lines = [];
  lines.push(`${t.quick.toLocaleString('en-IN')} left within 5 seconds${t.visits >= 10 ? ` (${t.quickPct}%)` : ''}.`);
  if (t.signups || t.paid) lines.push(`${plural(t.signups, 'person', 'people')} signed up${t.paid ? `, ${t.paid} paid` : ', nobody paid'}.`);
  else lines.push('Nobody signed up or paid.');
  if (a.compare && a.compare.visitsDelta != null && Math.abs(a.compare.visitsDelta) >= 10) {
    lines.push(`Visits are ${a.compare.visitsDelta > 0 ? 'up' : 'down'} ${Math.abs(a.compare.visitsDelta)}% on ${a.range === 'today' ? 'this time yesterday' : 'the period before'}.`);
  }
  if (a.issues[0]) lines.push(`Biggest problem: ${a.issues[0].title.charAt(0).toLowerCase() + a.issues[0].title.slice(1)}.`);
  return { headline: `${plural(t.visits, 'visit')} ${when}, from ${plural(t.people, 'person', 'people')}.`, lines };
}

// A compact, plain-text digest. Used for the daily report and as the AI's working notes.
export function digestText(a, siteName = 'your site') {
  const t = a.totals, L = [];
  L.push(`${siteName}: ${a.brief.headline}`);
  for (const l of a.brief.lines) L.push(l);
  if (!t.visits) return L.join('\n');
  L.push('');
  L.push('Where visits ended: ' + a.fate.filter((f) => f.n).map((f) => `${f.label} ${f.n}`).join('; '));
  if (a.sources.length) L.push('Top sources: ' + a.sources.slice(0, 4).map((s) => `${s.name} ${s.visits} (${s.quickPct}% left in 5s, ${s.conv} converted)`).join('; '));
  if (a.pages.length) L.push('Top pages: ' + a.pages.slice(0, 5).map((p) => `${p.path} ${p.views} views`).join('; '));
  L.push(`Typical visit lasted ${secs(t.medianTime)}. ${a.devices.map((x) => `${x.name} ${x.visits}`).join(', ')}.`);
  if (a.issues.length) {
    L.push(''); L.push('Problems, worst first:');
    a.issues.slice(0, 6).forEach((i, n) => L.push(`${n + 1}. ${i.title}. ${i.detail} Fix: ${i.fix}`));
  } else L.push('No problems found in this period.');
  return L.join('\n');
}
