# Munshi

An AI product analyst that sits on your website. It records what visitors do, works out
where you are losing them, and tells you in plain language what to fix.

## What is in here

| Path | What it is |
|---|---|
| `public/m.js` | The one script you paste into your site. Tracks visitors; shows the panel to you. |
| `public/panel.html` | The analyst panel and full dashboard. |
| `public/setup.html` | Setup steps and a health check. |
| `api/[route].js` | The backend: receiving events, statistics, questions, daily digest. |
| `lib/analyze.js` | The analyst: numbers, where visits ended, ranked problems with fixes. |
| `lib/store.js` | Storage. Works with nothing configured; uses Vercel Blob when connected. |
| `lib/ai.js` | The language model layer (Vercel AI Gateway, or an Anthropic key). |
| `extension/` | Optional Chrome side-panel extension. |
| `munshi.config.js` | Timezone, AI model, and the pages that count as a sign-up or a sale. |

## Deploy

Import this repository at vercel.com/new and press Deploy. Nothing needs configuring.
Then open `https://<your-deployment>/setup#k=<your owner key>` and follow the three steps.

To keep history permanently, create a **private** Vercel Blob store, connect it to the
project and redeploy. To enable the question box, turn on Vercel AI Gateway or set
`ANTHROPIC_API_KEY`.

## What it records

Pages viewed, time on page, scroll depth, clicks on buttons and links (their label),
repeated frustrated clicks, code errors, failed requests, which form field people stop
at, page speed, traffic source, device type and country. It sets no cookies and never
records what anyone types. The owner's own visits are not counted.

## Test locally

    npm install
    node test/server.mjs     # Munshi on :4100, a test website on :4200
    node test/e2e.mjs        # real browsers act as visitors; needs Playwright
