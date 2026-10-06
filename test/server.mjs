// Local stand-in for Vercel: serves /public and routes /api/* to the same handler.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../api/[route].js';
const PUB = path.resolve('public'), SITE = path.resolve('test/site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serve(dir) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://' + req.headers.host);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    let f = path.join(dir, p); if (!path.extname(f)) f += '.html';
    if (!f.startsWith(dir) || !fs.existsSync(f)) {
      if (dir === SITE && p === '/api-missing') { res.writeHead(500); return res.end('boom'); }
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'text/plain', 'access-control-allow-origin': '*' }); res.end(fs.readFileSync(f));
  };
}
http.createServer(serve(PUB)).listen(4100);   // Munshi
http.createServer(async (req, res) => {       // the "customer" website, on another origin
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/signup') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"db down"}'); }
  if (url.pathname === '/api/ok') { res.writeHead(200); return res.end('{}'); }
  return serve(SITE)(req, res);
}).listen(4200);
console.log('munshi http://localhost:4100  site http://localhost:4200');
