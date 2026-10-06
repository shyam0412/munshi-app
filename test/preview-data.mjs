import fs from 'node:fs';
import { demoSessions } from '../lib/demo.js';
import { analyze, summarizeDay } from '../lib/analyze.js';
import { dayKey, addDays, dayStart } from '../lib/fold.js';
const tz = 'Asia/Kolkata', cfg = {};
// Freeze "now" at 4:30pm on the build day so the Today view shows a day in progress.
const today = dayKey(Date.now(), tz), now = dayStart(today, tz) + 16.5 * 3600000;
const day = (d) => demoSessions(d, tz, now);
const trendDays = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
const trend = trendDays.map((d) => ({ day: d, ...summarizeDay(day(d), cfg) }));
const mk = (range, days, prev) => {
  const a = analyze(days.flatMap(day), { tz, now, cfg, range, prev });
  a.trend = trend; a.site = { name: 'Sample shop', demo: true, everSeen: true }; a.ai = 'preview'; return a;
};
const y = addDays(today, -1);
const stats = {
  today: mk('today', [today], day(y).filter((s) => s.st <= now - 864e5)),
  yesterday: mk('yesterday', [y], day(addDays(today, -2))),
  '7d': mk('7d', Array.from({ length: 7 }, (_, i) => addDays(today, -i)), null),
};
fs.writeFileSync('test/out/preview-stats.json', JSON.stringify(stats));
for (const r of ['today', 'yesterday', '7d']) { const a = stats[r]; console.log('\n==', r, JSON.stringify(a.totals)); console.log(a.fate.map((f) => f.key + ' ' + f.n).join(', ')); a.issues.slice(0, 9).forEach((i) => console.log(' -', i.title, '|', i.detail.slice(0, 110))); console.log(a.sources.map((s) => `${s.name} ${s.visits}/${s.quickPct}%/${s.conv}`).join(', ')); console.log(a.devices.map((s) => `${s.name} ${s.visits}/${s.quickPct}%/${s.conv}`).join(', ')); console.log(JSON.stringify(a.forms), JSON.stringify(a.compare)); }
