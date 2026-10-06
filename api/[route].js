import crypto from 'node:crypto';
import cfg from '../munshi.config.js';
import { dayKey, addDays, dayStart } from '../lib/fold.js';
import { analyze, summarizeDay, digestText } from '../lib/analyze.js';
import * as store from '../lib/store.js';
import * as ai from '../lib/ai.js';
import { demoSessions } from '../lib/demo.js';

const TZ = process.env.MUNSHI_TZ || cfg.timezone || 'Asia/Kolkata';
const MODEL = process.env.MUNSHI_MODEL || cfg.model || 'anthropic/claude-haiku-4.5';
const SITE = 'main';
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|facebookexternalhit|whatsapp\/|curl|wget|python|scrapy|httpclient|go-http|node-fetch|axios/i;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function authed(req, url) {
  const given = req.headers.get('x-munshi-key') || url.searchParams.get('k') || '';
  if (!given) return false;
  const want = process.env.OWNER_KEY ? sha(process.env.OWNER_KEY) : Buffer.from(cfg.ownerKeyHash, 'hex');
  const got = sha(given);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

async function background(p) {
  if (!p) return;
  if (process.env.VERCEL) { const { waitUntil } = await import('@vercel/functions'); waitUntil(p); }
}

// ---------- ingest ----------
async function ingest(req, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  let raw = '';
  if (req.method === 'POST') raw = await req.text();
  else if (url.searchParams.get('d')) raw = Buffer.from(url.searchParams.get('d'), 'base64url').toString('utf8');
  if (!raw || raw.length > 64000) return new Response(null, { status: 204, headers: CORS });
  const ua = req.headers.get('user-agent') || '';
  if (BOT.test(ua) && !url.searchParams.get('t')) return new Response(null, { status: 204, headers: CORS });
  let batch;
  try { batch = JSON.parse(raw); } catch { return new Response(null, { status: 204, headers: CORS }); }
  if (!batch || typeof batch !== 'object' || !batch.i || !batch.v) return new Response(null, { status: 204, headers: CORS });
  const host = String(batch.h || '').slice(0, 80).toLowerCase();
  if (process.env.VERCEL && /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return new Response(null, { status: 204, headers: CORS });
  await background(store.ingest(SITE, batch, { serverNow: Date.now(), country: req.headers.get('x-vercel-ip-country') || undefined, host: host || undefined }));
  return new Response(null, { status: 204, headers: CORS });
}

// ---------- stats ----------
const demoCache = new Map();
function demoDay(day, now) {
  const today = dayKey(now, TZ);
  if (day === today) return demoSessions(day, TZ, now);
  if (!demoCache.has(day)) { demoCache.set(day, demoSessions(day, TZ, now)); if (demoCache.size > 30) demoCache.delete(demoCache.keys().next().value); }
  return demoCache.get(day);
}

async function compute(site, range, page, now = Date.now()) {
  const today = dayKey(now, TZ);
  const demo = site === 'demo';
  let days, prevDays;
  if (range === 'yesterday') { days = [addDays(today, -1)]; prevDays = [addDays(today, -2)]; }
  else if (range === '7d') { days = Array.from({ length: 7 }, (_, i) => addDays(today, -i)); prevDays = []; }
  else { range = 'today'; days = [today]; prevDays = [addDays(today, -1)]; }

  const trendDays = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  let byDay, sums;
  if (demo) {
    byDay = new Map([...days, ...prevDays].map((d) => [d, demoDay(d, now)]));
    sums = Object.fromEntries(trendDays.map((d) => [d, summarizeDay(demoDay(d, now), cfg)]));
  } else {
    byDay = await store.readDays(SITE, [...new Set([...days, ...prevDays, today])], TZ);
    sums = await store.summaries(SITE, trendDays.filter((d) => d !== today && !byDay.has(d)), cfg);
    for (const [d, list] of byDay) sums[d] = summarizeDay(list, cfg);
  }
  const sessions = days.flatMap((d) => byDay.get(d) || []);
  let prev = prevDays.length ? prevDays.flatMap((d) => byDay.get(d) || []) : null;
  if (prev && range === 'today') prev = prev.filter((s) => s.st <= now - 864e5);
  const a = analyze(sessions, { tz: TZ, now, cfg, prev, range, page: page || null });
  a.trend = trendDays.map((d) => ({ day: d, ...(sums[d] || { visits: 0, people: 0, quick: 0, signups: 0, paid: 0, errors: 0 }) }));
  const hosts = new Map();
  for (const s of sessions) if (s.host) hosts.set(s.host, (hosts.get(s.host) || 0) + 1);
  a.site = { name: demo ? 'Sample shop' : [...hosts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null, demo, everSeen: demo || a.trend.some((t) => t.visits > 0) };
  a.dayStart = dayStart(today, TZ);
  return a;
}

async function stats(req, url) {
  const a = await compute(url.searchParams.get('site') === 'demo' ? 'demo' : SITE, url.searchParams.get('range') || 'today', url.searchParams.get('page'));
  a.ai = ai.aiConfigured(req);
  a.storage = store.driver().name;
  return json(a);
}

async function briefRoute(req, url) {
  const site = url.searchParams.get('site') === 'demo' ? 'demo' : SITE;
  const a = await compute(site, url.searchParams.get('range') || 'today', null);
  if (a.totals.visits < 5) return json({ text: null, reason: 'too_few' });
  const key = `brief:${site}:${a.range}:${a.totals.visits}:${a.totals.quick}:${a.totals.converted}:${a.issues[0]?.id || ''}`;
  const hit = await store.kvGet(key).catch(() => null);
  if (hit?.text) return json({ text: hit.text, cached: true });
  try {
    const text = await ai.narrate(req, MODEL, a, a.site.name || 'your site');
    if (text) await store.kvSet(key, { text }, 6 * 3600).catch(() => {});
    return json({ text: text || null });
  } catch (e) { return json({ text: null, reason: String(e.message).slice(0, 120) }); }
}

async function askRoute(req, url) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body; try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  const q = String(body.q || '').trim();
  if (!q) return json({ error: 'empty question' }, 400);
  const a = await compute(body.site === 'demo' ? 'demo' : SITE, body.range || 'today', body.page || null);
  try {
    const answer = await ai.ask(req, MODEL, a, a.site.name || 'your site', q, Array.isArray(body.history) ? body.history : []);
    return json({ answer, ai: true });
  } catch (e) {
    const reason = String(e.message || e);
    return json({ answer: null, ai: false, reason: reason.startsWith('no_model') ? 'no_model' : reason.slice(0, 160), fallback: digestText(a, a.site.name || 'your site') });
  }
}

async function digest(req, url) {
  const y = await compute(SITE, 'yesterday', null);
  const t = await compute(SITE, 'today', null);
  const name = y.site.name || t.site.name || 'your site';
  let text;
  if (!y.site.everSeen && !t.totals.visits) text = 'Munshi has not received any visits yet. The tracking line has probably not been added to the website. Open the setup page for the one line to paste.';
  else text = `YESTERDAY\n${digestText(y, name)}\n\nTODAY SO FAR\n${t.brief.headline} ${t.brief.lines.join(' ')}`;
  if (url.searchParams.get('format') === 'json') return json({ text, yesterday: y.totals, today: t.totals, issues: y.issues.slice(0, 5) });
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

async function healthRoute(req) {
  const h = await store.health(SITE);
  h.ai = ai.aiConfigured(req);
  h.timezone = TZ; h.model = MODEL;
  if (new URL(req.url).searchParams.get('ai') === '1') {
    try { const a = await compute('demo', 'yesterday', null); h.aiTest = (await ai.ask(req, MODEL, a, 'Sample shop', 'In one sentence, what is the biggest problem?')).slice(0, 300); h.aiOk = true; }
    catch (e) { h.aiOk = false; h.aiError = String(e.message).slice(0, 200); }
  }
  return json(h);
}

export async function handle(req) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, '').split('/').pop() || url.searchParams.get('route');
  try {
    if (route === 'e') return await ingest(req, url);
    if (route === 'ping') return json({ ok: true, name: 'munshi' }, 200, CORS);
    if (route === 'cron') { const r = await store.checkpoint(SITE, { force: true, tz: TZ, cfg }); return json(r); }
    if (!authed(req, url)) return json({ error: 'unauthorized' }, 401);
    if (route === 'stats') return await stats(req, url);
    if (route === 'brief') return await briefRoute(req, url);
    if (route === 'ask') return await askRoute(req, url);
    if (route === 'digest') return await digest(req, url);
    if (route === 'health') return await healthRoute(req);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    console.error('[munshi] route', route, e);
    return json({ error: 'server_error', message: String(e.message || e).slice(0, 200) }, 500);
  }
}

export default { fetch: handle };
