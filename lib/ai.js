// The language model layer. The numbers and the problem list are computed in analyze.js;
// the model only explains them and answers questions about them. If no model is reachable,
// callers fall back to the built-in written brief, so the product never depends on it.

import { digestText } from './analyze.js';

const SYSTEM = `You are Munshi, a product analyst who sits beside the founder of a website and tells them plainly what their visitors did and what to fix.

You are given the analytics for one period: totals, where visits ended, traffic sources, pages, devices, forms, and a ranked list of detected problems with evidence.

How to answer:
- Speak to a founder who is not technical. Short sentences, everyday words, no jargon. If you must name a technical thing, say what it means in a few words.
- Use only numbers that appear in the data. Never estimate, invent or extrapolate a number. If the data does not answer the question, say so and say what would need to be tracked.
- When numbers are small (under about 30 visits), say that it is too early to be sure.
- Lead with the answer. Then the one or two facts that support it. Then what to do, as a concrete action they could take today.
- Think like a product designer and builder: connect the behaviour to a likely cause on the page, and propose a specific change (wording, layout, a field to remove, a step to cut), not generic advice.
- Keep it under 130 words unless asked for detail. Plain text only: no markdown, no headings, no bullet symbols. Use line breaks between thoughts.`;

function endpoint(req) {
  if (process.env.ANTHROPIC_API_KEY) return { kind: 'anthropic', key: process.env.ANTHROPIC_API_KEY };
  const key = process.env.AI_GATEWAY_API_KEY || req?.headers?.get?.('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN;
  if (key) return { kind: 'gateway', key };
  return null;
}

export function aiConfigured(req) { const e = endpoint(req); return e ? e.kind : null; }

async function call(req, model, messages, maxTokens = 500) {
  const ep = endpoint(req);
  if (!ep) throw new Error('no_model');
  const ctrl = AbortSignal.timeout(25000);
  if (ep.kind === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl,
      headers: { 'content-type': 'application/json', 'x-api-key': ep.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.MUNSHI_ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system: SYSTEM, messages }),
    });
    if (!r.ok) throw new Error(`anthropic_${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  }
  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST', signal: ctrl,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ep.key}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: SYSTEM }, ...messages] }),
  });
  if (!r.ok) throw new Error(`gateway_${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content || '').trim();
}

function context(a, siteName) {
  const extra = {
    period: a.range, timezone: a.tz, totals: a.totals, whereVisitsEnded: a.fate,
    sources: a.sources, devices: a.devices, countries: a.countries,
    pages: a.pages.slice(0, 15), forms: a.forms, comparedWithPreviousPeriod: a.compare,
    pageTheFounderIsLookingAt: a.pageFocus,
  };
  return `Analytics for ${siteName}.\n\nSummary:\n${digestText(a, siteName)}\n\nFull data (JSON):\n${JSON.stringify(extra)}`;
}

export async function ask(req, model, a, siteName, question, history = []) {
  const msgs = [{ role: 'user', content: context(a, siteName) }, { role: 'assistant', content: 'I have the data. What would you like to know?' }];
  for (const h of history.slice(-6)) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) msgs.push({ role: h.role, content: String(h.content).slice(0, 1500) });
  }
  msgs.push({ role: 'user', content: String(question).slice(0, 800) });
  return call(req, model, msgs, 600);
}

export async function narrate(req, model, a, siteName) {
  return call(req, model, [{
    role: 'user',
    content: `${context(a, siteName)}\n\nWrite the founder's briefing for this period in 3 or 4 short sentences: what happened, the single most costly problem and why you think it is happening, and the one thing to do first. Do not repeat the visit and quick-exit counts; they are already shown above your text.`,
  }], 300);
}
