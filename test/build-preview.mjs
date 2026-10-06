import fs from 'node:fs';
const src = fs.readFileSync('public/panel.html', 'utf8');
const stats = JSON.parse(fs.readFileSync('test/out/preview-stats.json', 'utf8'));
const read = {
  today: 'Interest is real but nothing is getting through: 45 people started to sign up today and none finished. Two things block them in the same place. The sign-up request is failing with a server error for some, and 16 of the 20 who abandoned the form stopped at the phone number field. Fix the server error first, then make the phone number optional.',
  yesterday: 'Two people signed up out of 459 visits. The costliest leak is the pricing page: on phones it takes about 5 seconds to appear, and 36 of the 46 people who landed there left before it did. Next is sign-up, where 21 of 31 gave up, mostly at the phone number field. Speed up the pricing page first.',
  '7d': '12 sign-ups from 3,026 visits this week. More than half of all visits end within 5 seconds, and Instagram is the main reason: 900 visits, 81% gone at once, 3 sign-ups. WhatsApp sent 248 visits and 4 sign-ups, so it is your best traffic per visit. Among people who do want in, 130 stopped at the phone number field.',
};
const answers = {
  'What should I fix first?': 'The sign-up server error. Today 45 people started to sign up and none got through, and for 5 of them the sign-up request itself failed with a server error (POST /api/signup, error 500). Those are people who filled in the form and pressed the button. Ask your developer to check the server logs for that request.\n\nSecond, make the phone number field optional: 16 of the 20 people who gave up on the form stopped there.',
  'Why is nobody signing up?': 'People are trying. 45 started today. They are stopped in three places on the sign-up page.\n\n16 gave up at the phone number field. 5 submitted the form and your server returned an error. 7 hit a bug in the page (“Cannot read properties of undefined (reading \'plan\')”).\n\nSo it is the sign-up page, not the offer. Fix the error and the bug, and drop the phone number.',
  'Which traffic is worth my time?': 'Today nobody converted from any source, so I can only judge by who stays. Direct visitors and Google search stay best: 41% and 48% leave within 5 seconds. Instagram sent the most visits (76) but 72% left at once. Your Google ad sent 23 visits and 87% left at once, mostly because the pricing page it points to takes 5 seconds to appear.\n\nI would pause the ad until that page is fast. One day is too few to judge sign-ups by source; the 7 days view is better for that.',
  'How do phone visitors compare?': 'Phones are 182 of today\'s 291 visits. 59% of phone visitors left within 5 seconds, against 55% on computers, so overall the gap is small today.\n\nThe real phone problem is the pricing page. On phones it takes about 5 seconds to show, and 14 people tapped “Start free trial” again and again because nothing seemed to happen.',
};
let head = src.slice(src.indexOf('<title>'), src.indexOf('</head>')).replace('<title>Munshi</title>', '<title>Munshi Preview</title>');
let body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>'));
head = head.replace(/--focus:#8FA8FF; --bar:#8FA3EC; --bar-soft:#2E3860;\n/g, '--focus:#8FA8FF; --bar:#8FA3EC; --bar-soft:#2E3860; color-scheme:dark;\n')
  .replace('position:sticky;top:0;z-index:5', 'position:sticky;top:env(safe-area-inset-top,0px);z-index:5')
  .replace('padding:10px 16px 12px;z-index:4', 'padding:10px 16px calc(12px + env(safe-area-inset-bottom,0px));z-index:4')
  .replace('body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}', 'html,body{height:100%}body{display:flex;flex-direction:column;overflow-y:auto}');
const data = `<script>window.MUNSHI_PREVIEW=${JSON.stringify({ stats, read, answers }).replace(/</g, '\\u003c')};</script>`;
fs.writeFileSync('test/out/munshi-preview.html', head + '\n' + data + '\n' + body);
fs.writeFileSync('test/out/wrapped.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + head + data + body + '</body></html>');
console.log('size', fs.statSync('test/out/munshi-preview.html').size, 'dark blocks', (head.match(/color-scheme:dark/g) || []).length);
