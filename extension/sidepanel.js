// Shows your Munshi dashboard beside whatever tab you are on. Paste your dashboard link once.
const root = document.getElementById('root');
let frame = null, base = null;

function parse(link) {
  try {
    const u = new URL(link.trim());
    const k = new URLSearchParams(u.hash.slice(1)).get('k');
    return u.protocol === 'https:' && k ? { origin: u.origin, key: k } : null;
  } catch { return null; }
}
async function activePath() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  try { return new URL(tab.url).pathname; } catch { return null; }
}
function askForLink(msg) {
  root.innerHTML = `<form><h1>Connect Munshi</h1><p>Open your Munshi setup page, copy the link of “Open the full dashboard”, and paste it here.</p>
    <input id="l" placeholder="https://…/panel#k=…" required>${msg ? `<p class="err">${msg}</p>` : ''}<button>Connect</button></form>`;
  root.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = parse(root.querySelector('#l').value);
    if (!p) return askForLink('That does not look like a Munshi dashboard link.');
    await chrome.storage.local.set({ munshi: p });
    show(p);
  });
}
async function show(p) {
  base = p;
  const page = await activePath();
  root.innerHTML = '';
  frame = document.createElement('iframe');
  frame.title = 'Munshi';
  frame.src = `${p.origin}/panel#k=${encodeURIComponent(p.key)}${page ? '&page=' + encodeURIComponent(page) : ''}`;
  root.appendChild(frame);
}
async function pageChanged() {
  if (!frame || !base) return;
  const path = await activePath();
  if (path) frame.contentWindow.postMessage({ type: 'munshi:page', path }, base.origin);
}
chrome.tabs.onActivated.addListener(pageChanged);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url) pageChanged(); });
chrome.storage.local.get('munshi').then((s) => (s.munshi ? show(s.munshi) : askForLink()));
