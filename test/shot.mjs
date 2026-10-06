import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const b = await chromium.launch(); const errs = [];
for (const [n, w, h, s] of [['pv-phone', 400, 860, 'light'], ['pv-desk-dark', 1280, 900, 'dark']]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: s }); const p = await c.newPage();
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('file:///home/claude/munshi/test/out/wrapped.html'); await p.waitForTimeout(700);
  if (n === 'pv-phone') { await p.getByRole('button', { name: 'What should I fix first?' }).click(); await p.waitForTimeout(600); }
  console.log(n, 'h-overflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await p.screenshot({ path: `test/out/${n}.png` }); await c.close();
}
await b.close(); console.log('errors', errs);
