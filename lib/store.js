// Storage, built to run on Vercel with nothing to configure.
//
//  1. Every server instance folds incoming events into sessions in memory.
//  2. A few seconds later it mirrors its sessions to Vercel's Runtime Cache, so other
//     instances can see them and they survive the instance being shut down.
//  3. Periodically ("checkpoint") all mirrored sessions are merged into one document per day.
//     Day documents live in Vercel Blob when a Blob store is connected (durable), otherwise
//     in the Runtime Cache (works immediately, but Vercel may evict it).
//
// Blob on the free plan allows 2,000 writes a month, so checkpoints to Blob are spaced out
// (one write per half hour of activity) and slow down further if the month's budget runs low.

import fs from 'node:fs/promises';
import path from 'node:path';
import { foldBatch, mergeSessions, dayKey } from './fold.js';
import { summarizeDay } from './analyze.js';

const ON_VERCEL = !!process.env.VERCEL;
const INST = Math.random().toString(36).slice(2, 10);
const CHUNK = 600_000;
const HOT_TTL = 3 * 86400;
const DOC_TTL = 45 * 86400;

// ---------- Runtime Cache (or an in-process stand-in when running locally) ----------
const localKV = new Map();
let rc = null;
async function cache() {
  if (rc) return rc;
  if (!ON_VERCEL) {
    rc = {
      get: async (k) => (localKV.has(k) ? structuredClone(localKV.get(k)) : null),
      set: async (k, v) => void localKV.set(k, structuredClone(v)),
      delete: async (k) => void localKV.delete(k),
    };
  } else {
    const { getCache } = await import('@vercel/functions');
    rc = getCache({ namespace: 'munshi' });
  }
  return rc;
}
async function kset(name, obj, ttl) {
  const c = await cache();
  const s = JSON.stringify(obj);
  if (s.length <= CHUNK) return c.set(name, { n: 1, d: s }, { ttl });
  const v = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const n = Math.ceil(s.length / CHUNK);
  await Promise.all(Array.from({ length: n }, (_, i) => c.set(`${name}~${v}~${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK), { ttl })));
  return c.set(name, { n, v }, { ttl });
}
async function kget(name) {
  const c = await cache();
  const m = await c.get(name);
  if (!m || typeof m !== 'object') return null;
  try {
    if (m.d != null) return JSON.parse(m.d);
    const parts = await Promise.all(Array.from({ length: m.n }, (_, i) => c.get(`${name}~${m.v}~${i}`)));
    if (parts.some((p) => typeof p !== 'string')) return null;
    return JSON.parse(parts.join(''));
  } catch { return null; }
}

// ---------- Durable document drivers ----------
const drivers = {
  blob: {
    name: 'blob', interval: 30 * 60000,
    async get(name) {
      const { get } = await import('@vercel/blob');
      const r = await get(`munshi/${name}.json`, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return JSON.parse(await new Response(r.stream).text());
    },
    async put(name, obj) {
      const { put } = await import('@vercel/blob');
      await put(`munshi/${name}.json`, JSON.stringify(obj), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
    },
  },
  fs: {
    name: 'fs', interval: Number(process.env.MUNSHI_CKPT_MS) || 30 * 60000,
    async get(name) {
      try { return JSON.parse(await fs.readFile(path.join(process.env.MUNSHI_DATA_DIR, name.replace(/\//g, '__') + '.json'), 'utf8')); } catch { return null; }
    },
    async put(name, obj) {
      await fs.mkdir(process.env.MUNSHI_DATA_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.MUNSHI_DATA_DIR, name.replace(/\//g, '__') + '.json'), JSON.stringify(obj));
    },
  },
  cache: {
    name: 'cache', interval: Number(process.env.MUNSHI_CKPT_MS) || 3 * 60000,
    get: (name) => kget('doc:' + name),
    put: (name, obj) => kset('doc:' + name, obj, DOC_TTL),
  },
};
export function driver() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return drivers.blob;
  if (process.env.MUNSHI_DATA_DIR) return drivers.fs;
  return drivers.cache;
}

// ---------- Instance state ----------
const S = {
  hot: new Map(),     // site -> Map(sessionId -> session)
  docs: new Map(),    // `${site}/${day}` -> { ver, map }
  pending: new Map(), // site -> Promise (debounced mirror)
  lastError: null,
};
const hotOf = (site) => { let m = S.hot.get(site); if (!m) S.hot.set(site, (m = new Map())); return m; };
const note = (where, e) => { S.lastError = { where, message: String(e?.message || e).slice(0, 200), t: Date.now() }; console.error('[munshi]', where, e?.message || e); };

export function ingest(site, batch, meta) {
  const hot = hotOf(site);
  const id = String(batch.i || '').slice(0, 24);
  if (!id) return null;
  hot.set(id, foldBatch(hot.get(id), batch, meta));
  return scheduleMirror(site);
}

function scheduleMirror(site, delay = 2500) {
  if (S.pending.has(site)) return S.pending.get(site);
  const p = new Promise((r) => setTimeout(r, delay))
    .then(() => { S.pending.delete(site); return mirror(site); })
    .then(() => checkpoint(site))
    .catch((e) => { S.pending.delete(site); note('mirror', e); });
  S.pending.set(site, p);
  return p;
}

export async function mirror(site) {
  const hot = hotOf(site);
  const now = Date.now();
  const ck = await kget(`ck:${site}`);
  // A session can be dropped from memory once it has been through two checkpoints.
  if (ck?.prev) for (const [id, s] of hot) if (s.la < ck.prev - 60000) hot.delete(id);
  await kset(`hot:${site}:${INST}`, { t: now, s: [...hot.values()] }, HOT_TTL);
  const reg = (await kget(`reg:${site}`)) || {};
  if (!reg[INST] || now - reg[INST] > 10 * 60000) {
    reg[INST] = now;
    for (const k in reg) if (now - reg[k] > HOT_TTL * 1000) delete reg[k];
    await kset(`reg:${site}`, reg, HOT_TTL);
  }
}

async function allHot(site) {
  const reg = (await kget(`reg:${site}`)) || {};
  const others = await Promise.all(Object.keys(reg).filter((i) => i !== INST).map((i) => kget(`hot:${site}:${i}`)));
  const list = [...hotOf(site).values()];
  for (const o of others) if (o?.s) list.push(...o.s);
  return list;
}

async function loadDay(site, day, ver, fresh = false) {
  const key = `${site}/${day}`;
  const c = S.docs.get(key);
  if (!fresh && c && c.ver === ver) return c.map;
  const doc = await driver().get(`${site}/d/${day}`);
  const map = new Map((doc?.s || []).map((s) => [s.id, s]));
  S.docs.set(key, { ver, map });
  if (S.docs.size > 40) S.docs.delete(S.docs.keys().next().value);
  return map;
}

// Returns Map(day -> sessions[]) for the requested days, merging saved days with live sessions.
export async function readDays(site, days, tz) {
  const ck = (await kget(`ck:${site}`)) || { days: {} };
  const maps = new Map();
  await Promise.all(days.map(async (day) => maps.set(day, new Map(await loadDay(site, day, ck.days?.[day] || 0)))));
  const where = new Map();
  for (const [day, m] of maps) for (const id of m.keys()) where.set(id, day);
  for (const s of await allHot(site)) {
    const day = where.get(s.id) || dayKey(s.st, tz);
    const m = maps.get(day);
    if (!m) continue;
    m.set(s.id, mergeSessions(m.get(s.id), s));
  }
  const out = new Map();
  for (const [day, m] of maps) out.set(day, [...m.values()]);
  return out;
}

export async function checkpoint(site, { force = false, tz = 'Asia/Kolkata', cfg = {} } = {}) {
  const drv = driver();
  const now = Date.now();
  const ck = (await kget(`ck:${site}`)) || { t: 0, prev: 0, days: {}, puts: {} };
  const month = new Date(now).toISOString().slice(0, 7);
  const used = ck.puts?.[month] || 0;
  let interval = drv.interval;
  if (drv.name === 'blob' && used > 1500) interval = 6 * 3600000; // protect the free-plan write budget
  if (!force && now - ck.t < interval) return { done: false, reason: 'not due' };
  const hot = await allHot(site);
  if (!hot.some((s) => s.la > (ck.t || 0) - 60000)) return { done: false, reason: 'nothing new' };
  const fresh = hot.filter((s) => s.la > (ck.prev || 0) - 60000);

  // Claim the slot first so two instances rarely write at once. If they do, the data is
  // still in the mirrors and is merged again at the next checkpoint.
  await kset(`ck:${site}`, { ...ck, t: now, prev: ck.t }, DOC_TTL);

  const byDay = new Map();
  for (const s of fresh) {
    const day = dayKey(s.st, tz);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(s);
  }
  const sums = (await kget(`sum:${site}`)) || {};
  const days = { ...(ck.days || {}) };
  let puts = 0;
  for (const [day, list] of byDay) {
    const map = new Map(await loadDay(site, day, 0, true));
    for (const s of list) map.set(s.id, mergeSessions(map.get(s.id), s));
    const sessions = [...map.values()];
    await drv.put(`${site}/d/${day}`, { v: 1, day, saved: now, s: sessions });
    puts++;
    days[day] = now;
    S.docs.set(`${site}/${day}`, { ver: now, map });
    sums[day] = summarizeDay(sessions, cfg);
  }
  for (const k of Object.keys(days).sort().slice(0, -60)) delete days[k];
  await kset(`sum:${site}`, sums, DOC_TTL);
  await kset(`ck:${site}`, { t: now, prev: ck.t, days, puts: { [month]: used + puts } }, DOC_TTL);
  return { done: true, days: [...byDay.keys()], puts };
}

// Daily totals for the trend chart. Uses saved summaries, filling gaps from day documents.
export async function summaries(site, days, cfg) {
  const sums = (await kget(`sum:${site}`)) || {};
  const ck = (await kget(`ck:${site}`)) || { days: {} };
  let changed = false;
  for (const day of days) {
    if (sums[day] || !ck.days?.[day]) continue;
    const map = await loadDay(site, day, ck.days[day]);
    sums[day] = summarizeDay([...map.values()], cfg);
    changed = true;
  }
  if (changed) await kset(`sum:${site}`, sums, DOC_TTL).catch(() => {});
  return sums;
}

export async function kvGet(name) { return kget(name); }
export async function kvSet(name, obj, ttl) { return kset(name, obj, ttl); }

export async function health(site) {
  const out = { instance: INST, storage: driver().name, onVercel: ON_VERCEL, lastError: S.lastError };
  try {
    const probe = 'probe:' + INST;
    await kset(probe, { t: Date.now() }, 60);
    out.cacheOk = !!(await kget(probe));
  } catch (e) { out.cacheOk = false; out.cacheError = String(e.message || e).slice(0, 160); }
  try {
    const ck = (await kget(`ck:${site}`)) || {};
    out.lastSaved = ck.t || null;
    out.savedDays = Object.keys(ck.days || {}).length;
    out.blobWritesThisMonth = ck.puts?.[new Date().toISOString().slice(0, 7)] || 0;
    out.liveSessionsInMemory = hotOf(site).size;
    out.instancesSeen = Object.keys((await kget(`reg:${site}`)) || {}).length;
  } catch (e) { out.readError = String(e.message || e).slice(0, 160); }
  if (driver().name === 'blob') {
    try { await drivers.blob.get(`${site}/probe`); out.blobOk = true; } catch (e) { out.blobOk = false; out.blobError = String(e.message || e).slice(0, 200); }
  }
  return out;
}

export async function flushAll() {
  await Promise.all([...S.hot.keys()].map((site) => mirror(site).catch((e) => note('flush', e))));
}
if (ON_VERCEL) process.on('SIGTERM', () => { flushAll(); });
