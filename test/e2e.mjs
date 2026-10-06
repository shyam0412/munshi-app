import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const KEY = fs.readFileSync('/home/claude/owner-key.txt', 'utf8').trim();
const SITE = 'http://localhost:4200', M = 'http://localhost:4100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = 'test/out'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const visitor = async (opts = {}) => {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', ...opts });
  await ctx.addInitScript(() => { window.__munshiTest = 1; });
  return ctx;
};
const errors = [];
const watch = (page, name) => page.on('console', (m) => { if (m.type() === 'error' && !/undefinedFn|500|Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });

// V1: lands and leaves within 2 seconds
{ const c = await visitor(); const p = await c.newPage(); watch(p, 'v1'); await p.goto(SITE + '/'); await sleep(1500); await c.close(); }
// V2: browses, rage-clicks, hits a JS error, starts sign-up, server fails
{ const c = await visitor(); const p = await c.newPage(); watch(p, 'v2');
  await p.goto(SITE + '/?utm_source=instagram'); await sleep(5600); await p.mouse.wheel(0, 3000); await sleep(400);
  await p.click('#p'); await p.waitForURL('**/pricing'); await sleep(800);
  for (let i = 0; i < 4; i++) { await p.click('#trial', { delay: 10 }); await sleep(90); }
  await sleep(500); await p.click('#go'); await p.waitForURL('**/signup'); await p.goto(SITE + '/signup?fail=1');
  await p.fill('[name=email]', 'a@b.co'); await p.fill('[name=phone]', '98'); await p.fill('[name=pw]', 'secretpw'); await p.click('button[type=submit]'); await sleep(4800); await c.close(); }
// V3: signs up successfully
{ const c = await visitor(); const p = await c.newPage(); watch(p, 'v3');
  await p.goto(SITE + '/signup'); await p.fill('[name=email]', 'x@y.co'); await p.fill('[name=phone]', '9'); await p.fill('[name=pw]', 'secretpw'); await p.click('button[type=submit]'); await p.waitForURL('**/welcome'); await sleep(1500); await c.close(); }
// V4: starts the form and gives up at the phone field
{ const c = await visitor(); const p = await c.newPage(); watch(p, 'v4');
  await p.goto(SITE + '/signup'); await p.fill('[name=email]', 'q@y.co'); await p.focus('[name=phone]'); await sleep(7000); await c.close(); }
// V5: phone visitor, gone at once
{ const c = await visitor({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 800 }, extraHTTPHeaders: { referer: 'https://l.instagram.com/' } }); const p = await c.newPage(); watch(p, 'v5'); await p.goto(SITE + '/pricing', { referer: 'https://l.instagram.com/' }); await sleep(900); await c.close(); }
// Owner: must not be counted, and gets the panel
const octx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const op = await octx.newPage(); watch(op, 'owner');
await op.goto(SITE + '/pricing?munshi=' + KEY); await sleep(4500);
const ownerUrl = op.url();
await sleep(3500);
const get = async (path) => (await fetch(M + '/api/' + path, { headers: { 'x-munshi-key': KEY } })).json();
const s = await get('stats?range=today&page=/pricing');
const frame = op.frames().find((f) => f.url().includes('/panel'));
const dockText = frame ? await frame.locator('body').innerText() : '(no frame)';
await op.screenshot({ path: out + '/owner-dock.png' });
const margin = await op.evaluate(() => document.documentElement.style.marginRight);
// panel with sample data, narrow and wide, light and dark
for (const [name, w, h, scheme] of [['panel-rail', 392, 1500, 'light'], ['panel-wide', 1320, 1500, 'light'], ['panel-rail-dark', 392, 1500, 'dark']]) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme }); const p = await c.newPage(); watch(p, name);
  await p.goto(M + '/panel#k=' + KEY + (w < 500 ? '&embed=1' : '')); await sleep(800);
  await p.getByRole('button', { name: 'Sample data' }).click(); await sleep(900);
  await p.getByRole('button', { name: 'Yesterday' }).click(); await sleep(900);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }); await c.close();
}
{ const c = await browser.newContext({ viewport: { width: 900, height: 1400 } }); const p = await c.newPage(); watch(p, 'setup'); await p.goto(M + '/setup#k=' + KEY); await p.fill('#siteurl', 'acme.in'); await sleep(1200); await p.screenshot({ path: out + '/setup.png', fullPage: true }); await c.close(); }
await browser.close();

const T = s.totals, checks = [];
const ok = (name, cond, got) => checks.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> got ' + JSON.stringify(got)}`);
ok('5 visits counted (owner excluded)', T.visits === 5, T.visits);
ok('2 left within 5 seconds', T.quick === 2, s.fate);
ok('1 sign-up detected automatically', T.signups === 1, T.signups);
const fate = Object.fromEntries(s.fate.map((f) => [f.key, f.n]));
ok('2 started but did not finish', fate.intent === 2, fate);
const src = Object.fromEntries(s.sources.map((x) => [x.name, x.visits]));
ok('Instagram is the source of 2 visits', src.Instagram === 2, src);
ok('1 phone visit', s.devices.find((d) => d.name === 'Phone')?.visits === 1, s.devices);
const form = s.forms.find((f) => f.page === '/signup');
ok('sign-up form: 3 started, 2 submitted, phone is the stopping field', form && form.started === 3 && form.submitted === 2 && form.lastField?.[0] === 'Phone number', s.forms);
const raw = JSON.stringify(s);
ok('rage click on "Start free trial" seen', s.pageFocus.rage === 1, s.pageFocus);
ok('JS error captured', s.pageFocus.errors === 1, s.pageFocus);
ok('page focus has click labels', s.pageFocus.clicks.some((c) => c.label === 'Start free trial'), s.pageFocus.clicks);
ok('nothing typed by visitors is stored', !/a@b\.co|secretpw|x@y\.co/.test(raw), null);
ok('owner key stripped from address bar', !ownerUrl.includes('munshi='), ownerUrl);
ok('panel docked for owner and site pushed aside', dockText.includes('Munshi') && margin === '392px', { margin, dockText: dockText.slice(0, 80) });
ok('no unexpected console errors', errors.length === 0, errors);
const home = s.pages.find((p) => p.path === '/');
ok('scroll depth and time recorded on /', home && home.scroll >= 90 && home.time >= 1000, home);
console.log(checks.join('\n'));
console.log('\nbrief:', s.brief.headline, s.brief.lines.join(' '));
console.log('health:', JSON.stringify(await get('health')));
const raw2 = await (await fetch(M + '/api/stats')).status; console.log('unauthenticated stats ->', raw2);
console.log('digest:\n' + await (await fetch(M + '/api/digest?k=' + KEY)).text());
